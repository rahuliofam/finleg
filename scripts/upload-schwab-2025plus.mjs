#!/usr/bin/env node
/**
 * One-shot uploader for the "SchwabStatements2025plus" folder.
 *
 * Mix of SubTrust Trad IRA 2025-2026 monthly statements + 1099s for the
 * whole family. Routes by the 3-digit suffix before .PDF.
 *
 * Source: /Users/rahulio/Documents/CodingProjects/noncode/FinlegAssets/SchwabStatements2025plus/
 *
 * Usage:
 *   node scripts/upload-schwab-2025plus.mjs --dry-run
 *   node scripts/upload-schwab-2025plus.mjs
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
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) { console.error('Missing R2 creds'); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SRC = '/Users/rahulio/Documents/CodingProjects/noncode/FinlegAssets/SchwabStatements2025plus';
const DRY_RUN = process.argv.includes('--dry-run');
const PARALLEL = 6;

// suffix → account metadata
// tax prefix uses a per-holder folder for 1099s; statement prefix is per-account
const ACCOUNTS = {
  '403': { acctNum: '6448-3403', name: 'SubTrust Trad IRA',          type: 'ira',       holder: 'SubTrust', stmtPrefix: 'brokerage/schwab-subtrust-trad-ira-403', taxPrefix: 'taxes/2025/subtrust' },
  '028': { acctNum: '7320-2028', name: 'CS Brokerage',               type: 'brokerage', holder: 'Subhash',  stmtPrefix: 'brokerage/schwab-brokerage-2028',         taxPrefix: 'taxes/2025/sonnad-subhash' },
  '151': { acctNum: '9729-7151', name: 'Emina Brokerage',            type: 'brokerage', holder: 'Emina',    stmtPrefix: 'brokerage/schwab-emina-brokerage-151',    taxPrefix: 'taxes/2025/sonnad-emina' },
  '192': { acctNum: '5306-2192', name: 'Rahul Trading',              type: 'brokerage', holder: 'Rahul',    stmtPrefix: 'brokerage/schwab-rahul-trading-192',      taxPrefix: 'taxes/2025/sonnad-rahul' },
  '566': { acctNum: '6434-0566', name: 'Rahul Brokerage',            type: 'brokerage', holder: 'Rahul',    stmtPrefix: 'brokerage/schwab-rahul-brokerage-566',    taxPrefix: 'taxes/2025/sonnad-rahul' },
  '708': { acctNum: '3664-4708', name: 'Kathy Brokerage',            type: 'brokerage', holder: 'Kathy',    stmtPrefix: 'brokerage/schwab-kathy-brokerage-708',    taxPrefix: 'taxes/2025/sonnad-kathy' },
  '830': { acctNum: '5416-8830', name: 'Hannah Brokerage',           type: 'brokerage', holder: 'Hannah',   stmtPrefix: 'brokerage/schwab-hannah-brokerage-830',   taxPrefix: 'taxes/2025/sonnad-hannah' },
  '681': { acctNum: '1865-5681', name: 'Kathy Inh IRA (Bene Subhash)', type: 'ira',     holder: 'Kathy',    stmtPrefix: 'brokerage/schwab-kathy-inh-ira-681',      taxPrefix: 'taxes/2025/sonnad-kathy' },
  '692': { acctNum: '7545-7692', name: 'Haydn Inh Trad IRA',         type: 'ira',       holder: 'Haydn',    stmtPrefix: 'brokerage/schwab-haydn-inh-trad-ira-692', taxPrefix: 'taxes/2025/sonnad-haydn' },
  '843': { acctNum: '6602-1843', name: 'Kathy Trad IRA',             type: 'ira',       holder: 'Kathy',    stmtPrefix: 'brokerage/schwab-kathy-trad-ira-843',     taxPrefix: 'taxes/2025/sonnad-kathy' },
};

function classify(filename) {
  const suffixMatch = filename.match(/_(\d{3})(?:-\d+)?\.PDF$/i);
  if (!suffixMatch) return null;
  const suffix = suffixMatch[1];
  const acct = ACCOUNTS[suffix];
  if (!acct) return null;

  const is1099R  = /^1099R/i.test(filename);
  const is1099   = /^1099\b/i.test(filename) || /^1099 Composite/i.test(filename);
  const isStmt   = /^Brokerage Statement/i.test(filename);

  // date from filename (statements: period end; 1099R: date filename; 1099: optional)
  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  let statementDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  let year  = dateMatch ? parseInt(dateMatch[1]) : null;
  let month = dateMatch ? parseInt(dateMatch[2]) : null;

  // tax year detection: "1099R - 2024" vs "1099R - 2025"
  const taxYearMatch = filename.match(/1099R?\s*-\s*(\d{4})/i) || filename.match(/1099[^0-9]*(\d{4})/);
  const taxYear = taxYearMatch ? parseInt(taxYearMatch[1]) : null;

  let category, accountType, bucket, r2Prefix;
  if (is1099R) {
    category    = 'tax';
    accountType = 'tax-1099r';
    bucket      = 'bookkeeping-docs';
    r2Prefix    = acct.taxPrefix;
    if (taxYear) { year = taxYear; month = null; statementDate = null; }
  } else if (is1099) {
    category    = 'tax';
    accountType = 'tax-1099';
    bucket      = 'bookkeeping-docs';
    r2Prefix    = acct.taxPrefix;
    if (!year && taxYear) year = taxYear;
    if (taxYear) { year = taxYear; }
  } else if (isStmt) {
    category    = 'statement';
    accountType = acct.type;
    bucket      = 'financial-statements';
    r2Prefix    = acct.stmtPrefix;
  } else {
    return null;
  }

  return {
    suffix, bucket, r2Prefix, category, accountType,
    institution:   'charles-schwab',
    accountName:   acct.name,
    accountNumber: acct.acctNum,
    accountHolder: acct.holder,
    statementDate, year, month,
  };
}

async function uploadOne(file) {
  const filename = basename(file.fullPath);
  const c = classify(filename);
  if (!c) return { success: false, filename, error: 'no routing match' };

  const r2Key = `${c.r2Prefix}/${filename}`;
  const ext = extname(filename).slice(1).toLowerCase() || 'pdf';

  const row = {
    bucket: c.bucket,
    r2_key: r2Key,
    filename,
    file_type: ext,
    file_size: file.size,
    content_type: 'application/pdf',
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
    console.log(`[DRY] ${c.bucket}/${r2Key}  →  ${c.accountName} (${c.accountType}) ${c.statementDate || c.year || ''} holder=${c.accountHolder}`);
    return { success: true, row, dryRun: true };
  }

  try {
    const body = readFileSync(file.fullPath);
    await s3.send(new PutObjectCommand({ Bucket: c.bucket, Key: r2Key, Body: body, ContentType: 'application/pdf' }));
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
    .map(n => { const fullPath = join(SRC, n); return { fullPath, size: statSync(fullPath).size }; });

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
      if (r.success) { uploaded++; if (!r.dryRun) rowsToInsert.push(r.row); }
      else { failed++; console.error(`FAIL ${r.filename}: ${r.error}`); }
    }
    console.log(`Progress: ${uploaded + failed}/${files.length}`);
  }

  if (!DRY_RUN && rowsToInsert.length) {
    console.log(`Indexing ${rowsToInsert.length} rows in document_index...`);
    const { error } = await supabase.from('document_index').upsert(rowsToInsert, { onConflict: 'r2_key' });
    if (error) { console.error(`Supabase error: ${error.message}`); process.exit(1); }
  }

  console.log(`\n=== COMPLETE ===\nUploaded: ${uploaded}\nFailed:   ${failed}\nTotal:    ${files.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
