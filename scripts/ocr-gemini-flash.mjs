#!/usr/bin/env node
/**
 * OCR scanned image PDFs using Google Gemini 2.5 Flash.
 * Runs locally — no Hostinger needed. ~5s/doc, ~$0.0004/page.
 *
 * Usage:
 *   node scripts/ocr-gemini-flash.mjs [--dry-run] [--limit=N] [--bucket=legal-docs]
 *
 * Requires: GEMINI_API_KEY env var or Bitwarden entry "Gemini API Keys"
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY in .env'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 9999;
const BUCKET_FILTER = process.argv.find(a => a.startsWith('--bucket='))?.split('=')[1] || null;
const PARALLEL = 1; // sequential to avoid rate limits on free tier
const TMP_DIR = '/tmp/ocr-gemini';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const PROMPT = 'Extract ALL text from this scanned PDF document. Return ONLY the raw text content, preserving paragraph structure. Do not add any commentary, headers, formatting notes, or markdown. Just the plain text as it appears in the document.';

async function downloadFromR2(bucket, r2Key) {
  mkdirSync(TMP_DIR, { recursive: true });
  const safeFilename = r2Key.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-100) + '_' + Date.now();
  const tmpPath = join(TMP_DIR, safeFilename);

  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
  await pipeline(resp.Body, createWriteStream(tmpPath));
  return tmpPath;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ocrWithGemini(pdfPath, retries = 3) {
  const pdfBase64 = readFileSync(pdfPath).toString('base64');

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
        { text: PROMPT },
      ],
    }],
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (resp.status === 429) {
      const wait = Math.min(10000 * (attempt + 1), 30000); // 10s, 20s, 30s
      if (attempt < retries) {
        console.log(`    ⏳ rate limited, waiting ${wait / 1000}s (attempt ${attempt + 1}/${retries})...`);
        await sleep(wait);
        continue;
      }
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      const reason = data.candidates?.[0]?.finishReason || 'unknown';
      throw new Error(`Gemini returned no text (reason: ${reason})`);
    }

    return text.trim();
  }

  throw new Error('Gemini rate limited after all retries');
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_size } = doc;
  const startTime = Date.now();

  let tmpPath;
  try {
    tmpPath = await downloadFromR2(bucket, r2_key);

    if (DRY_RUN) {
      console.log(`  [DRY] ${filename} (${Math.round(file_size / 1024)}KB)`);
      return { id, success: true, chars: 0, dryRun: true };
    }

    const text = await ocrWithGemini(tmpPath);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!text || text.length < 10) {
      console.log(`  ✗ ${filename}: no text extracted (${elapsed}s)`);
      return { id, error: 'empty result' };
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
  console.log(`[START] OCR Scanned PDFs via Gemini 2.5 Flash`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Limit: ${LIMIT} | Bucket: ${BUCKET_FILTER || 'all'} | Parallel: ${PARALLEL}\n`);

  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type, file_size')
    .eq('file_type', 'pdf')
    .is('extracted_text', null)
    .order('file_size', { ascending: true })
    .limit(LIMIT);

  if (BUCKET_FILTER) {
    query = query.eq('bucket', BUCKET_FILTER);
  }

  const { data: docs, error } = await query;
  if (error) { console.error(`Query error: ${error.message}`); process.exit(1); }

  console.log(`Found ${docs.length} scanned PDFs to OCR\n`);

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
