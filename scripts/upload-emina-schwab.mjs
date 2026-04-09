#!/usr/bin/env node
/**
 * One-shot uploader for the "Emina Schwab Tax 2025" folder.
 *
 * Folder owner is Emina (she handles the tax docs) but the underlying accounts
 * span three different holders per the Family Banking & Brokerage doc:
 *
 *   151 → Emina Brokerage      (9729-7151)  brokerage  holder=Emina
 *   028 → Subhash Brokerage    (7320-2028)  brokerage  holder=Subhash
 *   403 → SubTrust Trad IRA    (6448-3403)  ira        holder=SubTrust
 *
 * Source: /Users/rahulio/Documents/CodingProjects/noncode/FinlegAssets/Emina Schwab Tax 2025/
 * Action: upload PDFs to R2 + insert document_index rows.
 *
 * Usage:
 *   node scripts/upload-emina-schwab.mjs            # live upload
 *   node scripts/upload-emina-schwab.mjs --dry-run  # print plan only
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { config } from 'dotenv';

config();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) { console.error('Missing R2 credentials in .env'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const SRC = '/Users/rahulio/Documents/CodingProjects/noncode/FinlegAssets/Emina Schwab Tax 2025';
const DRY_RUN = process.argv.includes('--dry-run');
const PARALLEL = 6;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const ACCOUNTS = {
  '151': {
    statementBucket:  'financial-statements',
    statementPrefix:  'brokerage/schwab-emina-brokerage-151',
    taxBucket:        'bookkeeping-docs',
    taxPrefix:        'taxes/2025/sonnad-emina',
    accountType:      'brokerage',
    institution:      'charles-schwab',
    accountName:      'Emina Brokerage',
    accountNumber:    '9729-7151',
    accountHolder:    'Emina',
  },
  '028': {
    statementBucket:  'financial-statements',
    statementPrefix:  'brokerage/schwab-brokerage-2028',  // matches existing CS Brokerage (2028)
    taxBucket:        'bookkeeping-docs',
    taxPrefix:        'taxes/2025/sonnad-subhash',
    accountType:      'brokerage',
    institution:      'charles-schwab',
    accountName:      'CS Brokerage',
    accountNumber:    '7320-2028',
    accountHolder:    'Subhash',
  },
  '403': {
    statementBucket:  'financial-statements',
    statementPrefix:  'brokerage/schwab-subtrust-trad-ira-403',
    taxBucket:        'bookkeeping-docs',
    taxPrefix:        'taxes/2025/subtrust',
    accountType:      'ira',
    institution:      'charles-schwab',
    accountName:      'SubTrust Trad IRA',
    accountNumber:    '6448-3403',
    accountHolder:    'SubTrust',
  },
};

// Filename forms in this folder:
//   Brokerage Statement_2025-01-31_151.PDF                                    → statement
//   1099 Composite and Year-End Summary - 2025_151.PDF                        → 1099 (no date)
//   1099 Composite and Year-End Summary - 2025_2026-02-06_151.PDF             → 1099 (dated)
//   1099 Composite and Year-End Summary - 2025_028.PDF                        → 1099
//   1099R - 2025_403.PDF                                                      → 1099-R
function classify(filename) {
  // suffix is the trailing 3 digits before extension (and before any " (n)")
  const suffixMatch = filename.match(/_(\d{3})(?:\s*\(\d+\))?\.PDF$/i);
  if (!suffixMatch) return null;
  const suffix = suffixMatch[1];
  const account = ACCOUNTS[suffix];
  if (!account) return null;

  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  let statementDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  let year = dateMatch ? parseInt(dateMatch[1]) : null;
  let month = dateMatch ? parseInt(dateMatch[2]) : null;

  const is1099 = /^1099/i.test(filename);
  const is1099R = /^1099R/i.test(filename);

  // For tax docs that have no date in the filename, fall back to tax year 2025
  if (is1099 && !year) year = 2025;

  const category = is1099 ? 'tax' : 'statement';
  const accountType = is1099R ? 'tax-1099r' : (is1099 ? 'tax-1099' : account.accountType);
  const bucket = is1099 ? account.taxBucket : account.statementBucket;
  const r2Prefix = is1099 ? account.taxPrefix : account.statementPrefix;

  return {
    suffix,
    bucket,
    r2Prefix,
    category,
    accountType,
    institution: account.institution,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    accountHolder: account.accountHolder,
    statementDate,
    year,
    month,
  };
}

async function uploadOne(file) {
  const filename = basename(file.fullPath);
  const c = classify(filename);
  if (!c) return { success: false, filename, error: 'no routing match' };

  const r2Key = `${c.r2Prefix}/${filename}`;
  const ext = extname(filename).slice(1).toLowerCase();
  const contentType = 'application/pdf';

  const row = {
    bucket: c.bucket,
    r2_key: r2Key,
    filename,
    file_type: ext || 'pdf',
    file_size: file.size,
    content_type: contentType,
    category: c.category,
    account_type: c.accountType,
    institution: c.institution,
    account_name: c.accountName,
    account_number: c.accountNumber,
    account_holder: c.accountHolder,
    year: c.year,
    month: c.month,
    statement_date: c.statementDate,
    is_closed: false,
    property: null,
    convertible: false,
    original_path: filename,
  };

  if (DRY_RUN) {
    console.log(`[DRY] ${c.bucket}/${r2Key}  →  ${c.accountName} (${c.accountType}) ${c.statementDate || c.year || ''}  holder=${c.accountHolder}`);
    return { success: true, row, dryRun: true };
  }

  try {
    const body = readFileSync(file.fullPath);
    await s3.send(new PutObjectCommand({
      Bucket: c.bucket,
      Key: r2Key,
      Body: body,
      ContentType: contentType,
    }));
    return { success: true, row };
  } catch (e) {
    return { success: false, filename, error: (e.message || '').slice(0, 200) };
  }
}

async function main() {
  console.log(`[START] ${SRC}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Parallel: ${PARALLEL}`);

  const files = readdirSync(SRC)
    .filter(n => !n.startsWith('.') && /\.pdf$/i.test(n))
    .map(n => {
      const fullPath = join(SRC, n);
      return { fullPath, size: statSync(fullPath).size };
    });

  console.log(`Found ${files.length} PDFs`);

  const unrouted = files.filter(f => !classify(basename(f.fullPath)));
  if (unrouted.length) {
    console.error('Unrouted files:');
    for (const f of unrouted) console.error(`  - ${basename(f.fullPath)}`);
    process.exit(1);
  }

  let uploaded = 0, failed = 0;
  const rowsToInsert = [];

  for (let i = 0; i < files.length; i += PARALLEL) {
    const batch = files.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(uploadOne));
    for (const r of results) {
      if (r.success) {
        uploaded++;
        if (!r.dryRun) rowsToInsert.push(r.row);
      } else {
        failed++;
        console.error(`FAIL ${r.filename}: ${r.error}`);
      }
    }
    console.log(`Progress: ${uploaded + failed}/${files.length}`);
  }

  if (!DRY_RUN && rowsToInsert.length) {
    console.log(`Indexing ${rowsToInsert.length} rows in document_index...`);
    const { error } = await supabase.from('document_index').upsert(rowsToInsert, { onConflict: 'r2_key' });
    if (error) {
      console.error(`Supabase error: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Failed:   ${failed}`);
  console.log(`Total:    ${files.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
