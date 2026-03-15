#!/usr/bin/env node
/**
 * Upload family legal/financial/tax documents to Cloudflare R2 and index in Supabase.
 *
 * Source: LegalandFinancialFamilyDocs folder
 * Buckets: legal-docs, bookkeeping-docs
 * Categories: legal, tax-personal, investment, other
 *
 * Usage:
 *   node scripts/upload-family-docs.mjs [--dry-run] [--skip-existing]
 */

import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SRC = '/Users/rahulio/Documents/CodingProjects/noncode/Finleg/AI Financial/LegalandFinancialFamilyDocs';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');
const PARALLEL = 10;

const SUPABASE_URL = 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZHZ6enhzcnp1b3JndXdrYWloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQzMTk1NywiZXhwIjoyMDg5MDA3OTU3fQ.iYlTfc9IhMpOphSLUjBCTEto2Mq_1dD1-gVIEo4LUrc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Files to NEVER upload (sensitive credentials)
const BLOCKED_FILES = [
  'personal_key US GOV ID social security website password.txt',
];

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
  xml: 'application/xml',
  pfl: 'application/octet-stream',
  zip: 'application/zip',
  msg: 'application/vnd.ms-outlook',
  txt: 'text/plain',
};

/**
 * Route a file to the correct bucket, prefix, and category based on its relative path.
 */
