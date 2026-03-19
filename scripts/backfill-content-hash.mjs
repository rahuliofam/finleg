#!/usr/bin/env node
/**
 * Backfill SHA-256 content_hash for existing document_index and statement_inbox rows.
 * Downloads each file from R2 (document_index) or Supabase Storage (statement_inbox),
 * computes SHA-256, and updates the row.
 *
 * Usage:
 *   node scripts/backfill-content-hash.mjs [--dry-run] [--limit=N] [--table=document_index|statement_inbox]
 *
 * Run on Hostinger VPS for the 2,400+ document_index files.
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { config } from 'dotenv';

config();

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const s3 = (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    })
  : null;

// ── CLI args ──
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 99999;
const TABLE_FILTER = process.argv.find(a => a.startsWith('--table='))?.split('=')[1] || null;
const BATCH_SIZE = 50; // rows per Supabase query page
const CONCURRENCY = 5; // parallel downloads

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// ── Download from R2 ──
async function downloadFromR2(bucket, r2Key) {
  if (!s3) throw new Error('R2 credentials not configured');
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: r2Key });
  const resp = await s3.send(cmd);
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── Download from Supabase Storage ──
async function downloadFromStorage(attachmentUrl) {
  // attachment_url is the full public URL from Supabase Storage
  const resp = await fetch(attachmentUrl);
  if (!resp.ok) throw new Error(`Storage download failed: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Backfill document_index ──
async function backfillDocumentIndex() {
  console.log('\n=== Backfilling document_index ===');
  let offset = 0;
  let updated = 0;
  let errors = 0;
  let skipped = 0;

  while (updated + errors + skipped < LIMIT) {
    const { data: rows, error } = await supabase
      .from('document_index')
      .select('id, bucket, r2_key, filename')
      .is('content_hash', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) { console.error('Query error:', error); break; }
    if (!rows || rows.length === 0) break;

    // Process in parallel batches
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(async (row) => {
        try {
          const fileBytes = await downloadFromR2(row.bucket, row.r2_key);
          const hash = sha256(fileBytes);

          if (DRY_RUN) {
            console.log(`  [DRY] ${row.filename} → ${hash.slice(0, 16)}...`);
            return 'dry';
          }

          const { error: updateErr } = await supabase
            .from('document_index')
            .update({ content_hash: hash })
            .eq('id', row.id);

          if (updateErr) {
            // Likely a duplicate hash collision
            if (updateErr.code === '23505') {
              console.log(`  DUPLICATE: ${row.filename} (${row.r2_key}) — hash matches another row`);
              return 'skip';
            }
            throw updateErr;
          }
          return 'ok';
        } catch (err) {
          console.error(`  ERROR: ${row.filename} — ${err.message}`);
          return 'error';
        }
      }));

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value === 'ok' || r.value === 'dry') updated++;
          else if (r.value === 'skip') skipped++;
          else errors++;
        } else {
          errors++;
        }
      }

      if ((updated + errors + skipped) % 100 === 0 && updated > 0) {
        console.log(`  Progress: ${updated} updated, ${skipped} dupes, ${errors} errors`);
      }
    }

    // If we got a full page, there might be more — but since we filter on content_hash IS NULL,
    // successfully updated rows won't appear again, so keep offset at 0
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`document_index: ${updated} updated, ${skipped} duplicates, ${errors} errors`);
  return { updated, skipped, errors };
}

// ── Backfill statement_inbox ──
async function backfillStatementInbox() {
  console.log('\n=== Backfilling statement_inbox ===');
  let updated = 0;
  let errors = 0;

  const { data: rows, error } = await supabase
    .from('statement_inbox')
    .select('id, attachment_url, attachment_filename')
    .is('content_hash', null);

  if (error) { console.error('Query error:', error); return { updated: 0, errors: 1 }; }
  if (!rows || rows.length === 0) {
    console.log('  No rows to backfill');
    return { updated: 0, errors: 0 };
  }

  for (const row of rows) {
    try {
      const fileBytes = await downloadFromStorage(row.attachment_url);
      const hash = sha256(fileBytes);

      if (DRY_RUN) {
        console.log(`  [DRY] ${row.attachment_filename} → ${hash.slice(0, 16)}...`);
        updated++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from('statement_inbox')
        .update({ content_hash: hash })
        .eq('id', row.id);

      if (updateErr) throw updateErr;
      updated++;
    } catch (err) {
      console.error(`  ERROR: ${row.attachment_filename} — ${err.message}`);
      errors++;
    }
  }

  console.log(`statement_inbox: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

// ── Main ──
async function main() {
  console.log(`Content hash backfill${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Limit: ${LIMIT}, Concurrency: ${CONCURRENCY}`);

  const results = {};

  if (!TABLE_FILTER || TABLE_FILTER === 'statement_inbox') {
    results.inbox = await backfillStatementInbox();
  }
  if (!TABLE_FILTER || TABLE_FILTER === 'document_index') {
    if (!s3) {
      console.error('\nSkipping document_index — R2 credentials not configured');
    } else {
      results.docIndex = await backfillDocumentIndex();
    }
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
