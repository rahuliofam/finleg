#!/usr/bin/env node
/**
 * OCR scanned image PDFs using Google Gemini 2.5 Flash.
 * Runs locally — no Hostinger needed. ~5s/doc, ~$0.0004/page.
 *
 * Usage:
 *   node scripts/ocr-gemini-flash.mjs [--dry-run] [--limit N] [--bucket legal-docs] [--verbose]
 *
 * Requires: GEMINI_API_KEY env var or Bitwarden entry "Gemini API Keys"
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';

import {
  loadEnv,
  createSupabaseClient,
  createLogger,
  parseArgs,
  retry,
  run,
  ValidationError,
} from './lib/index.mjs';

const env = loadEnv({
  required: ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
});

const supabase = createSupabaseClient({ env });

const args = parseArgs(process.argv.slice(2), {
  numbers: { limit: 9999 },
  strings: ['bucket'],
  help: `OCR scanned PDFs via Gemini 2.5 Flash

Usage: node scripts/ocr-gemini-flash.mjs [options]

Options:
  --dry-run        download only, don't OCR or save
  --limit N        max docs to process (default all)
  --bucket NAME    filter by bucket (e.g. legal-docs)
  --verbose        show debug logs
  --help           this text
`,
});

const log = createLogger({ verbose: args.verbose });

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

const PARALLEL = 1; // sequential to avoid rate limits on free tier
const TMP_DIR = '/tmp/ocr-gemini';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

const PROMPT = 'Extract ALL text from this scanned PDF document. Return ONLY the raw text content, preserving paragraph structure. Do not add any commentary, headers, formatting notes, or markdown. Just the plain text as it appears in the document.';

async function downloadFromR2(bucket, r2Key) {
  mkdirSync(TMP_DIR, { recursive: true });
  const safeFilename = r2Key.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-100) + '_' + Date.now();
  const tmpPath = join(TMP_DIR, safeFilename);

  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  await pipeline(resp.Body, createWriteStream(tmpPath));
  return tmpPath;
}

async function ocrWithGemini(pdfPath) {
  const pdfBase64 = readFileSync(pdfPath).toString('base64');

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
        { text: PROMPT },
      ],
    }],
  };

  // retry() handles exponential backoff on 429/5xx and network errors.
  return retry(
    async () => {
      const resp = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        // Attach status so retry's defaultShouldRetry can decide.
        const e = new Error(`Gemini API ${resp.status}: ${errText.slice(0, 200)}`);
        e.status = resp.status;
        throw e;
      }

      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const reason = data.candidates?.[0]?.finishReason || 'unknown';
        // No text returned — usually bad input, don't retry.
        throw new ValidationError(`Gemini returned no text (reason: ${reason})`);
      }
      return text.trim();
    },
    {
      maxAttempts: 4,
      baseDelayMs: 10_000,       // 10s, 20s, 40s (matches previous hardcoded schedule)
      maxDelayMs: 40_000,
      jitter: 0,
      onRetry: (err, attempt, waitMs) => {
        log.warn(`    Gemini retry ${attempt} after ${Math.round(waitMs / 1000)}s (${err.message?.slice(0, 80)})`);
      },
    }
  );
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_size } = doc;
  const startTime = Date.now();

  let tmpPath;
  try {
    tmpPath = await downloadFromR2(bucket, r2_key);

    if (args.dryRun) {
      log.info(`  [DRY] ${filename} (${Math.round(file_size / 1024)}KB)`);
      return { id, success: true, chars: 0, dryRun: true };
    }

    const text = await ocrWithGemini(tmpPath);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!text || text.length < 10) {
      log.warn(`  ✗ ${filename}: no text extracted (${elapsed}s)`);
      return { id, error: 'empty result' };
    }

    // Save to Supabase
    const { error } = await supabase
      .from('document_index')
      .update({ extracted_text: text, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      log.error(`  ✗ ${filename}: DB error: ${error.message}`);
      return { id, error: error.message };
    }

    log.info(`  ✓ ${filename}: ${text.length} chars (${elapsed}s)`);
    return { id, success: true, chars: text.length, elapsed: parseFloat(elapsed) };
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.error(`  ✗ ${filename}: ${e.message?.slice(0, 150)} (${elapsed}s)`);
    return { id, error: e.message?.slice(0, 80) };
  } finally {
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  log.info(`[START] OCR Scanned PDFs via Gemini 2.5 Flash`);
  log.info(`Mode: ${args.dryRun ? 'DRY-RUN' : 'LIVE'} | Limit: ${args.limit} | Bucket: ${args.bucket || 'all'} | Parallel: ${PARALLEL}\n`);

  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type, file_size')
    .eq('file_type', 'pdf')
    .is('extracted_text', null)
    .order('file_size', { ascending: true })
    .limit(args.limit);

  if (args.bucket) {
    query = query.eq('bucket', args.bucket);
  }

  const { data: docs, error } = await query;
  if (error) throw new ValidationError(`Query error: ${error.message}`);

  log.info(`Found ${docs.length} scanned PDFs to OCR\n`);

  let success = 0, failed = 0, totalChars = 0, totalTime = 0;

  for (let i = 0; i < docs.length; i += PARALLEL) {
    // Rate limit: Gemini free tier = 10 RPM, so wait 7s between requests
    if (i > 0) await sleep(7000);

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
    log.info(`  Progress: ${done}/${docs.length} | ✓${success} ✗${failed} | avg ${avgTime}s/doc | ETA ~${eta}min\n`);
  }

  log.info(`\n=== COMPLETE ===`);
  log.info(`OCR'd:     ${success}`);
  log.info(`Failed:    ${failed}`);
  log.info(`Total:     ${docs.length}`);
  log.info(`Chars:     ${totalChars.toLocaleString()}`);
  log.info(`Avg time:  ${success > 0 ? (totalTime / success).toFixed(1) : '0'}s/doc`);
  log.info(`Total time: ${(totalTime / 60).toFixed(1)}min`);
}

run(main);
