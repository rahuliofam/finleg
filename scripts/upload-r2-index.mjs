#!/usr/bin/env node
/**
 * Upload accounting files to Cloudflare R2 (parallel) and index in Supabase.
 *
 * Usage: node scripts/upload-r2-index.mjs [--dry-run] [--skip-existing]
 */

import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { promisify } from 'util';
import { config } from 'dotenv';

config(); // Load .env

const execAsync = promisify(exec);

const SRC = '/Users/rahulio/Documents/CodingProjects/noncode/Finleg/AI Financial/Current Sonnad Accounting Files - Amanda 2022+';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');
const PARALLEL = 10; // concurrent uploads

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',
  htm: 'text/html', html: 'text/html',
  zip: 'application/zip',
  msg: 'application/vnd.ms-outlook',
};

function getRouting(relpath) {
  const topDir = relpath.split('/')[0];
  const result = {
    bucket: 'financial-statements',
    r2Prefix: '',
    category: '',
    accountType: '',
    institution: '',
    accountName: '',
    accountNumber: '',
    accountHolder: '',
    isClosed: false,
    property: null,
    convertible: false,
  };

  const routes = [
    [/^Amex Blue Preferred \(24006\)/, { r2Prefix: 'credit-cards/amex-blue-preferred-24006', category: 'statement', accountType: 'credit-card', institution: 'amex', accountName: 'Amex Blue Preferred', accountNumber: '24006', accountHolder: 'Rahul' }],
    [/^Amex Blue Business \(11003\)/, { r2Prefix: 'credit-cards/amex-blue-business-11003', category: 'statement', accountType: 'credit-card', institution: 'amex', accountName: 'Amex Blue Business', accountNumber: '11003', accountHolder: 'Rahul' }],
    [/^Apple Card \(2202\)/, { r2Prefix: 'credit-cards/apple-card-2202', category: 'statement', accountType: 'credit-card', institution: 'apple', accountName: 'Apple Card', accountNumber: '2202', accountHolder: 'Rahul' }],
    [/^Chase Amazon CC \(4206\)/, { r2Prefix: 'credit-cards/chase-amazon-cc-4206', category: 'statement', accountType: 'credit-card', institution: 'chase', accountName: 'Chase Amazon CC', accountNumber: '4206', accountHolder: 'Rahul' }],
    [/^Chase Visa CC \(7191\)/, { r2Prefix: 'credit-cards/chase-visa-cc-7191', category: 'statement', accountType: 'credit-card', institution: 'chase', accountName: 'Chase Visa CC', accountNumber: '7191', accountHolder: 'Subhash' }],
    [/^Bank of America CC \(6420\)/, { r2Prefix: 'credit-cards/boa-cc-6420', category: 'statement', accountType: 'credit-card', institution: 'bank-of-america', accountName: 'Bank of America CC', accountNumber: '6420', accountHolder: 'Subhash' }],
    [/^Robinhood Gold Card \(3892\)/, { r2Prefix: 'credit-cards/robinhood-gold-card-3892', category: 'statement', accountType: 'credit-card', institution: 'robinhood', accountName: 'Robinhood Gold Card', accountNumber: '3892', accountHolder: 'Rahul' }],
    [/^Robinhood Gold Card \(6868\)/, { r2Prefix: 'credit-cards/robinhood-gold-card-6868', category: 'statement', accountType: 'credit-card', institution: 'robinhood', accountName: 'Robinhood Gold Card', accountNumber: '6868', accountHolder: 'Rahul' }],
    [/^Robinhood Checking \(2074\)/, { r2Prefix: 'bank-accounts/robinhood-checking-2074', category: 'statement', accountType: 'checking', institution: 'robinhood', accountName: 'Robinhood Checking', accountNumber: '2074', accountHolder: 'Rahul' }],
    [/^CS Checking \(3711\)/, { r2Prefix: 'bank-accounts/schwab-checking-3711', category: 'statement', accountType: 'checking', institution: 'charles-schwab', accountName: 'CS Checking', accountNumber: '3711', accountHolder: 'Rahul' }],
    [/^US Bank \(7444\)/, { r2Prefix: 'bank-accounts/us-bank-checking-7444', category: 'statement', accountType: 'checking', institution: 'us-bank', accountName: 'US Bank Checking', accountNumber: '7444', accountHolder: 'Rahul' }],
    [/^Cash App/, { r2Prefix: 'bank-accounts/cash-app', category: 'statement', accountType: 'payment', institution: 'cash-app', accountName: 'Cash App', accountNumber: '', accountHolder: 'Rahul' }],
    [/^Venmo/, { r2Prefix: 'bank-accounts/venmo', category: 'statement', accountType: 'payment', institution: 'venmo', accountName: 'Venmo', accountNumber: '', accountHolder: 'Rahul' }],
    [/^Paypal/, { r2Prefix: 'bank-accounts/paypal', category: 'statement', accountType: 'payment', institution: 'paypal', accountName: 'PayPal', accountNumber: '', accountHolder: 'Rahul' }],
    [/^CS Brokerage \(0566\)/, { r2Prefix: 'brokerage/schwab-brokerage-0566', category: 'statement', accountType: 'brokerage', institution: 'charles-schwab', accountName: 'CS Brokerage', accountNumber: '0566', accountHolder: 'Rahul' }],
    [/^CS Brokerage \(2028\)/, { r2Prefix: 'brokerage/schwab-brokerage-2028', category: 'statement', accountType: 'brokerage', institution: 'charles-schwab', accountName: 'CS Brokerage', accountNumber: '2028', accountHolder: 'Subhash' }],
    [/^CS Trading \(2192\)/, { r2Prefix: 'brokerage/schwab-trading-2192', category: 'statement', accountType: 'brokerage', institution: 'charles-schwab', accountName: 'CS Trading', accountNumber: '2192', accountHolder: 'Rahul' }],
    [/^CS IRA \(3902\)/, { r2Prefix: 'brokerage/schwab-ira-3902', category: 'statement', accountType: 'ira', institution: 'charles-schwab', accountName: 'CS IRA', accountNumber: '3902', accountHolder: 'Rahul' }],
    [/^CS Trust \(0044\)/, { r2Prefix: 'brokerage/schwab-trust-0044', category: 'statement', accountType: 'trust', institution: 'charles-schwab', accountName: 'CS Trust', accountNumber: '0044', accountHolder: 'Trust' }],
    [/^Coinbase/, { r2Prefix: 'brokerage/coinbase', category: 'statement', accountType: 'crypto', institution: 'coinbase', accountName: 'Coinbase', accountNumber: '', accountHolder: 'Rahul' }],
    [/^Robinhood  - Roth IRA/, { r2Prefix: 'brokerage/robinhood-ira-8249-2310', category: 'statement', accountType: 'ira', institution: 'robinhood', accountName: 'Robinhood Roth IRA & Traditional IRA', accountNumber: '8249/2310', accountHolder: 'Rahul' }],
    [/^Robinhood Consolidated IRA/, { r2Prefix: 'brokerage/robinhood-consolidated-ira', category: 'statement', accountType: 'ira', institution: 'robinhood', accountName: 'Robinhood Consolidated IRA', accountNumber: '', accountHolder: 'Rahul' }],
    [/^PNC Mortgage/, { r2Prefix: 'loans/pnc-mortgage', category: 'statement', accountType: 'mortgage', institution: 'pnc', accountName: 'PNC Mortgage', accountNumber: '', accountHolder: 'Rahul' }],
    [/^US Bank Equity \(9078\)/, { r2Prefix: 'loans/us-bank-equity-9078', category: 'statement', accountType: 'heloc', institution: 'us-bank', accountName: 'US Bank Equity Line', accountNumber: '9078', accountHolder: 'Rahul' }],
    [/^US Bank Overdraft Credit Line \(3784\)/, { r2Prefix: 'loans/us-bank-overdraft-3784', category: 'statement', accountType: 'credit-line', institution: 'us-bank', accountName: 'US Bank Overdraft Credit Line', accountNumber: '3784', accountHolder: 'Rahul' }],
    [/^Auto Loans/, { r2Prefix: 'loans/auto-loans', category: 'statement', accountType: 'auto-loan', institution: 'various', accountName: 'Auto Loans', accountNumber: '', accountHolder: 'Rahul' }],
    [/^SBA Loan 4469264009/, { r2Prefix: 'loans/sba-4469264009-physical-business', category: 'statement', accountType: 'sba-loan', institution: 'sba', accountName: 'SBA Physical Business Disaster Loan', accountNumber: '4469264009', accountHolder: 'Family' }],
    [/^SBA Loan 9663307809/, { r2Prefix: 'loans/sba-9663307809-covid-injury', category: 'statement', accountType: 'sba-loan', institution: 'sba', accountName: 'SBA COVID-19 Economic Injury Loan', accountNumber: '9663307809', accountHolder: 'Tesloop' }],
    [/^Taxes/, { bucket: 'bookkeeping-docs', r2Prefix: 'taxes', category: 'tax', accountType: 'tax', institution: 'irs', accountName: 'Taxes', accountNumber: '', accountHolder: 'Family' }],
    [/^Insurance Policies/, { bucket: 'bookkeeping-docs', r2Prefix: 'insurance', category: 'insurance', accountType: 'insurance', institution: 'various', accountName: 'Insurance Policies', accountNumber: '', accountHolder: 'Family' }],
    [/^AAP/, { bucket: 'bookkeeping-docs', r2Prefix: 'property/alpaca-playhouse', category: 'property-expense', accountType: 'property', institution: 'various', accountName: 'Alpaca Playhouse', accountNumber: '', accountHolder: 'Family', property: 'alpaca-playhouse' }],
    [/^WA House/, { bucket: 'bookkeeping-docs', r2Prefix: 'property/wa-sharingwood', category: 'property-expense', accountType: 'property', institution: 'various', accountName: 'WA Sharingwood House', accountNumber: '', accountHolder: 'Family', property: 'wa-sharingwood' }],
    [/^Rahul.*Credit/, { bucket: 'bookkeeping-docs', r2Prefix: 'credit-reports', category: 'credit-report', accountType: 'credit-report', institution: 'various', accountName: 'Rahul Credit Reports', accountNumber: '', accountHolder: 'Rahul' }],
    [/^X Closed Accounts/, { r2Prefix: 'closed-accounts', category: 'statement', accountType: 'closed', institution: 'various', accountName: 'Closed Accounts', accountNumber: '', accountHolder: 'various', isClosed: true }],
    [/^Quickbooks Backups/, { bucket: 'bookkeeping-docs', r2Prefix: 'quickbooks', category: 'backup', accountType: 'accounting-software', institution: 'quickbooks', accountName: 'QuickBooks Backups', accountNumber: '', accountHolder: 'Family' }],
    [/^AI Analysis/, { bucket: 'bookkeeping-docs', r2Prefix: 'ai-analysis', category: 'analysis', accountType: 'analysis', institution: 'internal', accountName: 'AI Analysis', accountNumber: '', accountHolder: 'Rahul' }],
  ];

  for (const [pattern, overrides] of routes) {
    if (pattern.test(topDir)) {
      Object.assign(result, overrides);
      return result;
    }
  }

  // Root-level files
  result.bucket = 'bookkeeping-docs';
  result.r2Prefix = 'reference-spreadsheets';
  result.category = 'reference';
  result.accountType = 'summary';
  result.institution = 'internal';
  result.accountName = 'Master Reference Files';
  result.accountHolder = 'Family';
  result.convertible = true;
  return result;
}

