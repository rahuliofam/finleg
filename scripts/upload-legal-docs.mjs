#!/usr/bin/env node
/**
 * Upload legal migration docs to Cloudflare R2 (legal-docs bucket) and index in Supabase.
 *
 * Usage: node scripts/upload-legal-docs.mjs [--dry-run] [--skip-existing]
 */

import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { promisify } from 'util';
import { config } from 'dotenv';

config();

const execAsync = promisify(exec);

const SRC = '/Users/rahulio/Documents/GoogleDriveFinLeg Migration Docs';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EXISTING = process.argv.includes('--skip-existing');
const PARALLEL = 5;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  md: 'text/markdown',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',
};

function getRouting(relpath) {
  const topDir = relpath.split('/')[0];

  if (/^JustinGilbertson Agreements/.test(topDir)) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'agreements/gilbertson',
      category: 'legal',
      accountType: 'contract',
      institution: null,
      accountName: 'Gilbertson Agreements',
      accountNumber: null,
      accountHolder: 'Family',
      isClosed: false,
      property: null,
      convertible: false,
    };
  }

  if (/^Signed Rental Agreements Signwell/.test(topDir)) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'rental-agreements/signed-signwell',
      category: 'legal',
      accountType: 'rental-agreement',
      institution: 'signwell',
      accountName: 'Signed Rental Agreements (SignWell)',
      accountNumber: null,
      accountHolder: 'Family',
      isClosed: false,
      property: 'alpaca-playhouse',
      convertible: false,
    };
  }

  if (/^Rental Agreements/.test(topDir)) {
    return {
      bucket: 'legal-docs',
      r2Prefix: 'rental-agreements/wa-sharingwood',
      category: 'legal',
      accountType: 'rental-agreement',
      institution: null,
      accountName: 'WA Sharingwood Rental Agreements',
      accountNumber: null,
      accountHolder: 'Family',
      isClosed: false,
      property: 'wa-sharingwood',
      convertible: false,
    };
  }

  // Fallback for any root-level files
  return {
    bucket: 'legal-docs',
    r2Prefix: 'other',
    category: 'legal',
    accountType: 'legal',
    institution: null,
    accountName: 'Legal Documents',
    accountNumber: null,
    accountHolder: 'Family',
    isClosed: false,
    property: null,
    convertible: false,
  };
}

function extractDate(filename) {
  let year = null, month = null, statementDate = null;

  // Pattern: YYYY-MM-DD
  let m = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    year = parseInt(m[1]); month = parseInt(m[2]);
    statementDate = `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Pattern: MM-DD-YYYY
  if (!statementDate) {
    m = filename.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (m && parseInt(m[3]) >= 2000) {
      month = parseInt(m[1]); year = parseInt(m[3]);
      statementDate = `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    }
  }

  // Pattern: year in filename like 2025-2026 or just 2025
  if (!year) {
    m = filename.match(/(20\d{2})/);
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
  const dates = extractDate(filename);
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

  if (DRY_RUN) {
    return { success: true, row, dryRun: true };
  }

  try {
    const cmd = `wrangler r2 object put ${shellEsc(routing.bucket + '/' + r2Key)} --file=${shellEsc(fullPath)} --content-type=${shellEsc(contentType)} --remote`;
    await execAsync(cmd, { timeout: 60000 });
    return { success: true, row };
  } catch (e) {
    return { success: false, error: e.message?.slice(0, 200), relPath };
  }
}

async function main() {
  console.log(`[START] Source: ${SRC}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Parallel: ${PARALLEL}`);

  const allFiles = collectFiles(SRC, SRC);
  console.log(`Found ${allFiles.length} files\n`);

  if (DRY_RUN) {
    for (const f of allFiles) {
      const routing = getRouting(f.relPath);
      const parts = f.relPath.split('/');
      const subpath = parts.length > 1 ? parts.slice(1).join('/') : basename(f.relPath);
      const r2Key = `${routing.r2Prefix}/${subpath}`;
      console.log(`${routing.bucket}/${r2Key}  (${routing.accountType}, ${routing.property || 'no-property'})`);
    }
    console.log(`\nTotal: ${allFiles.length} files would be uploaded`);
    return;
  }

  let existingKeys = new Set();
  if (SKIP_EXISTING) {
    console.log('Checking existing documents...');
    let offset = 0;
    while (true) {
      const { data } = await supabase.from('document_index').select('r2_key').eq('bucket', 'legal-docs').range(offset, offset + 999);
      if (!data || data.length === 0) break;
      data.forEach(d => existingKeys.add(d.r2_key));
      offset += 1000;
    }
    console.log(`Found ${existingKeys.size} existing legal docs, skipping those.`);
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
        console.log(`✓ ${r.row.filename}`);
      } else {
        failed++;
        console.error(`✗ ${r.relPath}: ${r.error}`);
      }
    }
  }

  // Index in Supabase
  if (allRows.length > 0) {
    const { error } = await supabase.from('document_index').upsert(allRows, { onConflict: 'r2_key' });
    if (error) {
      console.error(`Supabase error: ${error.message}`);
    } else {
      console.log(`\nIndexed ${allRows.length} documents in Supabase`);
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${allFiles.length}`);
}

main().catch(console.error);
