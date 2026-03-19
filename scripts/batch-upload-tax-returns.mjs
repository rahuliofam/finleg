#!/usr/bin/env node
/**
 * batch-upload-tax-returns.mjs
 *
 * Uploads local tax return PDFs to Supabase Storage, inserts statement_inbox rows,
 * and triggers Hostinger processing. Skips duplicates via content hash.
 * No external deps — uses native fetch + crypto.
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/batch-upload-tax-returns.mjs "/path/to/folder"
 *        SUPABASE_SERVICE_ROLE_KEY=... node scripts/batch-upload-tax-returns.mjs "/path/to/folder" --dry-run
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HOSTINGER_TRIGGER_URL = process.env.HOSTINGER_TRIGGER_URL || 'https://alpaclaw.cloud/finleg-trigger';
const HOSTINGER_TRIGGER_SECRET = process.env.HOSTINGER_TRIGGER_SECRET;

if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const dryRun = process.argv.includes('--dry-run');
const folder = process.argv.filter(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1])[0];

if (!folder) {
  console.error('Usage: node scripts/batch-upload-tax-returns.mjs "/path/to/folder" [--dry-run]');
  process.exit(1);
}

// Parse filename like "2023 Tax Return Documents (Sonnad Rahul).pdf"
function parseFilename(filename) {
  let m = filename.match(/^(\d{4})\s+Tax Return Documents?\s+\((.+?)\)\.pdf$/i);
  if (m) {
    const isTrust = /\b(tr|trust|estate)\b/i.test(m[2]);
    return { taxYear: parseInt(m[1]), entityName: m[2], returnType: isTrust ? '1041' : '1040', isVoucher: false };
  }

  m = filename.match(/^(\d{4})\s+Tax Return Extended\s+\((.+?)\)\.pdf$/i);
  if (m) return { taxYear: parseInt(m[1]), entityName: m[2], returnType: '1040', isVoucher: false };

  m = filename.match(/^(\d{4})\s+(1040V|1041V)\s+\((.+?)\)\.pdf$/i);
  if (m) return { taxYear: parseInt(m[1]), entityName: m[3], returnType: m[2].toUpperCase(), isVoucher: true };

  return null;
}

// "Sonnad Rahul" -> "Rahul Sonnad"
function normalizeEntityName(raw) {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  return raw.trim();
}

async function supabaseRest(method, table, params = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (params.query) url += `?${params.query}`;
  const res = await fetch(url, {
    method,
    headers: { ...headers, ...(params.extraHeaders || {}) },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  const data = await res.json();
  return { data, status: res.status, ok: res.ok };
}

async function uploadStorage(path, fileData) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/statements/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'false',
    },
    body: fileData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage upload failed (${res.status}): ${err}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/statements/${path}`;
}

async function main() {
  const files = readdirSync(folder)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  Batch Tax Return Upload                 ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`Folder: ${folder}`);
  console.log(`Files: ${files.length}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  let uploaded = 0, skippedDup = 0, skippedVoucher = 0, errors = 0;

  for (const file of files) {
    const filepath = join(folder, file);
    const parsed = parseFilename(file);

    if (!parsed) {
      console.log(`  ? Skipping (unrecognized format): ${file}`);
      errors++;
      continue;
    }

    if (parsed.isVoucher) {
      console.log(`  - Skipping voucher: ${file} (${parsed.returnType})`);
      skippedVoucher++;
      continue;
    }

    const entityName = normalizeEntityName(parsed.entityName);
    const stat = statSync(filepath);
    const fileData = readFileSync(filepath);
    const contentHash = createHash('sha256').update(fileData).digest('hex');

    console.log(`  > ${file}`);
    console.log(`    Entity: ${entityName} | Year: ${parsed.taxYear} | Size: ${(stat.size / 1024).toFixed(0)} KB | Hash: ${contentHash.slice(0, 12)}...`);

    // Check for duplicate
    const { data: existing } = await supabaseRest('GET', 'statement_inbox', {
      query: `content_hash=eq.${contentHash}&select=id,attachment_filename,status&limit=1`,
    });

    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`    x Duplicate of ${existing[0].attachment_filename} (${existing[0].status}) -- skipping`);
      skippedDup++;
      continue;
    }

    if (dryRun) {
      console.log(`    [DRY RUN] Would upload and insert`);
      uploaded++;
      continue;
    }

    // Upload to Storage
    const storagePath = `inbox/${Date.now()}_tax-returns/${file}`;
    let attachmentUrl;
    try {
      attachmentUrl = await uploadStorage(storagePath, fileData);
    } catch (e) {
      console.error(`    x Upload failed: ${e.message}`);
      errors++;
      continue;
    }

    // Insert inbox row
    const inboxRow = {
      from_address: 'batch-upload@finleg.net',
      subject: `Batch upload: ${file}`,
      received_at: new Date().toISOString(),
      attachment_filename: file,
      attachment_url: attachmentUrl,
      attachment_size: stat.size,
      doc_type: 'tax_return',
      institution: 'irs',
      content_hash: contentHash,
      account_type: parsed.returnType === '1040' ? '1040' : parsed.returnType,
      account_name: entityName,
      account_holder: entityName,
      statement_date: `${parsed.taxYear}-12-31`,
      classification_confidence: 1.0,
      classification_raw: { source: 'batch-upload', filename: file },
      status: 'pending',
    };

    const { data: inserted, ok } = await supabaseRest('POST', 'statement_inbox', {
      body: inboxRow,
      query: 'select=id',
    });

    if (!ok || !Array.isArray(inserted) || inserted.length === 0) {
      console.error(`    x Insert failed:`, JSON.stringify(inserted));
      errors++;
      continue;
    }

    console.log(`    OK Uploaded & queued (inbox: ${inserted[0].id})`);
    uploaded++;
  }

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Duplicate: ${skippedDup}`);
  console.log(`  Vouchers skipped: ${skippedVoucher}`);
  console.log(`  Errors: ${errors}`);
  console.log(`══════════════════════════════════════════\n`);

  // Trigger Hostinger
  if (uploaded > 0 && !dryRun && HOSTINGER_TRIGGER_SECRET) {
    console.log('Triggering Hostinger processing...');
    try {
      const res = await fetch(`${HOSTINGER_TRIGGER_URL}/process-tax-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-trigger-secret': HOSTINGER_TRIGGER_SECRET },
        body: JSON.stringify({ source: 'batch-upload', count: uploaded }),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`  Trigger response: ${res.status}`);
    } catch (e) {
      console.log(`  Trigger sent (fire-and-forget)`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