function getRouting(relpath) {
  const parts = relpath.split('/');
  const topDir = parts[0];
  const filename = parts[parts.length - 1];

  // ─── LEGAL DOCUMENTS ───
  if (topDir === 'Legal') {
    const subDir = parts.length > 1 ? parts[1] : '';
    const base = {
      bucket: 'legal-docs',
      category: 'legal',
      accountHolder: 'Family',
      institution: '',
    };

    // POA durable for Kids
    if (subDir.includes('POA durable for Kids')) {
      return { ...base, r2Prefix: 'poa/kids', accountType: 'power-of-attorney', accountName: 'POA Durable for Kids' };
    }
    // Power of Attorney & Will - Signed
    if (subDir.includes('Power of Attorney & Will')) {
      return { ...base, r2Prefix: 'poa-and-will/signed', accountType: 'will-and-poa', accountName: 'POA & Will - Signed Copies' };
    }
    // Revocable Living Trust - Rahul and Kathleen
    if (subDir.includes('Revocable Living Trust')) {
      return { ...base, r2Prefix: 'trusts/rahul-kathleen-living-trust', accountType: 'trust', accountName: 'Rahul & Kathleen Revocable Living Trust' };
    }
    // Sonnad Divorce
    if (subDir.includes('Divorce')) {
      return { ...base, r2Prefix: 'divorce', accountType: 'divorce', accountName: 'Sonnad Divorce July 2020' };
    }
    // Subhash Trust and Estate
    if (subDir.includes('Subhash Trust')) {
      return { ...base, r2Prefix: 'trusts/subhash-trust-estate', accountType: 'trust', accountName: 'Subhash Sonnad Revocable Trust', accountHolder: 'Subhash' };
    }
    // Subhash POA Finances
    if (subDir.includes('Subhash Sonnad POA')) {
      return { ...base, r2Prefix: 'poa/subhash', accountType: 'power-of-attorney', accountName: 'Subhash Sonnad POA Finances', accountHolder: 'Subhash' };
    }
    // Trust Docs - Unsigned Originals
    if (subDir.includes('Trust Docs - Unsigned')) {
      return { ...base, r2Prefix: 'trusts/unsigned-originals', accountType: 'trust', accountName: 'Trust Docs - Unsigned Originals' };
    }
    // WillMaker file or other root-level legal
    return { ...base, r2Prefix: 'general', accountType: 'legal-document', accountName: 'Legal Documents' };
  }

  // ─── TAX DOCUMENTS ───
  if (topDir === 'Rahul and Kathy and Family Taxes') {
    const yearDir = parts.length > 1 ? parts[1] : '';
    const yearMatch = yearDir.match(/(20\d{2})/);
    const year = yearMatch ? yearMatch[1] : 'misc';

    const base = {
      bucket: 'bookkeeping-docs',
      category: 'tax-personal',
      accountType: 'tax-return',
      institution: 'irs',
      accountHolder: 'Family',
    };

    // Filed Tax Returns (incomplete)
    if (yearDir.includes('Filed Tax Returns')) {
      return { ...base, r2Prefix: 'taxes-personal/filed-returns', accountName: 'Filed Tax Returns' };
    }
    // Peak Advisors
    if (yearDir.includes('Peak Advisors')) {
      return { ...base, r2Prefix: 'taxes-personal/peak-advisors-2021', accountName: 'Peak Advisors Archive', institution: 'peak-advisors' };
    }

    // Detect sub-types from deeper paths
    let accountName = `${year} Family Taxes`;
    let accountType = 'tax-return';

    const lowerPath = relpath.toLowerCase();
    if (lowerPath.includes('w2') || lowerPath.includes('w-2')) accountType = 'w2';
    else if (lowerPath.includes('1099')) accountType = '1099';
    else if (lowerPath.includes('1098')) accountType = '1098';
    else if (lowerPath.includes('paycheck') || lowerPath.includes('paystub')) accountType = 'paycheck';
    else if (lowerPath.includes('k-1') || lowerPath.includes('k1')) accountType = 'k1';
    else if (lowerPath.includes('return') || lowerPath.includes('filed')) accountType = 'tax-return';

    return { ...base, r2Prefix: `taxes-personal/${year}`, accountName, accountType };
  }

  // ─── INVESTMENTS ───
  if (topDir.includes('SWAN')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'investments/swan-series-c',
      category: 'investment',
      accountType: 'private-investment',
      institution: 'swan',
      accountName: 'SWAN Company Series C Preferred',
      accountHolder: 'Rahul',
    };
  }

  // Root-level investment docs
  if (filename.includes('Decentrane') || filename.includes('TON_DAT')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'investments/decentrane',
      category: 'investment',
      accountType: 'private-investment',
      institution: 'decentrane',
      accountName: 'Decentrane / TON DAT Investment',
      accountHolder: 'Rahul',
    };
  }
  if (filename.includes('madison_trust')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'investments/madison-trust',
      category: 'investment',
      accountType: 'self-directed-ira',
      institution: 'madison-trust',
      accountName: 'Madison Trust Self-Directed IRA',
      accountHolder: 'Rahul',
    };
  }

  // ─── LEGAL (root-level legal docs) ───
  if (filename.includes('Lost Lake') || filename.includes('Legal Description')) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'property/lost-lake',
      category: 'legal',
      accountType: 'property-deed',
      institution: 'snohomish-county',
      accountName: '22003 E Lost Lake Rd',
      accountHolder: 'Family',
    };
  }
  if (filename.includes('Deed Transfer') || filename.includes('Snohomih')) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'property/sharingwood',
      category: 'legal',
      accountType: 'property-deed',
      institution: 'snohomish-county',
      accountName: 'Snohomish County House Deed Transfer',
      accountHolder: 'Family',
    };
  }
  if (filename.includes('Fidelity Law Suit')) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'litigation/fidelity',
      category: 'legal',
      accountType: 'litigation',
      institution: 'fidelity',
      accountName: 'Fidelity Law Suit',
      accountHolder: 'Rahul',
    };
  }
  if (filename.includes('Venturables') && filename.includes('EIN')) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'business/venturables',
      category: 'legal',
      accountType: 'ein-registration',
      institution: 'irs',
      accountName: 'Venturables LLC EIN',
      accountHolder: 'Rahul',
    };
  }
  if (filename.includes('Venturables') && filename.includes('signed')) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'business/venturables',
      category: 'legal',
      accountType: 'business-formation',
      institution: 'venturables',
      accountName: 'Venturables LLC Formation',
      accountHolder: 'Rahul',
    };
  }
  if (filename.includes('Venturables') && filename.includes('Tax Franchise')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'taxes-personal/business',
      category: 'tax-personal',
      accountType: 'franchise-tax',
      institution: 'texas',
      accountName: 'Venturables Texas Franchise Tax',
      accountHolder: 'Rahul',
    };
  }
  if (filename.includes('Property Tax') || filename.includes('Snohomish County Treasurer')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'taxes-personal/property-tax',
      category: 'tax-personal',
      accountType: 'property-tax',
      institution: 'snohomish-county',
      accountName: 'WA Property Tax - Sharingwood',
      accountHolder: 'Family',
      property: 'wa-sharingwood',
    };
  }
  if (filename.includes('Toyota Sienna Title')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'other/vehicle',
      category: 'other',
      accountType: 'vehicle-title',
      institution: 'dmv',
      accountName: 'Toyota Sienna Title',
      accountHolder: 'Family',
    };
  }
  if (filename.includes('registration trailer')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'other/vehicle',
      category: 'other',
      accountType: 'vehicle-registration',
      institution: 'dmv',
      accountName: 'Trailer Registration',
      accountHolder: 'Family',
    };
  }

  // ─── EDUCATION ───
  if (topDir === 'Education') {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'other/education',
      category: 'other',
      accountType: 'education',
      institution: filename.includes('UW') ? 'uw' : 'personal',
      accountName: 'Education Documents',
      accountHolder: 'Rahul',
    };
  }

  // ─── SOCIAL SECURITY (drive-download) ───
  if (topDir.includes('drive-download')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'other/social-security',
      category: 'other',
      accountType: 'social-security',
      institution: 'ssa',
      accountName: 'Social Security Statements',
      accountHolder: 'Rahul',
    };
  }

  // ─── MASTER REFERENCE (root-level spreadsheet) ───
  if (filename.includes('MASTER') && filename.includes('Accounts')) {
    return {
      bucket: 'bookkeeping-docs',
      r2Prefix: 'other/reference',
      category: 'other',
      accountType: 'reference',
      institution: 'internal',
      accountName: 'Master Accounts & Services Reference',
      accountHolder: 'Family',
      convertible: true,
    };
  }

  // ─── CATCH-ALL: other ───
  return {
    bucket: 'bookkeeping-docs',
    r2Prefix: 'other/unclassified',
    category: 'other',
    accountType: 'document',
    institution: '',
    accountName: 'Unclassified Document',
    accountHolder: 'Family',
  };
}

