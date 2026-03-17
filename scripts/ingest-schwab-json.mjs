#!/usr/bin/env node
/**
 * Ingest Schwab JSON transaction exports into the PlaidPlus schema.
 *
 * Handles: date parsing ("as of"), amount/price cleaning, options symbol parsing,
 * action→transaction_type mapping, synthetic dedup keys.
 *
 * Usage:
 *   node scripts/ingest-schwab-json.mjs <file.json> --account-name "RS Trad IRA" --account-number "XXX902" --account-type ira
 *   node scripts/ingest-schwab-json.mjs <file.json> --dry-run
 *   node scripts/ingest-schwab-json.mjs <dir> --account-name "..." --account-number "..." --account-type ira
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// Dynamic import of supabase after env is loaded
const { createClient } = await import('@supabase/supabase-js');

// ── CLI args (parsed early so DRY_RUN is available before Supabase init) ────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (!DRY_RUN) {
  if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}
const INPUT = args.find(a => !a.startsWith('--'));
const ACCOUNT_NAME = getArg('--account-name');
const ACCOUNT_NUMBER = getArg('--account-number');
const ACCOUNT_TYPE = getArg('--account-type');
const INSTITUTION = getArg('--institution') || 'Charles Schwab';

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

if (!INPUT) {
  console.error('Usage: node scripts/ingest-schwab-json.mjs <file-or-dir> --account-name "..." --account-number "..." --account-type ira|brokerage|roth_ira|401k|trust');
  process.exit(1);
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

/**
 * Parse Schwab date field: "MM/DD/YYYY" or "MM/DD/YYYY as of MM/DD/YYYY"
 * Returns { transaction_date, settlement_date }
 */
function parseDate(dateStr) {
  if (!dateStr) return { transaction_date: null, settlement_date: null };

  const asOfMatch = dateStr.match(/^(\d{2}\/\d{2}\/\d{4})\s+as\s+of\s+(\d{2}\/\d{2}\/\d{4})$/);
  if (asOfMatch) {
    return {
      transaction_date: mmddyyyyToIso(asOfMatch[1]),
      settlement_date: mmddyyyyToIso(asOfMatch[2]),
    };
  }

  return {
    transaction_date: mmddyyyyToIso(dateStr.trim()),
    settlement_date: null,
  };
}

