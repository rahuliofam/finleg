#!/usr/bin/env node
/**
 * Compare GLM-OCR output against existing extracted_text for all finleg docs.
 * Downloads PDFs from R2, runs through GLM-OCR on Alpuca, and scores differences.
 *
 * Scoring:
 *   - char_diff: absolute difference in character count
 *   - word_diff: absolute difference in word count
 *   - jaccard: Jaccard similarity of word sets (0-1, higher = more similar)
 *   - new_fields: count of structured fields GLM-OCR found that existing text missed
 *
 * Usage:
 *   node scripts/ocr-compare.mjs [--limit=N] [--bucket=X] [--output=report.json]
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
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

const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 9999;
const BUCKET_FILTER = process.argv.find(a => a.startsWith('--bucket='))?.split('=')[1] || null;
const OUTPUT_FILE = process.argv.find(a => a.startsWith('--output='))?.split('=')[1] || 'ocr-comparison-report.json';
const GLM_HOST = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || '100.74.59.97';
const GLM_PORT = 5002;
const GLM_URL = `http://${GLM_HOST}:${GLM_PORT}/ocr`;
const TMP_DIR = '/tmp/ocr-compare';

// ── Scoring helpers ──
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

function jaccard(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

// Patterns that indicate structured extraction (dollar amounts, dates, EINs, etc.)
const FIELD_PATTERNS = [
  /\$[\d,]+\.?\d*/g,                    // dollar amounts
  /\d{2}[-/]\d{2}[-/]\d{4}/g,          // dates MM/DD/YYYY
  /\d{2}-\d{7}/g,                       // EIN
  /\d{3}-\d{2}-\d{4}/g,                // SSN pattern
  /\d{4,}/g,                            // account numbers
  /[A-Z][a-z]+ [A-Z][a-z]+/g,          // proper names
];

function countStructuredFields(text) {
  let count = 0;
  for (const pat of FIELD_PATTERNS) {
    const matches = text.match(pat);
    count += matches ? matches.length : 0;
  }
  return count;
}

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
    body: JSON.stringify({ file: fileBase64, filename }),
    signal: AbortSignal.timeout(300000),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GLM-OCR ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return (data.text || data.markdown || '').trim();
}

