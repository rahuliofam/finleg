#!/usr/bin/env node
/**
 * Extract text from documents in R2 and store in document_index.extracted_text.
 *
 * Supports: PDF, DOCX, MD/TXT files.
 * Downloads from R2, extracts text, updates Supabase.
 *
 * Usage:
 *   node scripts/extract-doc-text.mjs [--dry-run] [--limit=N] [--bucket=legal-docs] [--force]
 *
 * --force: re-extract even if extracted_text already exists
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { createRequire } from 'module';
import { config } from 'dotenv';

const require = createRequire(import.meta.url);

config();

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error('Missing R2 credentials in .env');
  process.exit(1);
}

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
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    await pipeline(resp.Body, createWriteStream(tmpPath));
    return tmpPath;
  } catch (e) {
    console.error(`  Download failed: ${e.message?.slice(0, 100)}`);
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
      console.log(`  ${filename}: no text extracted`);
      return { id, error: 'empty text' };
    }

    const trimmedText = text.trim();
    const preview = trimmedText.slice(0, 80).replace(/\n/g, ' ');
    console.log(`  ${filename}: ${trimmedText.length} chars — "${preview}..."`);

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('document_index')
        .update({ extracted_text: trimmedText, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        console.error(`  Supabase error: ${error.message}`);
        return { id, error: error.message };
      }
    }

    return { id, success: true, chars: trimmedText.length };
  } catch (e) {
    console.error(`  Error: ${filename}: ${e.message?.slice(0, 120)}`);
    return { id, error: e.message?.slice(0, 80) };
  } finally {
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  console.log(`[START] Document Text Extraction`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Limit: ${LIMIT} | Bucket: ${BUCKET_FILTER || 'all'} | Force: ${FORCE}\n`);

  // Query documents needing text extraction
  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type')
    .in('file_type', [...TEXT_TYPES, PDF_TYPE, DOCX_TYPE])
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (!FORCE) {
    query = query.is('extracted_text', null);
  }

  if (BUCKET_FILTER) {
    query = query.eq('bucket', BUCKET_FILTER);
  }

  const { data: docs, error } = await query;
  if (error) {
    console.error(`Query error: ${error.message}`);
    process.exit(1);
  }

  console.log(`Found ${docs.length} documents to process\n`);

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
      console.log(`  Progress: ${Math.min(i + PARALLEL, docs.length)}/${docs.length}`);
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Extracted: ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Total:     ${docs.length}`);
}

main().catch(console.error);