function extractDate(filename, relpath) {
  let year = null, month = null, statementDate = null;

  let m = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    year = parseInt(m[1]); month = parseInt(m[2]);
    statementDate = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (!m) {
    m = filename.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m && parseInt(m[1]) >= 2000 && parseInt(m[1]) <= 2030) {
      year = parseInt(m[1]); month = parseInt(m[2]);
      statementDate = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  if (!statementDate) {
    m = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (m) {
      month = parseInt(m[1]); year = parseInt(m[3]);
      statementDate = `${m[3]}-${m[1]}-${m[2]}`;
    }
  }
  // Pattern 4: MM-YY (2-digit year) at end of filename, e.g. "CS Trust 2028 - 01-22.pdf"
  if (!statementDate) {
    m = filename.match(/(\d{2})-(\d{2})\.pdf$/i);
    if (m) {
      const mm = parseInt(m[1]);
      const yy = parseInt(m[2]);
      if (mm >= 1 && mm <= 12 && yy >= 0 && yy <= 99) {
        month = mm;
        year = 2000 + yy;
        const lastDay = new Date(year, month, 0).getDate();
        statementDate = `${year}-${m[1]}-${String(lastDay).padStart(2, '0')}`;
      }
    }
  }
  if (!year) {
    // Only match years in directory components of the path, not the filename
    const dirPath = relpath.replace(/[^/]+$/, '');
    m = dirPath.match(/(20\d{2})/);
    if (m) year = parseInt(m[1]);
  }

  // Validate the date is real (reject impossible dates like 11-31)
  if (statementDate) {
    const [y, m, d] = statementDate.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    if (d > daysInMonth || d < 1 || m > 12 || m < 1) {
      statementDate = null;
    }
  }

  return { year, month, statementDate };
}

function collectFiles(dir, base) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, base));
    } else {
      files.push({ fullPath: full, relPath: rel, size: statSync(full).size });
    }
  }
  return files;
}

