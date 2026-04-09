#!/usr/bin/env node
/**
 * One-shot uploader for Hannah's Schwab statements.
 *
 * Source:  /Users/rahulio/Documents/CodingProjects/noncode/FinlegAssets/Hannah Schwab Statements/
 * Action:  upload PDFs to Cloudflare R2 + insert document_index rows in Supabase.
 *
 * No directory scan / no sync — operates on a fixed file list.
 *
 * Usage:
 *   node scripts/upload-hannah-schwab.mjs              # live upload
 *   node scripts/upload-hannah-schwab.mjs --dry-run    # print plan only
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

const SRC = '/Users/rahulio/Documents/CodingProjects/noncode/FinlegAssets/Hannah Schwab Statements';
const DRY_RUN = process.argv.includes('--dry-run');
const PARALLEL = 6;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Account map (suffix → routing) ─────────────────────────────────────────
// Source of truth: FinlegAssets/AI Financial/Family Banking and Brokerage Account #'s - Schwab etc....md
const ACCOUNTS = {
  '170': { bucket: 'financial-statements', r2Prefix: 'brokerage/schwab-hannah-roth-ira-170',     accountType: 'ira',      institution: 'charles-schwab', accountName: 'Hannah Roth IRA',           accountNumber: '3326-5170',     accountHolder: 'Hannah' },
  '342': { bucket: 'financial-statements', r2Prefix: 'brokerage/schwab-hannah-roth-trust-342',   accountType: 'trust',    institution: 'charles-schwab', accountName: 'Hannah Roth Trust',         accountNumber: '3781-9342',     accountHolder: 'Hannah' },
  '362': { bucket: 'financial-statements', r2Prefix: 'brokerage/schwab-hannah-solo-401k-362',    accountType: 'ira',      institution: 'charles-schwab', accountName: 'Hannah Solo 401k',          accountNumber: '362',           accountHolder: 'Hannah' },
  '518': { bucket: 'financial-statements', r2Prefix: 'bank-accounts/schwab-hannah-bank-518',     accountType: 'checking', institution: 'charles-schwab', accountName: 'Hannah Bank',               accountNumber: '4400-32366518', accountHolder: 'Hannah' },
  '568': { bucket: 'financial-statements', r2Prefix: 'brokerage/schwab-hannah-inh-trad-ira-568', accountType: 'ira',      institution: 'charles-schwab', accountName: 'Hannah Inherited Trad IRA', accountNumber: '8208-3568',     accountHolder: 'Hannah' },
  '830': { bucket: 'financial-statements', r2Prefix: 'brokerage/schwab-hannah-brokerage-830',    accountType: 'brokerage',institution: 'charles-schwab', accountName: 'Hannah Brokerage',          accountNumber: '5416-8830',     accountHolder: 'Hannah' },
};

const CONTENT_TYPES = { pdf: 'application/pdf' };

// Filename forms:
//   Bank Statement_2026-01-30_518.PDF
//   Brokerage Statement_2026-03-31_362.PDF
//   1099 Composite and Year-End Summary - 2025_2026-02-06_830 (1).PDF
function classify(filename) {
  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  const statementDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  const year = dateMatch ? parseInt(dateMatch[1]) : null;
  const month = dateMatch ? parseInt(dateMatch[2]) : null;

  // Suffix is the 3-digit account id immediately before the optional " (n)" and extension
  const suffixMatch = filename.match(/_(\d{3})(?:\s*\(\d+\))?\.PDF$/i);
  if (!suffixMatch) return null;
  const suffix = suffixMatch[1];
  const account = ACCOUNTS[suffix];
  if (!account) return null;

  const is1099 = /^1099/i.test(filename);
  const category = is1099 ? 'tax' : 'statement';
  // For 1099, override bucket + prefix to land alongside other tax docs
  const bucket = is1099 ? 'bookkeeping-docs' : account.bucket;
  const r2Prefix = is1099
    ? `taxes/2025/sonnad-hannah`
    : account.r2Prefix;
  const accountType = is1099 ? 'tax-1099' : account.accountType;

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
  const contentType = CONTENT_TYPES[ext] || 'application/pdf';

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
    console.log(`[DRY] ${c.bucket}/${r2Key}  →  ${c.accountName} (${c.accountType}) ${c.statementDate || ''}`);
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

  // Validate every file routes before any upload
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