async function compareDocument(doc) {
  const { id, bucket, r2_key, filename, file_size, extracted_text } = doc;
  const startTime = Date.now();
  let tmpPath;

  try {
    tmpPath = await downloadFromR2(bucket, r2_key);
    const glmText = await ocrWithGlm(tmpPath, filename);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const existingWords = tokenize(extracted_text);
    const glmWords = tokenize(glmText);
    const jaccardScore = jaccard(extracted_text, glmText);
    const existingFields = countStructuredFields(extracted_text);
    const glmFields = countStructuredFields(glmText);

    const result = {
      id,
      filename,
      bucket,
      file_size,
      elapsed: parseFloat(elapsed),
      existing: {
        chars: extracted_text.length,
        words: existingWords.length,
        fields: existingFields,
      },
      glm: {
        chars: glmText.length,
        words: glmWords.length,
        fields: glmFields,
      },
      scores: {
        jaccard: parseFloat(jaccardScore.toFixed(4)),
        char_diff: glmText.length - extracted_text.length,
        word_diff: glmWords.length - existingWords.length,
        field_diff: glmFields - existingFields,
      },
      winner: glmFields > existingFields ? 'glm' :
              glmFields < existingFields ? 'existing' :
              glmText.length > extracted_text.length * 1.1 ? 'glm' :
              extracted_text.length > glmText.length * 1.1 ? 'existing' : 'tie',
      glm_preview: glmText.slice(0, 200),
      existing_preview: extracted_text.slice(0, 200),
    };

    const emoji = result.winner === 'glm' ? '🟢' : result.winner === 'existing' ? '🔴' : '⚪';
    console.log(`  ${emoji} ${filename}: jaccard=${jaccardScore.toFixed(2)} fields=${existingFields}→${glmFields} chars=${extracted_text.length}→${glmText.length} (${elapsed}s)`);

    return result;
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  ✗ ${filename}: ${e.message?.slice(0, 120)} (${elapsed}s)`);
    return { id, filename, error: e.message?.slice(0, 100), elapsed: parseFloat(elapsed) };
  } finally {
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  console.log(`[START] OCR Comparison: GLM-OCR vs Existing extracted_text`);
  console.log(`Limit: ${LIMIT} | Bucket: ${BUCKET_FILTER || 'all'} | GLM: ${GLM_HOST}:${GLM_PORT}\n`);

  // Health check
  try {
    const h = await fetch(`http://${GLM_HOST}:${GLM_PORT}/health`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
    console.log('GLM-OCR server reachable ✓\n');
  } catch (e) {
    console.error(`Cannot reach GLM-OCR at ${GLM_HOST}:${GLM_PORT}: ${e.message}`);
    process.exit(1);
  }

  // Get docs that already have extracted_text (for comparison)
  let query = supabase
    .from('document_index')
    .select('id, bucket, r2_key, filename, file_type, file_size, extracted_text')
    .eq('file_type', 'pdf')
    .not('extracted_text', 'is', null)
    .order('file_size', { ascending: true })
    .limit(LIMIT);

  if (BUCKET_FILTER) query = query.eq('bucket', BUCKET_FILTER);

  const { data: docs, error } = await query;
  if (error) { console.error(`Query error: ${error.message}`); process.exit(1); }

  console.log(`Found ${docs.length} documents with existing text to compare\n`);
  if (docs.length === 0) return;

  const results = [];
  let glmWins = 0, existingWins = 0, ties = 0, errors = 0;

  // Process sequentially to avoid overwhelming Alpuca
  for (let i = 0; i < docs.length; i++) {
    const r = await compareDocument(docs[i]);
    results.push(r);

    if (r.error) { errors++; }
    else if (r.winner === 'glm') { glmWins++; }
    else if (r.winner === 'existing') { existingWins++; }
    else { ties++; }

    if ((i + 1) % 10 === 0 || i === docs.length - 1) {
      const done = i + 1;
      const successResults = results.filter(r => !r.error);
      const avgTime = successResults.length > 0
        ? (successResults.reduce((s, r) => s + r.elapsed, 0) / successResults.length).toFixed(1)
        : '?';
      console.log(`\n  --- Progress: ${done}/${docs.length} | 🟢GLM:${glmWins} 🔴Old:${existingWins} ⚪Tie:${ties} ✗Err:${errors} | avg ${avgTime}s/doc ---\n`);
    }
  }

  // Summary
  const successResults = results.filter(r => !r.error);
  const avgJaccard = successResults.length > 0
    ? (successResults.reduce((s, r) => s + r.scores.jaccard, 0) / successResults.length).toFixed(4)
    : 0;
  const avgFieldDiff = successResults.length > 0
    ? (successResults.reduce((s, r) => s + r.scores.field_diff, 0) / successResults.length).toFixed(1)
    : 0;

  const report = {
    timestamp: new Date().toISOString(),
    total: docs.length,
    compared: successResults.length,
    errors,
    summary: {
      glm_wins: glmWins,
      existing_wins: existingWins,
      ties,
      avg_jaccard: parseFloat(avgJaccard),
      avg_field_improvement: parseFloat(avgFieldDiff),
    },
    results,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`COMPARISON COMPLETE`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Documents compared: ${successResults.length}/${docs.length}`);
  console.log(`Errors:             ${errors}`);
  console.log(`🟢 GLM-OCR wins:    ${glmWins} (${(glmWins/successResults.length*100).toFixed(0)}%)`);
  console.log(`🔴 Existing wins:   ${existingWins} (${(existingWins/successResults.length*100).toFixed(0)}%)`);
  console.log(`⚪ Ties:            ${ties} (${(ties/successResults.length*100).toFixed(0)}%)`);
  console.log(`Avg Jaccard:        ${avgJaccard}`);
  console.log(`Avg field improvement: ${avgFieldDiff > 0 ? '+' : ''}${avgFieldDiff} fields/doc`);
  console.log(`Report saved to:    ${OUTPUT_FILE}`);
}

main().catch(console.error);