// Escape shell argument
function shellEsc(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

async function uploadFile(file) {
  const { fullPath, relPath, size } = file;
  const filename = basename(relPath);
  const ext = extname(filename).slice(1).toLowerCase();
  const routing = getRouting(relPath);
  const dates = extractDate(filename, relPath);
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

  const parts = relPath.split('/');
  const subpath = parts.length > 1 ? parts.slice(1).join('/') : filename;
  const r2Key = `${routing.r2Prefix}/${subpath}`;

  const row = {
    bucket: routing.bucket,
    r2_key: r2Key,
    filename,
    file_type: ext || 'unknown',
    file_size: size,
    content_type: contentType,
    category: routing.category,
    account_type: routing.accountType,
    institution: routing.institution || null,
    account_name: routing.accountName || null,
    account_number: routing.accountNumber || null,
    account_holder: routing.accountHolder || null,
    year: dates.year,
    month: dates.month,
    statement_date: dates.statementDate,
    is_closed: routing.isClosed,
    property: routing.property,
    convertible: routing.convertible,
    original_path: relPath,
  };

  try {
    const cmd = `wrangler r2 object put ${shellEsc(routing.bucket + '/' + r2Key)} --file=${shellEsc(fullPath)} --content-type=${shellEsc(contentType)} --remote`;
    await execAsync(cmd, { timeout: 60000 });
    return { success: true, row };
  } catch (e) {
    return { success: false, error: e.message?.slice(0, 80), relPath };
  }
}

async function main() {
  console.log(`[START] Source: ${SRC}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Parallel: ${PARALLEL}`);

  const allFiles = collectFiles(SRC, SRC);
  console.log(`Found ${allFiles.length} files`);

  if (DRY_RUN) {
    for (const f of allFiles) {
      const routing = getRouting(f.relPath);
      const parts = f.relPath.split('/');
      const subpath = parts.length > 1 ? parts.slice(1).join('/') : basename(f.relPath);
      console.log(`${routing.bucket}/${routing.r2Prefix}/${subpath}`);
    }
    return;
  }

  // Check which files already exist in Supabase (for --skip-existing)
  let existingKeys = new Set();
  if (SKIP_EXISTING) {
    console.log('Checking existing documents...');
    let offset = 0;
    while (true) {
      const { data } = await supabase.from('document_index').select('r2_key').range(offset, offset + 999);
      if (!data || data.length === 0) break;
      data.forEach(d => existingKeys.add(d.r2_key));
      offset += 1000;
    }
    console.log(`Found ${existingKeys.size} existing documents, skipping those.`);
  }

  let uploaded = 0, failed = 0, skipped = 0;
  const allRows = [];

  // Process in batches of PARALLEL
  for (let i = 0; i < allFiles.length; i += PARALLEL) {
    const batch = allFiles.slice(i, i + PARALLEL);

    // Check skip
    const toUpload = [];
    for (const file of batch) {
      const routing = getRouting(file.relPath);
      const parts = file.relPath.split('/');
      const subpath = parts.length > 1 ? parts.slice(1).join('/') : basename(file.relPath);
      const r2Key = `${routing.r2Prefix}/${subpath}`;
      if (SKIP_EXISTING && existingKeys.has(r2Key)) {
        skipped++;
        continue;
      }
      toUpload.push(file);
    }

    const results = await Promise.all(toUpload.map(f => uploadFile(f)));

    for (const r of results) {
      if (r.success) {
        uploaded++;
        allRows.push(r.row);
      } else {
        failed++;
        if (failed <= 10) console.error(`FAIL: ${r.relPath}: ${r.error}`);
      }
    }

    // Index in Supabase every 100 successful uploads
    if (allRows.length >= 100) {
      const { error } = await supabase.from('document_index').upsert(allRows, { onConflict: 'r2_key' });
      if (error) console.error(`Supabase error: ${error.message}`);
      allRows.length = 0;
    }

    const total = uploaded + failed + skipped;
    if (total % 50 === 0 || total === allFiles.length) {
      console.log(`[${new Date().toTimeString().slice(0,8)}] Progress: ${total}/${allFiles.length} (${uploaded} uploaded, ${failed} failed, ${skipped} skipped)`);
    }
  }

  // Final Supabase insert
  if (allRows.length > 0) {
    const { error } = await supabase.from('document_index').upsert(allRows, { onConflict: 'r2_key' });
    if (error) console.error(`Supabase final error: ${error.message}`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${allFiles.length}`);
}

main().catch(console.error);
