#!/usr/bin/env node
/**
 * OCR scanned image PDFs using Claude CLI headless mode.
 * Designed to run on Hostinger VPS (not locally — nested CLI doesn't work).
 *
 * Finds PDFs in document_index where extracted_text IS NULL,
 * downloads from R2, sends to Claude vision via CLI, saves text to DB.
 *
 * Usage:
 *   node scripts/ocr-scanned-pdfs.mjs [--dry-run] [--limit=N] [--bucket=legal-docs]
 *
 * Prerequisites (on Hostinger):
 *   - Claude CLI: npm i -g @anthropic-ai/claude-code
 *   - Node 22+
 *   - .env with SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { unlinkSync, mkdirSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { execSync } from 'child_process';
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
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 9999;
const BUCKET_FILTER = process.argv.find(a => a.startsWith('--bucket='))?.split('=')[1] || null;
const MODEL = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'sonnet';
const PARALLEL = 1; // sequential — CLI cold starts are slow
const TMP_DIR = '/tmp/ocr-extract';

const PROMPT = `You are an OCR tool. Read this scanned PDF document and extract ALL text visible on every page. Output ONLY the raw text, preserving paragraph structure. Do not add any commentary, headers, formatting notes, or explanations. Just the text as it appears in the document.`;

async function downloadFromR2(bucket, r2Key) {
  mkdirSync(TMP_DIR, { recursive: true });
  const safeFilename = r2Key.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-100) + '_' + Date.now();
  const tmpPath = join(TMP_DIR, safeFilename);

  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  await pipeline(resp.Body, createWriteStream(tmpPath));
  return tmpPath;
}

function ocrWithClaude(pdfPath, model) {
  // Shell-escape the path
  const escapedPath = pdfPath.replace(/'/g, "'\\''");
  try {
    const result = execSync(
      `cd /tmp && claude --print --model ${model} -p "Read the file ${escapedPath} and extract all visible text. Output ONLY the raw text, preserving paragraph structure. No commentary."`,
      {
        timeout: 180000, // 3 min per doc
        env: { ...process.env, CLAUDECODE: undefined },
        maxBuffer: 5 * 1024 * 1024,
      }
    );
    return result.toString('utf-8').trim();
  } catch (e) {
    if (e.stdout && e.stdout.length > 50) {
      return e.stdout.toString('utf-8').trim();
    }
    throw new Error(`Claude CLI failed: ${e.message?.slice(0, 120)}`);
  }
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_size } = doc;
  const startTime = Date.now();

  let tmpPath;
  try {
    // Download
    tmpPath = await downloadFromR2(bucket, r2_key);

    if (DRY_RUN) {
      console.log(`  [DRY] ${filename} (${Math.round(file_size / 1024)}KB)`);
      return { id, success: true, chars: 0, dryRun: true };
    }

    // OCR with Claude
    const text = ocrWithClaude(tmpPath, MODEL);
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
    console.error(`  ✗ ${filename}: ${e.message?.slice(0, 120)} (${elapsed}s)`);
    return { id, error: e.message?.slice(0, 80) };
  } finally {
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  console.log(`[START] OCR Scanned PDFs via Claude CLI`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Model: ${MODEL} | Limit: ${LIMIT} | Bucket: ${BUCKET_FILTER || 'all'} | Parallel: ${PARALLEL}\n`);

  // Find PDFs with no extracted text (these are the scanned ones that pdf-parse couldn't read)
  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type, file_size')
    .eq('file_type', 'pdf')
    .is('extracted_text', null)
    .order('file_size', { ascending: true }) // smallest first for faster initial feedback
    .limit(LIMIT);

  if (BUCKET_FILTER) {
    query = query.eq('bucket', BUCKET_FILTER);
  }

  const { data: docs, error } = await query;
  if (error) { console.error(`Query error: ${error.message}`); process.exit(1); }

  console.log(`Found ${docs.length} scanned PDFs to OCR\n`);

  let success = 0, failed = 0, totalChars = 0, totalTime = 0;

  // Process sequentially in small batches (Claude CLI is heavy)
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