function mmddyyyyToIso(d) {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Parse money string: "$1,370.97" → 1370.97, "-$499,524.81" → -499524.81, "" → null
 */
function parseMoney(s) {
  if (!s || s.trim() === '') return null;
  const neg = s.startsWith('-');
  const cleaned = s.replace(/[-$,]/g, '').trim();
  if (!cleaned) return null;
  const val = parseFloat(cleaned);
  if (isNaN(val)) return null;
  return neg ? -val : val;
}

/**
 * Parse quantity: "-5,590" → -5590, "60.932" → 60.932, "" → null
 */
function parseQty(s) {
  if (!s || s.trim() === '') return null;
  const cleaned = s.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

/**
 * Parse options symbol: "TSLA 01/15/2027 300.00 C" → option security details
 * Returns null for regular symbols.
 */
function parseOptionSymbol(symbol) {
  if (!symbol) return null;
  const m = symbol.match(/^(\w+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+)\s+([CP])$/);
  if (!m) return null;
  return {
    underlying_ticker: m[1],
    expiration_date: mmddyyyyToIso(m[2]),
    strike_price: parseFloat(m[3]),
    option_type: m[4] === 'C' ? 'call' : 'put',
  };
}

/**
 * Detect security type from symbol and quantity
 */
function detectSecurityType(symbol, qty) {
  if (!symbol) return null;
  if (parseOptionSymbol(symbol)) return 'option';
  // Mutual funds: ticker typically ends in X and may have fractional shares
  if (/X$/.test(symbol) && qty && String(qty).includes('.')) return 'mutual_fund';
  return 'equity';
}

// ── Action mapping ──────────────────────────────────────────────────────────

const ACTION_MAP = {
  'Buy':                        { type: 'buy',            subtype: null },
  'Sell':                       { type: 'sell',           subtype: null },
  'Buy to Open':                { type: 'buy',            subtype: 'open' },
  'Buy to Close':               { type: 'buy',            subtype: 'close' },
  'Sell to Open':               { type: 'sell',           subtype: 'open' },
  'Sell to Close':              { type: 'sell',           subtype: 'close' },
  'Bank Interest':              { type: 'interest',       subtype: null },
  'Cash Dividend':              { type: 'dividend',       subtype: 'cash' },
  'Qualified Dividend':         { type: 'dividend',       subtype: 'qualified' },
  'Non-Qualified Div':          { type: 'dividend',       subtype: 'non_qualified' },
  'Long Term Cap Gain Reinvest':{ type: 'capital_gain',   subtype: 'long_term_reinvest' },
  'Short Term Cap Gain Reinvest':{ type: 'capital_gain',  subtype: 'short_term_reinvest' },
  'Reinvest Shares':            { type: 'reinvestment',   subtype: null },
  'Reinvest Dividend':          { type: 'reinvestment',   subtype: 'dividend' },
  'Security Transfer':          { type: 'transfer',       subtype: 'acat' },
  'Service Fee':                { type: 'fee',            subtype: 'service' },
  'Misc Cash Entry':            { type: 'adjustment',     subtype: null },
  'Journal':                    { type: 'transfer',       subtype: 'journal' },
  'Journaled Shares':           { type: 'transfer',       subtype: 'journal' },
  'Stock Split':                { type: 'stock_split',    subtype: null },
  'ADR Mgmt Fee':               { type: 'fee',            subtype: 'adr' },
  'Wire Funds Received':        { type: 'deposit',        subtype: 'wire' },
  'Wire Funds':                 { type: 'withdrawal',     subtype: 'wire' },
  'MoneyLink Transfer':         { type: 'transfer',       subtype: 'moneylink' },
  'Funds Received':             { type: 'deposit',        subtype: null },
  'Cash In Lieu':               { type: 'adjustment',     subtype: 'cash_in_lieu' },
  'Foreign Tax Paid':           { type: 'tax',            subtype: 'foreign' },
  'Margin Interest':            { type: 'margin_interest', subtype: null },
};

function mapAction(action) {
  if (!action) return { type: 'other', subtype: null };
  return ACTION_MAP[action] || { type: 'other', subtype: action.toLowerCase().replace(/\s+/g, '_') };
}

// ── Synthetic dedup key ─────────────────────────────────────────────────────

function makeSyntheticId(txn) {
  const parts = [
    txn.Date || '',
    txn.Action || '',
    txn.Symbol || '',
    txn.Description || '',
    txn.Quantity || '',
    txn.Amount || '',
  ].join('|');
  return createHash('sha256').update(parts).digest('hex').slice(0, 32);
}

// ── Security upsert ─────────────────────────────────────────────────────────

const securityCache = new Map(); // ticker → id

async function ensureSecurity(symbol, description, qty) {
  if (!symbol || symbol.trim() === '') return null;
  if (DRY_RUN) return 'dry-run-security-id';

  const optionInfo = parseOptionSymbol(symbol);
  const securityType = detectSecurityType(symbol, qty);

  // For options, use the full symbol as the ticker to keep them distinct
  const tickerKey = symbol.trim();

  if (securityCache.has(tickerKey)) return securityCache.get(tickerKey);

  const row = {
    ticker_symbol: tickerKey,
    name: description || symbol,
    security_type: securityType || 'equity',
  };

  if (optionInfo) {
    row.underlying_ticker = optionInfo.underlying_ticker;
    row.expiration_date = optionInfo.expiration_date;
    row.strike_price = optionInfo.strike_price;
    row.option_type = optionInfo.option_type;
  }

  const { data, error } = await supabase
    .from('securities')
    .upsert(row, { onConflict: 'ticker_symbol', ignoreDuplicates: false })
    .select('id')
    .single();

  if (error) {
    console.error(`  ✗ Security upsert error for ${tickerKey}: ${error.message}`);
    return null;
  }

  const id = data?.id || null;
  if (id) securityCache.set(tickerKey, id);
  return id;
}

// ── Process a single JSON file ──────────────────────────────────────────────

async function processFile(filePath, _accountName, _accountNumber, _accountType, _institutionId, accountId) {
  const raw = readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);

  const txns = json.BrokerageTransactions || [];
  if (txns.length === 0) {
    console.log(`  (no transactions in file)`);
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  const dateRange = `${json.FromDate || '?'} – ${json.ToDate || '?'}`;
  console.log(`  ${txns.length} transactions | ${dateRange}`);

  let inserted = 0, skipped = 0, errors = 0;

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i];
    const { transaction_date, settlement_date } = parseDate(txn.Date);
    const { type, subtype } = mapAction(txn.Action);
    const amount = parseMoney(txn.Amount);
    const qty = parseQty(txn.Quantity);
    const price = parseMoney(txn.Price);
    const fees = parseMoney(txn['Fees & Comm']);
    const syntheticId = makeSyntheticId(txn);

    if (!transaction_date) {
      console.error(`  ✗ Row ${i}: bad date "${txn.Date}"`);
      errors++;
      continue;
    }

    // Ensure security exists
    let securityId = null;
    if (txn.Symbol && txn.Symbol.trim()) {
      securityId = await ensureSecurity(txn.Symbol, txn.Description, txn.Quantity);
    }

    const row = {
      account_id: accountId,
      security_id: securityId,
      external_id: syntheticId,
      transaction_type: type,
      transaction_subtype: subtype,
      transaction_date,
      settlement_date,
      amount: amount ?? 0,
      quantity: qty,
      price,
      fees: fees ?? 0,
      net_amount: amount != null && fees != null ? amount - fees : amount,
      description: txn.Description || null,
      memo: txn.Action || null,
      source: 'csv',
      raw_json: txn,
    };

    if (DRY_RUN) {
      const sym = txn.Symbol ? ` [${txn.Symbol}]` : '';
      console.log(`    ${transaction_date} ${txn.Action}${sym} ${txn.Amount || ''} → ${type}${subtype ? '/' + subtype : ''}`);
      inserted++;
      continue;
    }

    const { error } = await supabase
      .from('transactions')
      .upsert(row, { onConflict: 'account_id,external_id', ignoreDuplicates: true });

    if (error) {
      console.error(`  ✗ Row ${i} insert error: ${error.message}`);
      errors++;
    } else {
      inserted++;
    }
  }

  return { inserted, skipped, errors };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  Schwab JSON → PlaidPlus Ingest          ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);

  // Resolve input to file list
  const inputPath = resolve(INPUT);
  let files = [];
  const stat = statSync(inputPath);
  if (stat.isDirectory()) {
    files = readdirSync(inputPath)
      .filter(f => f.endsWith('.json'))
      .map(f => join(inputPath, f));
  } else {
    files = [inputPath];
  }

  if (files.length === 0) {
    console.error('No JSON files found.');
    process.exit(1);
  }

  console.log(`Files: ${files.length}`);
  console.log(`Institution: ${INSTITUTION}`);

  // For each file, try to infer account info from filename if not provided via CLI
  // Filename pattern: "RS_-_Trad_IRA_XXX902_Transactions_20260216-020122.json"
  function inferFromFilename(filename) {
    const base = filename.replace(/\.json$/, '');
    // Try to extract account number (XXX followed by digits)
    const acctMatch = base.match(/(XXX\d+)/i);
    // Try to extract account type from name
    let inferredType = null;
    const lower = base.toLowerCase();
    if (lower.includes('roth_ira') || lower.includes('roth-ira') || lower.includes('roth ira')) inferredType = 'roth_ira';
    else if (lower.includes('trad_ira') || lower.includes('trad-ira') || lower.includes('traditional')) inferredType = 'ira';
    else if (lower.includes('401k')) inferredType = '401k';
    else if (lower.includes('trust')) inferredType = 'trust';
    else if (lower.includes('brokerage')) inferredType = 'brokerage';

    // Derive display name: replace underscores with spaces, drop "Transactions_..." suffix
    let inferredName = base.replace(/_Transactions.*$/, '').replace(/_/g, ' ');

    return {
      accountNumber: acctMatch ? acctMatch[1] : null,
      accountType: inferredType,
      accountName: inferredName,
    };
  }

  // Ensure institution
  let institutionId;
  if (!DRY_RUN) {
    const { data: inst } = await supabase
      .from('institutions')
      .upsert(
        { name: INSTITUTION, institution_type: 'brokerage' },
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select('id')
      .single();
    institutionId = inst?.id;
    if (!institutionId) { console.error('Failed to upsert institution'); process.exit(1); }
  }

  let totalInserted = 0, totalErrors = 0;

  for (const file of files) {
    const filename = file.split('/').pop();
    console.log(`\n── ${filename} ──`);

    const inferred = inferFromFilename(filename);
    const acctName = ACCOUNT_NAME || inferred.accountName || filename;
    const acctNumber = ACCOUNT_NUMBER || inferred.accountNumber;
    const acctType = ACCOUNT_TYPE || inferred.accountType || 'brokerage';

    if (!acctNumber && !DRY_RUN) {
      console.error(`  ✗ Cannot determine account number for ${filename}. Use --account-number.`);
      totalErrors++;
      continue;
    }

    console.log(`  Account: ${acctName} | ${acctNumber || '(dry-run)'} | ${acctType}`);

    // Ensure account
    let accountId = 'dry-run';
    if (!DRY_RUN) {
      const { data: acct } = await supabase
        .from('accounts')
        .upsert(
          {
            institution_id: institutionId,
            display_name: acctName,
            account_number_masked: acctNumber ? `****${acctNumber.slice(-3)}` : null,
            account_type: acctType,
            external_account_id: acctNumber,
            connection_type: 'manual',
            is_active: true,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'institution_id,external_account_id' }
        )
        .select('id')
        .single();

      if (!acct?.id) {
        console.error(`  ✗ Failed to upsert account`);
        totalErrors++;
        continue;
      }
      accountId = acct.id;
    }

    // Create sync run
    let syncRunId = null;
    if (!DRY_RUN) {
      const { data: sr } = await supabase
        .from('brokerage_sync_runs')
        .insert({
          institution_id: institutionId,
          sync_type: 'manual',
          triggered_by: 'ingest-schwab-json',
          status: 'running',
          details: { file: filename },
        })
        .select('id')
        .single();
      syncRunId = sr?.id;
    }

    try {
      const result = await processFile(file, acctName, acctNumber, acctType, institutionId, accountId);
      totalInserted += result.inserted;
      totalErrors += result.errors;

      console.log(`  ✓ ${result.inserted} inserted, ${result.errors} errors`);

      // Update sync run
      if (syncRunId) {
        await supabase
          .from('brokerage_sync_runs')
          .update({
            status: result.errors > 0 ? 'partial' : 'success',
            completed_at: new Date().toISOString(),
            transactions_synced: result.inserted,
            error_message: result.errors > 0 ? `${result.errors} row errors` : null,
          })
          .eq('id', syncRunId);
      }
    } catch (err) {
      console.error(`  ✗ Fatal error: ${err.message}`);
      totalErrors++;

      if (syncRunId) {
        await supabase
          .from('brokerage_sync_runs')
          .update({
            status: 'error',
            completed_at: new Date().toISOString(),
            error_message: err.message,
          })
          .eq('id', syncRunId);
      }
    }
  }

  console.log(`\n══════════════════════════════════════════`);
  console.log(`COMPLETE — ${totalInserted} transactions, ${totalErrors} errors`);
  console.log(`══════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
