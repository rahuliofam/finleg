#!/usr/bin/env node
/**
 * Ingest QuickBooks General Ledger CSV into Supabase qb_general_ledger table.
 *
 * Usage: node scripts/ingest-qb-ledger.mjs "/path/to/ledger.csv"
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config(); // Load .env file

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in environment. Add it to .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseAmount(str) {
  if (!str || str === '-' || str === '') return null;
  // Remove $ and commas, handle parentheses for negatives
  let cleaned = str.replace(/[$,]/g, '');
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseDate(str) {
  if (!str || str === '-' || str === '') return null;
  // Format: MM/DD/YYYY
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/ingest-qb-ledger.mjs "/path/to/ledger.csv"');
    process.exit(1);
  }

  const raw = readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n');

  // Skip header lines (first 4 lines: title, company, date range, blank)
  // Line 5 (index 4) is the column header
  const dataLines = lines.slice(5); // Start after header row

  let currentAccount = null;
  const rows = [];
  let skippedTotals = 0;
  let skippedEmpty = 0;

  for (const line of dataLines) {
    if (!line.trim()) {
      skippedEmpty++;
      continue;
    }

    const fields = parseCSVLine(line);

    // Account header row: first field is non-empty, rest are mostly empty
    // e.g. "PayPal Bank,,,,,,,,,"
    if (fields[0] && !fields[0].startsWith('Total for') && !fields[0].startsWith('"') && !fields[1] && !fields[2]) {
      // Check if it looks like an account header (not the footer line)
      if (!fields[0].startsWith('Accrual Basis') && !fields[0].startsWith('Cash Basis')) {
        currentAccount = fields[0].trim();
        continue;
      }
    }

    // Total row: starts with "Total for ..."
    if (fields[0] && fields[0].startsWith('Total for')) {
      skippedTotals++;
      continue;
    }

    // Footer line
    if (fields[0] && (fields[0].startsWith('Accrual Basis') || fields[0].startsWith('Cash Basis'))) {
      continue;
    }

    // Data row: first field empty, data in fields[1..9]
    const distributionAccount = fields[1] || null;
    const transactionDate = parseDate(fields[2]);
    const transactionType = fields[3] || null;
    const num = fields[4] || null;
    const name = fields[5] || null;
    const memoDescription = fields[6] || null;
    const split = fields[7] || null;
    const amount = parseAmount(fields[8]);
    const balance = parseAmount(fields[9]);

    const isBeginningBalance = distributionAccount === 'Beginning Balance';

    // Skip rows with no useful data
    if (!distributionAccount && !transactionDate && !transactionType && amount === null) {
      skippedEmpty++;
      continue;
    }

    rows.push({
      account: currentAccount,
      distribution_account: isBeginningBalance ? null : distributionAccount,
      transaction_date: transactionDate,
      transaction_type: transactionType,
      num,
      name,
      memo_description: memoDescription,
      split,
      amount,
      balance,
      is_beginning_balance: isBeginningBalance,
      is_total_row: false,
    });
  }

  console.log(`Parsed ${rows.length} transaction rows`);
  console.log(`Skipped ${skippedTotals} total rows, ${skippedEmpty} empty/header rows`);
  console.log(`Unique accounts: ${[...new Set(rows.map(r => r.account))].length}`);

  // Clear existing data and insert fresh
  console.log('Clearing existing data...');
  const { error: delError } = await supabase.from('qb_general_ledger').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delError) {
    console.error('Error clearing table:', delError);
    process.exit(1);
  }

  // Insert in batches of 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('qb_general_ledger').insert(batch);
    if (error) {
      console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, error);
      process.exit(1);
    }
    inserted += batch.length;
    process.stdout.write(`\rInserted ${inserted}/${rows.length} rows...`);
  }

  console.log(`\nDone! ${inserted} rows ingested into qb_general_ledger`);

  // Quick summary
  const { data: summary } = await supabase
    .from('qb_general_ledger')
    .select('account', { count: 'exact', head: false })
    .not('is_beginning_balance', 'eq', true);

  console.log(`\nVerification: ${summary?.length || 0} non-beginning-balance rows in DB`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