function extractDate(filename, relpath) {
  let year = null, month = null, statementDate = null;

  // YYYY-MM-DD
  let m = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m && parseInt(m[1]) >= 2000 && parseInt(m[1]) <= 2030) {
    year = parseInt(m[1]); month = parseInt(m[2]);
    statementDate = `${m[1]}-${m[2]}-${m[3]}`;
  }
  // YYYYMMDD
  if (!statementDate) {
    m = filename.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m && parseInt(m[1]) >= 2000 && parseInt(m[1]) <= 2030) {
      year = parseInt(m[1]); month = parseInt(m[2]);
      statementDate = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  // MM-DD-YYYY
  if (!statementDate) {
    m = filename.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
      if (y >= 2000 && y <= 2030) {
        month = parseInt(m[1]); year = y;
        statementDate = `${y}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      }
    }
  }
  // Month names: "Dec 2020", "July 2020", "Nov 15 2020"
  if (!statementDate) {
    const monthNames = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    m = filename.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})?\s*,?\s*(20\d{2})/i);
    if (m) {
      const mon = monthNames[m[1].toLowerCase().slice(0, 3)];
      year = parseInt(m[3]);
      month = mon;
      if (m[2]) {
        statementDate = `${year}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      }
    }
  }
  // Fallback: extract year from path
  if (!year) {
    m = relpath.match(/(20\d{2})/);
    if (m) year = parseInt(m[1]);
  }

  // Validate
  if (statementDate) {
    const [y, mo, d] = statementDate.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    if (d > daysInMonth || d < 1 || mo > 12 || mo < 1) {
      statementDate = null;
    }
  }

  return { year, month, statementDate };
}

