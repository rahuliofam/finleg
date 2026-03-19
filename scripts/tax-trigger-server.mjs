#!/usr/bin/env node
/**
 * Lightweight HTTP trigger server for tax return processing.
 * Runs on Hostinger, receives POST from the Supabase webhook when a new
 * tax return arrives, and immediately kicks off extraction.
 *
 * Replaces the 10-minute cron with instant processing.
 *
 * Usage:
 *   node scripts/tax-trigger-server.mjs
 *
 * Caddy config (add to /etc/caddy/Caddyfile):
 *   finleg-trigger.alpacapps.com {
 *     reverse_proxy localhost:8912
 *   }
 *
 * Or call directly: POST http://localhost:8912/process-tax-return
 */

import { createServer } from 'http';
import { execFile } from 'child_process';

const PORT = 8912;
const TRIGGER_SECRET = process.env.TRIGGER_SECRET || '';
const SCRIPT_DIR = new URL('.', import.meta.url).pathname;

let processing = false;
let queued = false;

function runExtraction() {
  if (processing) {
    queued = true;
    console.log(`[${ts()}] Already processing — queued next run`);
    return;
  }

  processing = true;
  console.log(`[${ts()}] Starting tax return extraction...`);

  execFile('node', [
    `${SCRIPT_DIR}process-tax-returns.mjs`,
    '--inbox'
  ], { cwd: SCRIPT_DIR.replace(/scripts\/$/, ''), timeout: 600_000 }, (err, stdout, stderr) => {
    processing = false;

    if (err) {
      console.error(`[${ts()}] Extraction error:`, err.message);
      if (stderr) console.error(stderr);
    }
    if (stdout) console.log(stdout);

    // If another request came in while we were processing, run again
    if (queued) {
      queued = false;
      console.log(`[${ts()}] Processing queued request...`);
      runExtraction();
    }
  });
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const server = createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', processing, queued }));
    return;
  }

  // Trigger endpoint
  if (req.method === 'POST' && req.url === '/process-tax-return') {
    // Verify secret if configured
    if (TRIGGER_SECRET && req.headers['x-trigger-secret'] !== TRIGGER_SECRET) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    console.log(`[${ts()}] Trigger received`);
    runExtraction();

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, processing, queued }));
    return;
  }

  // Also support triggering statement processing
  if (req.method === 'POST' && req.url === '/process-statement') {
    if (TRIGGER_SECRET && req.headers['x-trigger-secret'] !== TRIGGER_SECRET) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    console.log(`[${ts()}] Statement trigger received`);
    execFile('node', [
      `${SCRIPT_DIR}process-inbox.mjs`,
      '--once'
    ], { cwd: SCRIPT_DIR.replace(/scripts\/$/, ''), timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) console.error(`[${ts()}] Statement processing error:`, err.message);
      if (stdout) console.log(stdout);
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[${ts()}] Tax trigger server listening on http://127.0.0.1:${PORT}`);
  console.log(`  POST /process-tax-return  — trigger tax extraction`);
  console.log(`  POST /process-statement   — trigger statement processing`);
  console.log(`  GET  /health              — health check`);
});
