#!/usr/bin/env node
/**
 * Extract text from documents in R2 and store in document_index.extracted_text.
 *
 * Supports: PDF, DOCX, MD/TXT files.
 * Downloads from R2, extracts text, updates Supabase.
 *
 * Usage:
 *   node scripts/extract-doc-text.mjs [--dry-run] [--limit N] [--bucket legal-docs] [--force] [--verbose]
 *
 * --force: re-extract even if extracted_text already exists
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { createRequire } from 'module';

import {
  loadEnv,
  createSupabaseClient,
  createLogger,
  parseArgs,
  retry,
  run,
  FatalError,
} from './lib/index.mjs';

const require = createRequire(import.meta.url);

// ── Config ──
const env = loadEnv({
  required: ['SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
});

const supabase = createSupabaseClient({ env });

const cliArgs = parseArgs(process.argv.slice(2), {
  booleans: ['force'],
  numbers: { limit: 9999 },
  strings: ['bucket'],
  help: `Extract text from R2 documents into Supabase.

Usage: node scripts/extract-doc-text.mjs [options]

Options:
  --dry-run        don't save back to Supabase
  --limit N        max docs (default 9999)
  --bucket NAME    filter by bucket
  --force          re-extract even if text already present
  --verbose        show debug logs
  --help           this text
`,
});

const log = createLogger({ verbose: cliArgs.verbose });

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

const PARALLEL = 5;
const TMP_DIR = '/tmp/doc-text-extract';

// Text-extractable file types
const TEXT_TYPES = ['md', 'txt', 'csv', 'html', 'htm'];
const PDF_TYPE = 'pdf';
const DOCX_TYPE = 'docx';

async function downloadFromR2(bucket, r2Key) {
  mkdirSync(TMP_DIR, { recursive: true });
  const safeFilename = r2Key.replace(/[^a-zA-Z0-9.-]/g, '_') + '_' + Date.now();
  const tmpPath = join(TMP_DIR, safeFilename);

  try {
    // retry() handles transient R2 404/5xx/socket failures.
    await retry(async () => {
      const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
      await pipeline(resp.Body, createWriteStream(tmpPath));
    }, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000 });
    return tmpPath;
  } catch (e) {
    log.error(`  Download failed: ${e.message?.slice(0, 100)}`);
    return null;
  }
}

async function extractText(tmpPath, fileType) {
  if (TEXT_TYPES.includes(fileType)) {
    // Plain text / markdown — read directly
    return readFileSync(tmpPath, 'utf-8');
  }

  if (fileType === PDF_TYPE) {
    const pdfParse = require('pdf-parse');
    const buffer = readFileSync(tmpPath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (fileType === DOCX_TYPE) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: tmpPath });
    return result.value;
  }

  return null;
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_type } = doc;

  const supportedTypes = [...TEXT_TYPES, PDF_TYPE, DOCX_TYPE];
  if (!supportedTypes.includes(file_type)) {
    return { id, skipped: true, reason: `unsupported type: ${file_type}` };
  }

  let tmpPath;
  try {
    tmpPath = await downloadFromR2(bucket, r2_key);
    if (!tmpPath) return { id, error: 'download failed' };

    const text = await extractText(tmpPath, file_type);
    if (!text || text.trim().length === 0) {
      log.info(`  ${filename}: no text extracted`);
      return { id, error: 'empty text' };
    }

    const trimmedText = text.trim();
    const preview = trimmedText.slice(0, 80).replace(/\n/g, ' ');
    log.info(`  ${filename}: ${trimmedText.length} chars — "${preview}..."`);

    if (!cliArgs.dryRun) {
      const { error } = await supabase
        .from('document_index')
        .update({ extracted_text: trimmedText, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        log.error(`  Supabase error: ${error.message}`);
        return { id, error: error.message };
      }
    }

    return { id, success: true, chars: trimmedText.length };
  } catch (e) {
    log.error(`  Error: ${filename}: ${e.message?.slice(0, 120)}`);
    return { id, error: e.message?.slice(0, 80) };
  } finally {
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  log.info(`[START] Document Text Extraction`);
  log.info(`Mode: ${cliArgs.dryRun ? 'DRY-RUN' : 'LIVE'} | Limit: ${cliArgs.limit} | Bucket: ${cliArgs.bucket || 'all'} | Force: ${cliArgs.force}\n`);

  // Query documents needing text extraction
  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type')
    .in('file_type', [...TEXT_TYPES, PDF_TYPE, DOCX_TYPE])
    .order('created_at', { ascending: false })
    .limit(cliArgs.limit);

  if (!cliArgs.force) {
    query = query.is('extracted_text', null);
  }

  if (cliArgs.bucket) {
    query = query.eq('bucket', cliArgs.bucket);
  }

  const { data: docs, error } = await query;
  if (error) throw new FatalError(`Query error: ${error.message}`, { cause: error });

  log.info(`Found ${docs.length} documents to process\n`);

  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < docs.length; i += PARALLEL) {
    const batch = docs.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(d => processDocument(d)));

    for (const r of results) {
      if (r.skipped) skipped++;
      else if (r.success) success++;
      else failed++;
    }

    if ((i + PARALLEL) % 20 === 0) {
      log.info(`  Progress: ${Math.min(i + PARALLEL, docs.length)}/${docs.length}`);
    }
  }

  log.info(`\n=== COMPLETE ===`);
  log.info(`Extracted: ${success}`);
  log.info(`Failed:    ${failed}`);
  log.info(`Skipped:   ${skipped}`);
  log.info(`Total:     ${docs.length}`);
}

run(main);
