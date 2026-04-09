#!/usr/bin/env node
/**
 * OCR scanned PDFs using GLM-OCR (self-hosted on Alpuca Mac mini M4).
 * First-pass OCR — extracts raw text. Second-pass enrichment uses Sonnet 4.6
 * via extract-doc-metadata.mjs.
 *
 * GLM-OCR runs as a Flask service on Alpuca (port 5002) backed by Ollama.
 * Model: glm-ocr:latest (0.9B params, #1 on OmniDocBench V1.5)
 *
 * Usage:
 *   node scripts/ocr-glm.mjs [--dry-run] [--limit=N] [--bucket=legal-docs] [--force]
 *
 * Options:
 *   --dry-run     List documents without processing
 *   --limit=N     Process at most N documents
 *   --bucket=X    Filter by R2 bucket name
 *   --force       Re-OCR documents that already have extracted_text
 *   --host=X      GLM-OCR server host (default: 100.74.59.97 via Tailscale)
 *   --parallel=N  Concurrent requests (default: 3)
 *
 * Prerequisites:
 *   - GLM-OCR Flask service running on Alpuca (launchd: com.alpuca.glm-ocr)
 *   - .env with SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { config } from 'dotenv';

config();

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) { console.error('Missing R2 credentials'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 9999;
const BUCKET_FILTER = process.argv.find(a => a.startsWith('--bucket='))?.split('=')[1] || null;
const GLM_HOST = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || '100.74.59.97';
const GLM_PORT = 5002;
const GLM_URL = `http://${GLM_HOST}:${GLM_PORT}/ocr`;
const PARALLEL = parseInt(process.argv.find(a => a.startsWith('--parallel='))?.split('=')[1] || '3');
const TMP_DIR = '/tmp/ocr-glm';

// Supported image types for direct OCR (PDFs get converted to images first)
const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'];
const DOC_TYPES = ['pdf', ...IMAGE_TYPES];

async function downloadFromR2(bucket, r2Key) {
  mkdirSync(TMP_DIR, { recursive: true });
  const safeFilename = r2Key.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-100) + '_' + Date.now();
  const tmpPath = join(TMP_DIR, safeFilename);

  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  await pipeline(resp.Body, createWriteStream(tmpPath));
  return tmpPath;
}

async function ocrWithGlm(filePath, filename) {
  const fileBase64 = readFileSync(filePath).toString('base64');

  const resp = await fetch(GLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: fileBase64, filename: filename || 'document.pdf' }),
    signal: AbortSignal.timeout(300000), // 5 min timeout per doc
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GLM-OCR API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (data.error) throw new Error(data.error);

  const text = data.text || data.markdown || '';
  return text.trim();
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_size, file_type } = doc;
  const startTime = Date.now();

  let tmpPath;
  try {
    tmpPath = await downloadFromR2(bucket, r2_key);

    if (DRY_RUN) {
      console.log(`  [DRY] ${filename} (${Math.round(file_size / 1024)}KB)`);
      return { id, success: true, chars: 0, dryRun: true };
    }

    const text = await ocrWithGlm(tmpPath, filename);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!text || text.length < 10) {
      console.log(`  ✗ ${filename}: no text extracted (${elapsed}s)`);
      return { id, error: 'empty OCR result' };
    }

    // Save to Supabase
    const { error } = await supabase
      .from('document_index')
      .update({ extracted_text: text, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error(`  ✗ ${filename}: DB error: ${error.message}`);
      return { id, error: error.message };
    }

    console.log(`  ✓ ${filename}: ${text.length} chars (${elapsed}s)`);
    return { id, success: true, chars: text.length, elapsed: parseFloat(elapsed) };
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  ✗ ${filename}: ${e.message?.slice(0, 150)} (${elapsed}s)`);
    return { id, error: e.message?.slice(0, 80) };
  } finally {
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  console.log(`[START] OCR via GLM-OCR (Alpuca ${GLM_HOST}:${GLM_PORT})`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Limit: ${LIMIT} | Bucket: ${BUCKET_FILTER || 'all'} | Parallel: ${PARALLEL} | Force: ${FORCE}\n`);

  // Health check
  try {
    const health = await fetch(`http://${GLM_HOST}:${GLM_PORT}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    console.log(`GLM-OCR server reachable ✓\n`);
  } catch (e) {
    console.error(`Cannot reach GLM-OCR server at ${GLM_URL}: ${e.message}`);
    console.error('Is the service running? Check: ssh paca@100.74.59.97 "launchctl list | grep glm"');
    process.exit(1);
  }

  // Query documents needing OCR
  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type, file_size')
    .in('file_type', DOC_TYPES)
    .order('file_size', { ascending: true })
    .limit(LIMIT);

  if (!FORCE) {
    query = query.is('extracted_text', null);
  }

  if (BUCKET_FILTER) {
    query = query.eq('bucket', BUCKET_FILTER);
  }

  const { data: docs, error } = await query;
  if (error) { console.error(`Query error: ${error.message}`); process.exit(1); }

  console.log(`Found ${docs.length} documents to OCR\n`);
  if (docs.length === 0) { console.log('Nothing to do.'); return; }

  let success = 0, failed = 0, totalChars = 0, totalTime = 0;

  // Process in parallel batches
  for (let i = 0; i < docs.length; i += PARALLEL) {
    const batch = docs.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(d => processDocument(d)));

    for (const r of results) {
      if (r.success && !r.dryRun) {
        success++;
        totalChars += r.chars;
        totalTime += r.elapsed || 0;
      } else if (!r.dryRun) {
        failed++;
      }
    }

    const done = Math.min(i + PARALLEL, docs.length);
    const avgTime = success > 0 ? (totalTime / success).toFixed(1) : '?';
    const remaining = docs.length - done;
    const eta = success > 0 ? Math.round((remaining * totalTime) / success / 60) : '?';
    console.log(`  Progress: ${done}/${docs.length} | ✓${success} ✗${failed} | avg ${avgTime}s/doc | ETA ~${eta}min\n`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`OCR'd:     ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${docs.length}`);
  console.log(`Chars:     ${totalChars.toLocaleString()}`);
  console.log(`Avg time:  ${success > 0 ? (totalTime / success).toFixed(1) : '0'}s/doc`);
  console.log(`Total time: ${(totalTime / 60).toFixed(1)}min`);
}

main().catch(console.error);