function collectFiles(dir, base) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (BLOCKED_FILES.includes(entry.name)) {
      console.log(`⛔ BLOCKED (sensitive): ${entry.name}`);
      continue;
    }
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

  // Build R2 key: prefix/subpath (preserving folder structure under top-level dir)
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
    is_closed: false,
    property: routing.property || null,
    convertible: routing.convertible || false,
    original_path: relPath,
  };

  if (DRY_RUN) return { success: true, row, dryRun: true };

  try {
    const cmd = `wrangler r2 object put ${shellEsc(routing.bucket + '/' + r2Key)} --file=${shellEsc(fullPath)} --content-type=${shellEsc(contentType)} --remote`;
    await execAsync(cmd, { timeout: 120000 });
    return { success: true, row };
  } catch (e) {
    return { success: false, error: e.message?.slice(0, 120), relPath };
  }
}

async function main() {
  console.log(`[START] Source: ${SRC}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Parallel: ${PARALLEL}`);

  const allFiles = collectFiles(SRC, SRC);
  console.log(`Found ${allFiles.length} files\n`);

  // Show classification summary in dry-run
  if (DRY_RUN) {
    const summary = {};
    for (const f of allFiles) {
      const routing = getRouting(f.relPath);
      const parts = f.relPath.split('/');
      const subpath = parts.length > 1 ? parts.slice(1).join('/') : basename(f.relPath);
      const key = `${routing.bucket}/${routing.r2Prefix}`;
      if (!summary[key]) summary[key] = { count: 0, category: routing.category, accountType: routing.accountType, files: [] };
      summary[key].count++;
      if (summary[key].files.length < 3) summary[key].files.push(subpath);
    }

    console.log('=== CLASSIFICATION SUMMARY ===\n');
    for (const [prefix, info] of Object.entries(summary).sort()) {
      console.log(`${prefix}/ (${info.count} files) [${info.category} / ${info.accountType}]`);
      info.files.forEach(f => console.log(`  └ ${f}`));
      if (info.count > 3) console.log(`  └ ... and ${info.count - 3} more`);
      console.log();
    }

    // Show full file list
    console.log('\n=== FULL FILE MAPPING ===\n');
    for (const f of allFiles) {
      const routing = getRouting(f.relPath);
      const parts = f.relPath.split('/');
      const subpath = parts.length > 1 ? parts.slice(1).join('/') : basename(f.relPath);
      console.log(`${routing.bucket}/${routing.r2Prefix}/${subpath}`);
    }
    return;
  }

  // Check existing
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

  for (let i = 0; i < allFiles.length; i += PARALLEL) {
    const batch = allFiles.slice(i, i + PARALLEL);

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
        if (failed <= 20) console.error(`FAIL: ${r.relPath}: ${r.error}`);
      }
    }

    // Batch insert to Supabase every 100 rows
    if (allRows.length >= 100) {
      const { error } = await supabase.from('document_index').upsert(allRows, { onConflict: 'r2_key' });
      if (error) console.error(`Supabase error: ${error.message}`);
      allRows.length = 0;
    }

    const total = uploaded + failed + skipped;
    if (total % 50 === 0 || total === allFiles.length) {
      console.log(`[${new Date().toTimeString().slice(0, 8)}] Progress: ${total}/${allFiles.length} (${uploaded} ok, ${failed} fail, ${skipped} skip)`);
    }
  }

  // Final Supabase insert
  if (allRows.length > 0) {
    const { error } = await supabase.from('document_index').upsert(allRows, { onConflict: 'r2_key' });
    if (error) console.error(`Supabase final error: ${error.message}`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Failed:   ${failed}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Total:    ${allFiles.length}`);
}

main().catch(console.error);
