#!/usr/bin/env node
/**
 * Process Statement Inbox — Hostinger cron script.
 *
 * Polls statement_inbox for pending items, uploads to R2, parses with Claude CLI,
 * and inserts structured data into Supabase statement tables.
 *
 * Usage:
 *   node scripts/process-inbox.mjs                   # Process all pending
 *   node scripts/process-inbox.mjs --dry-run          # Parse but don't insert
 *   node scripts/process-inbox.mjs --limit 5          # Process max 5 items
 *   node scripts/process-inbox.mjs --id <uuid>        # Process specific inbox item
 */

import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { unlinkSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { config } from 'dotenv';

config(); // Load .env

const execAsync = promisify(exec);

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(getArg('--limit') || '50');
const SPECIFIC_ID = getArg('--id');
const MODEL = 'sonnet';

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

// ── Shell escape ────────────────────────────────────────────────────────────
function shellEsc(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Account type folder mapping (R2 path conventions) ───────────────────────
const ACCOUNT_TYPE_FOLDERS = {
  'credit-card': 'credit-cards',
  'credit-line': 'credit-cards',
  'checking': 'bank-accounts',
  'brokerage': 'brokerage',
  'ira': 'brokerage',
  'crypto': 'brokerage',
  'trust': 'brokerage',
  'heloc': 'loans',
  'auto-loan': 'loans',
  'mortgage': 'loans',
};

// ── Known accounts lookup (matches upload-r2-index.mjs routing) ─────────────
// Maps institution+account_number to canonical R2 subfolder and metadata
const KNOWN_ACCOUNTS = [
  { institution: 'amex', number: '24006', r2Sub: 'amex-blue-preferred-24006', holder: 'Rahul' },
  { institution: 'amex', number: '11003', r2Sub: 'amex-blue-business-11003', holder: 'Rahul' },
  { institution: 'apple', number: '2202', r2Sub: 'apple-card-2202', holder: 'Rahul' },
  { institution: 'chase', number: '4206', r2Sub: 'chase-amazon-cc-4206', holder: 'Rahul' },
  { institution: 'chase', number: '7191', r2Sub: 'chase-visa-cc-7191', holder: 'Subhash' },
  { institution: 'bank-of-america', number: '6420', r2Sub: 'boa-cc-6420', holder: 'Subhash' },
  { institution: 'robinhood', number: '3892', r2Sub: 'robinhood-gold-card-3892', holder: 'Rahul' },
  { institution: 'charles-schwab', number: '3711', r2Sub: 'schwab-checking-3711', holder: 'Rahul' },
  { institution: 'schwab', number: '3711', r2Sub: 'schwab-checking-3711', holder: 'Rahul' },
  { institution: 'us-bank', number: '7444', r2Sub: 'us-bank-checking-7444', holder: 'Rahul' },
  { institution: 'charles-schwab', number: '0566', r2Sub: 'schwab-brokerage-0566', holder: 'Rahul' },
  { institution: 'schwab', number: '0566', r2Sub: 'schwab-brokerage-0566', holder: 'Rahul' },
  { institution: 'charles-schwab', number: '2028', r2Sub: 'schwab-brokerage-2028', holder: 'Subhash' },
  { institution: 'schwab', number: '2028', r2Sub: 'schwab-brokerage-2028', holder: 'Subhash' },
  { institution: 'charles-schwab', number: '2192', r2Sub: 'schwab-trading-2192', holder: 'Rahul' },
  { institution: 'schwab', number: '2192', r2Sub: 'schwab-trading-2192', holder: 'Rahul' },
  { institution: 'charles-schwab', number: '3902', r2Sub: 'schwab-ira-3902', holder: 'Rahul' },
  { institution: 'schwab', number: '3902', r2Sub: 'schwab-ira-3902', holder: 'Rahul' },
  { institution: 'charles-schwab', number: '0044', r2Sub: 'schwab-trust-0044', holder: 'Trust' },
  { institution: 'schwab', number: '0044', r2Sub: 'schwab-trust-0044', holder: 'Trust' },
  { institution: 'pnc', number: null, r2Sub: 'pnc-mortgage', holder: 'Rahul' },
  { institution: 'us-bank', number: '9078', r2Sub: 'us-bank-equity-9078', holder: 'Rahul' },
  { institution: 'us-bank', number: '3784', r2Sub: 'us-bank-overdraft-3784', holder: 'Rahul' },
  { institution: 'coinbase', number: null, r2Sub: 'coinbase', holder: 'Rahul' },
];

function findKnownAccount(institution, accountNumber) {
  const inst = (institution || '').toLowerCase();
  const num = (accountNumber || '').replace(/\D/g, '');
  return KNOWN_ACCOUNTS.find(a =>
    inst.includes(a.institution) && (a.number === null || a.number === num)
  );
}

// ── Build R2 key from classification metadata ───────────────────────────────
function buildR2Key(item) {
  const folder = ACCOUNT_TYPE_FOLDERS[item.account_type] || 'other';
  const known = findKnownAccount(item.institution, item.account_number);

  let subfolder;
  if (known) {
    subfolder = known.r2Sub;
  } else {
    // Build a reasonable subfolder: institution-accountname-number
    const parts = [item.institution, item.account_name, item.account_number]
      .filter(Boolean)
      .map(s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));
    subfolder = parts.join('-') || 'unknown';
  }

  const date = item.statement_date || '0000-00';
  const yyyy = date.slice(0, 4);
  const mm = date.slice(5, 7);
  const filename = `${yyyy}-${mm}.pdf`;

  return `${folder}/${subfolder}/${filename}`;
}

// ── Download file from URL to temp path ─────────────────────────────────────
async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buffer);
  return buffer.length;
}

// ── Upload PDF to R2 via S3-compatible API ──────────────────────────────────
async function uploadToR2(localPath, r2Key) {
  const { readFileSync } = await import('fs');
  const { createHmac, createHash } = await import('crypto');

  const bucket = 'financial-statements';
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKey || !secretKey) throw new Error('Missing R2 credentials in .env');

  const body = readFileSync(localPath);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${r2Key}`;
  const method = 'PUT';
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const amzDate = dateStamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';

  const payloadHash = createHash('sha256').update(body).digest('hex');
  const canonicalUri = `/${bucket}/${r2Key}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/pdf\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStamp), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/pdf',
      'Host': host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'Authorization': authHeader,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`R2 upload failed (${res.status}): ${errText}`);
  }
}

// ── Upsert document_index row ───────────────────────────────────────────────
async function upsertDocumentIndex(item, r2Key, fileSize) {
  const date = item.statement_date || '0000-00-00';
  const year = parseInt(date.slice(0, 4)) || null;
  const month = parseInt(date.slice(5, 7)) || null;
  const known = findKnownAccount(item.institution, item.account_number);
  const filename = r2Key.split('/').pop();

  const row = {
    bucket: 'financial-statements',
    r2_key: r2Key,
    filename,
    file_type: 'pdf',
    content_type: 'application/pdf',
    file_size: fileSize,
    category: 'statement',
    account_type: item.account_type,
    institution: item.institution,
    account_name: item.account_name || (known?.r2Sub || ''),
    account_number: item.account_number || '',
    account_holder: item.account_holder || known?.holder || '',
    year,
    month,
    statement_date: item.statement_date || null,
    is_closed: false,
    original_path: `email-inbox/${item.attachment_filename}`,
  };

  const { data, error } = await supabase
    .from('document_index')
    .upsert(row, { onConflict: 'r2_key' })
    .select('id')
    .single();

  if (error) throw new Error(`document_index upsert error: ${error.message}`);
  return data.id;
}

// ── Prompts (from ingest-statements.mjs) ────────────────────────────────────
const CC_PROMPT = `Extract ALL data from this credit card/revolving credit statement PDF as JSON. Return ONLY valid JSON, no markdown fences.

Return this exact structure:
{
  "is_statement": true,
  "statement_date": "YYYY-MM-DD",
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "previous_balance": 1234.56,
  "payments_credits": -1234.56,
  "new_charges": 1234.56,
  "fees": 0.00,
  "interest_charged": 0.00,
  "new_balance": 1234.56,
  "minimum_due": 35.00,
  "payment_due_date": "YYYY-MM-DD",
  "credit_limit": 10000.00,
  "available_credit": 8000.00,
  "transactions": [
    {
      "transaction_date": "YYYY-MM-DD",
      "posting_date": "YYYY-MM-DD or null",
      "description": "MERCHANT NAME LOCATION",
      "amount": 45.67,
      "reference_number": "ABC123 or null",
      "category": "Dining or null",
      "daily_cash": 0.50,
      "foreign_spend_amount": null,
      "foreign_spend_currency": null
    }
  ]
}

Rules:
- Positive amounts = charges/purchases. Negative = credits/payments/refunds.
- Include EVERY transaction — purchases, payments, credits, fees, interest charges. Do not skip any.
- For statement_date, use the closing date or statement date shown on the statement.
- If the PDF is NOT a credit card/revolving credit statement (e.g. it's a letter, notice, or other document), return: {"is_statement": false}
- daily_cash is Apple Card specific — include if present, otherwise null.
- foreign_spend_amount/currency: include if foreign transaction details shown, otherwise null.
- For the year in transaction dates, infer from the statement period (some statements only show MM/DD).`;

const CHECKING_PROMPT = `Extract ALL data from this bank checking account statement PDF as JSON. Return ONLY valid JSON, no markdown fences.

Return this exact structure:
{
  "is_statement": true,
  "statement_date": "YYYY-MM-DD",
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "beginning_balance": 1234.56,
  "total_deposits": 5000.00,
  "total_withdrawals": -4000.00,
  "fees": 0.00,
  "interest_earned": 0.01,
  "ending_balance": 2234.57,
  "transactions": [
    {
      "transaction_date": "YYYY-MM-DD",
      "description": "ELECTRONIC WITHDRAWAL TO VENDOR",
      "amount": -150.00,
      "running_balance": 1084.57,
      "check_number": "1234 or null",
      "transaction_type": "withdrawal",
      "ref_number": "REF123 or null"
    }
  ]
}

Rules:
- Positive amounts = deposits/credits. Negative = withdrawals/debits/checks.
- Include EVERY transaction. Do not skip any.
- transaction_type: one of "deposit", "withdrawal", "transfer", "fee", "interest", "check"
- running_balance: include if shown on the statement, otherwise null.
- check_number: include for check transactions if shown.
- If the PDF is NOT a checking statement, return: {"is_statement": false}
- For the year in transaction dates, infer from the statement period.`;

const INVESTMENT_PROMPT = `Extract ALL data from this investment/brokerage/IRA/crypto statement PDF as JSON. Return ONLY valid JSON, no markdown fences.

Return this exact structure:
{
  "is_statement": true,
  "statement_date": "YYYY-MM-DD",
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "starting_value": 50000.00,
  "ending_value": 52000.00,
  "total_change_dollars": 2000.00,
  "total_change_pct": 4.00,
  "credits": null, "debits": null,
  "transfers_in": null, "transfers_out": null,
  "income_reinvested": null, "change_in_value": null,
  "starting_cash": null, "ending_cash": null,
  "total_income": null, "bank_sweep_interest": null,
  "dividends": null, "capital_gains_distributions": null,
  "interest_earned": null,
  "realized_gain_loss_short": null, "realized_gain_loss_long": null,
  "unrealized_gain_loss": null,
  "margin_loan_balance": null, "margin_loan_rate": null,
  "holdings": [
    {
      "security_name": "APPLE INC", "ticker_symbol": "AAPL", "cusip": null,
      "asset_class": "equity", "quantity": 100.0, "market_price": 150.25,
      "market_value": 15025.00, "cost_basis": 12000.00, "unrealized_gain_loss": 3025.00,
      "pct_of_account": 28.89, "estimated_yield": 0.55,
      "estimated_annual_income": 82.50, "marginable": true
    }
  ],
  "transactions": [
    {
      "trade_date": "YYYY-MM-DD", "settle_date": "YYYY-MM-DD or null",
      "transaction_type": "Buy", "description": "BOUGHT AAPL",
      "security_name": "APPLE INC", "ticker_symbol": "AAPL",
      "quantity": 10, "unit_price": 150.25,
      "charges_and_interest": null, "subtotal": null,
      "total_amount": -1502.50, "notes": null
    }
  ],
  "realized_gains": [
    {
      "security_name": "MSFT", "ticker_symbol": "MSFT", "quantity": 5,
      "acquired_date": "YYYY-MM-DD", "sold_date": "YYYY-MM-DD",
      "proceeds": 2000.00, "cost_basis": 1500.00, "gain_loss": 500.00, "term": "long"
    }
  ]
}

Rules:
- asset_class: one of "equity", "fixed_income", "option", "crypto", "cash_equivalent", "etf", "mutual_fund"
- transaction_type: one of "Buy", "Sell", "Reinvest", "Dividend", "Interest", "Transfer", "Convert", "Rewards", "Fee", "Short", "Cover", "Assigned", "Expired"
- term: "short" or "long"
- Include ALL holdings, ALL transactions, and ALL realized gain/loss entries.
- For crypto statements: use asset ticker (BTC, ETH, etc.) as ticker_symbol, high precision for quantity.
- If the PDF is NOT an investment/brokerage statement, return: {"is_statement": false}
- Use null for fields not present in the statement.`;

const LOAN_PROMPT = `Extract ALL data from this loan statement (HELOC, mortgage, or auto loan) PDF as JSON. Return ONLY valid JSON, no markdown fences.

Return this exact structure:
{
  "is_statement": true,
  "loan_type": "heloc or mortgage or auto-loan",
  "statement_date": "YYYY-MM-DD",
  "period_start": "YYYY-MM-DD or null",
  "period_end": "YYYY-MM-DD or null",
  "principal_balance": 150000.00,
  "interest_rate": 5.25,
  "credit_limit": null, "available_credit": null,
  "total_payment_due": 1500.00, "minimum_payment": null,
  "payment_due_date": "YYYY-MM-DD",
  "principal_portion": 500.00, "interest_portion": 800.00,
  "escrow_balance": null, "escrow_payment": null,
  "past_due_amount": null, "late_fee": null, "grace_date": null,
  "finance_charge": null, "daily_periodic_rate": null,
  "ytd_principal_paid": null, "ytd_interest_paid": null,
  "ytd_escrow_paid": null, "ytd_fees_paid": null,
  "maturity_date": null, "end_of_draw_date": null,
  "vehicle_description": null, "vin": null, "property_address": null,
  "transactions": [
    {
      "transaction_date": "YYYY-MM-DD",
      "description": "PAYMENT RECEIVED",
      "amount": -1500.00,
      "principal_amount": -500.00,
      "interest_amount": -800.00,
      "other_amount": -200.00,
      "transaction_type": "payment"
    }
  ]
}

Rules:
- loan_type: "heloc", "mortgage", or "auto-loan"
- transaction_type: one of "payment", "disbursement", "fee", "interest", "escrow", "advance"
- Negative amounts = payments to the loan. Positive = disbursements/charges.
- interest_rate is the APR as a percentage (e.g. 5.25 not 0.0525).
- Include ALL transactions shown on the statement.
- If the PDF is NOT a loan statement, return: {"is_statement": false}
- Use null for fields not present.`;

function getTableType(accountType) {
  if (accountType === 'credit-card' || accountType === 'credit-line') return 'cc';
  if (accountType === 'checking') return 'checking';
  if (accountType === 'brokerage' || accountType === 'ira' || accountType === 'crypto') return 'investment';
  if (accountType === 'heloc' || accountType === 'auto-loan' || accountType === 'mortgage') return 'loan';
  return null;
}

function getPrompt(accountType) {
  const tt = getTableType(accountType);
  if (tt === 'cc') return CC_PROMPT;
  if (tt === 'checking') return CHECKING_PROMPT;
  if (tt === 'investment') return INVESTMENT_PROMPT;
  if (tt === 'loan') return LOAN_PROMPT;
  return CC_PROMPT; // fallback
}

// ── Parse PDF with Claude CLI ────────────────────────────────────────────────
async function parsePdfWithClaude(pdfPath, accountType) {
  const prompt = getPrompt(accountType);
  const promptPath = pdfPath.replace('.pdf', '-prompt.txt');
  const fullPrompt = `Read the PDF file at ${pdfPath} and extract the data.\n\n${prompt}`;
  writeFileSync(promptPath, fullPrompt);

  const cmd = `cat ${shellEsc(promptPath)} | CLAUDECODE="" claude --print --model ${MODEL} --allowedTools Read --max-turns 4`;

  try {
    const { stdout } = await execAsync(cmd, {
      timeout: 180000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const text = stdout.trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const cleaned = text.slice(jsonStart, jsonEnd + 1);
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        console.error(`  ✗ JSON parse error: ${e.message}`);
        return null;
      }
    }

    console.error(`  ✗ No JSON found in response (first 200 chars): ${text.slice(0, 200)}`);
    return null;
  } catch (e) {
    console.error(`  ✗ Claude CLI error: ${e.message?.slice(0, 100)}`);
    return null;
  } finally {
    try { unlinkSync(promptPath); } catch { /* ignore */ }
  }
}

// ── Insert functions (from ingest-statements.mjs) ───────────────────────────
async function insertCcStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.document_id,
    r2_key: doc.r2_key,
    source_file_name: doc.attachment_filename,
    institution: doc.institution,
    account_name: doc.account_name,
    account_number: doc.account_number,
    account_holder: doc.account_holder,
    statement_date: parsed.statement_date,
    period_start: parsed.period_start || null,
    period_end: parsed.period_end || null,
    previous_balance: parsed.previous_balance,
    payments_credits: parsed.payments_credits,
    new_charges: parsed.new_charges,
    fees: parsed.fees,
    interest_charged: parsed.interest_charged,
    new_balance: parsed.new_balance,
    minimum_due: parsed.minimum_due,
    payment_due_date: parsed.payment_due_date || null,
    credit_limit: parsed.credit_limit,
    available_credit: parsed.available_credit,
  };

  const { data: summary, error: sumErr } = await supabase
    .from('cc_statement_summaries')
    .insert(summaryRow)
    .select('id')
    .single();

  if (sumErr) {
    console.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.transaction_date && t.description && t.amount != null)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.document_id,
      institution: doc.institution,
      account_name: doc.account_name,
      account_number: doc.account_number,
      account_holder: doc.account_holder,
      statement_date: parsed.statement_date,
      transaction_date: t.transaction_date,
      posting_date: t.posting_date || null,
      description: t.description,
      amount: t.amount,
      reference_number: t.reference_number || null,
      category: t.category || null,
      daily_cash: t.daily_cash || null,
      foreign_spend_amount: t.foreign_spend_amount || null,
      foreign_spend_currency: t.foreign_spend_currency || null,
    }));

  if (txns.length > 0) {
    for (let i = 0; i < txns.length; i += 200) {
      const batch = txns.slice(i, i + 200);
      const { error: txnErr } = await supabase.from('cc_transactions').insert(batch);
      if (txnErr) {
        console.error(`  ✗ Transaction insert error (batch ${i}): ${txnErr.message}`);
        return false;
      }
    }
  }

  return true;
}

async function insertCheckingStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.document_id,
    r2_key: doc.r2_key,
    source_file_name: doc.attachment_filename,
    institution: doc.institution,
    account_name: doc.account_name,
    account_number: doc.account_number,
    account_holder: doc.account_holder,
    statement_date: parsed.statement_date,
    period_start: parsed.period_start || null,
    period_end: parsed.period_end || null,
    beginning_balance: parsed.beginning_balance,
    total_deposits: parsed.total_deposits,
    total_withdrawals: parsed.total_withdrawals,
    fees: parsed.fees,
    interest_earned: parsed.interest_earned,
    ending_balance: parsed.ending_balance,
  };

  const { data: summary, error: sumErr } = await supabase
    .from('checking_statement_summaries')
    .insert(summaryRow)
    .select('id')
    .single();

  if (sumErr) {
    console.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.transaction_date && t.description && t.amount != null)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.document_id,
      institution: doc.institution,
      account_name: doc.account_name,
      account_number: doc.account_number,
      account_holder: doc.account_holder,
      statement_date: parsed.statement_date,
      transaction_date: t.transaction_date,
      description: t.description,
      amount: t.amount,
      running_balance: t.running_balance || null,
      check_number: t.check_number || null,
      transaction_type: t.transaction_type || null,
      ref_number: t.ref_number || null,
    }));

  if (txns.length > 0) {
    for (let i = 0; i < txns.length; i += 200) {
      const batch = txns.slice(i, i + 200);
      const { error: txnErr } = await supabase.from('checking_transactions').insert(batch);
      if (txnErr) {
        console.error(`  ✗ Transaction insert error (batch ${i}): ${txnErr.message}`);
        return false;
      }
    }
  }

  return true;
}

async function insertInvestmentStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.document_id,
    r2_key: doc.r2_key,
    source_file_name: doc.attachment_filename,
    institution: doc.institution,
    account_name: doc.account_name,
    account_number: doc.account_number,
    account_holder: doc.account_holder,
    statement_date: parsed.statement_date,
    period_start: parsed.period_start || null,
    period_end: parsed.period_end || null,
    starting_value: parsed.starting_value,
    ending_value: parsed.ending_value,
    total_change_dollars: parsed.total_change_dollars,
    total_change_pct: parsed.total_change_pct,
    credits: parsed.credits,
    debits: parsed.debits,
    transfers_in: parsed.transfers_in,
    transfers_out: parsed.transfers_out,
    income_reinvested: parsed.income_reinvested,
    change_in_value: parsed.change_in_value,
    starting_cash: parsed.starting_cash,
    ending_cash: parsed.ending_cash,
    total_income: parsed.total_income,
    bank_sweep_interest: parsed.bank_sweep_interest,
    dividends: parsed.dividends,
    capital_gains_distributions: parsed.capital_gains_distributions,
    interest_earned: parsed.interest_earned,
    realized_gain_loss_short: parsed.realized_gain_loss_short,
    realized_gain_loss_long: parsed.realized_gain_loss_long,
    unrealized_gain_loss: parsed.unrealized_gain_loss,
    margin_loan_balance: parsed.margin_loan_balance,
    margin_loan_rate: parsed.margin_loan_rate,
  };

  const { data: summary, error: sumErr } = await supabase
    .from('investment_statement_summaries')
    .insert(summaryRow)
    .select('id')
    .single();

  if (sumErr) {
    console.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const holdings = (parsed.holdings || [])
    .filter(h => h.security_name)
    .map(h => ({
      summary_id: summary.id,
      document_id: doc.document_id,
      institution: doc.institution,
      account_name: doc.account_name,
      statement_date: parsed.statement_date,
      security_name: h.security_name,
      ticker_symbol: h.ticker_symbol || null,
      cusip: h.cusip || null,
      asset_class: h.asset_class || null,
      quantity: h.quantity,
      market_price: h.market_price,
      market_value: h.market_value,
      cost_basis: h.cost_basis || null,
      unrealized_gain_loss: h.unrealized_gain_loss || null,
      pct_of_account: h.pct_of_account || null,
      estimated_yield: h.estimated_yield || null,
      estimated_annual_income: h.estimated_annual_income || null,
      marginable: h.marginable ?? null,
    }));

  if (holdings.length > 0) {
    for (let i = 0; i < holdings.length; i += 200) {
      const batch = holdings.slice(i, i + 200);
      const { error } = await supabase.from('holdings_snapshots').insert(batch);
      if (error) {
        console.error(`  ✗ Holdings insert error: ${error.message}`);
        return false;
      }
    }
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.description)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.document_id,
      institution: doc.institution,
      account_name: doc.account_name,
      statement_date: parsed.statement_date,
      trade_date: t.trade_date || null,
      settle_date: t.settle_date || null,
      transaction_type: t.transaction_type || null,
      description: t.description,
      security_name: t.security_name || null,
      ticker_symbol: t.ticker_symbol || null,
      quantity: t.quantity || null,
      unit_price: t.unit_price || null,
      charges_and_interest: t.charges_and_interest || null,
      subtotal: t.subtotal || null,
      total_amount: t.total_amount || null,
      notes: t.notes || null,
    }));

  if (txns.length > 0) {
    for (let i = 0; i < txns.length; i += 200) {
      const batch = txns.slice(i, i + 200);
      const { error } = await supabase.from('investment_transactions').insert(batch);
      if (error) {
        console.error(`  ✗ Transaction insert error: ${error.message}`);
        return false;
      }
    }
  }

  const gains = (parsed.realized_gains || [])
    .filter(g => g.security_name)
    .map(g => ({
      summary_id: summary.id,
      document_id: doc.document_id,
      institution: doc.institution,
      account_name: doc.account_name,
      statement_date: parsed.statement_date,
      security_name: g.security_name,
      ticker_symbol: g.ticker_symbol || null,
      quantity: g.quantity || null,
      acquired_date: g.acquired_date || null,
      sold_date: g.sold_date || null,
      proceeds: g.proceeds || null,
      cost_basis: g.cost_basis || null,
      gain_loss: g.gain_loss || null,
      term: g.term || null,
    }));

  if (gains.length > 0) {
    for (let i = 0; i < gains.length; i += 200) {
      const batch = gains.slice(i, i + 200);
      const { error } = await supabase.from('realized_gain_loss').insert(batch);
      if (error) {
        console.error(`  ✗ Realized gains insert error: ${error.message}`);
        return false;
      }
    }
  }

  return true;
}

async function insertLoanStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.document_id,
    r2_key: doc.r2_key,
    source_file_name: doc.attachment_filename,
    institution: doc.institution,
    account_name: doc.account_name,
    account_number: doc.account_number,
    account_holder: doc.account_holder,
    loan_type: parsed.loan_type || doc.account_type,
    statement_date: parsed.statement_date,
    period_start: parsed.period_start || null,
    period_end: parsed.period_end || null,
    principal_balance: parsed.principal_balance,
    interest_rate: parsed.interest_rate,
    credit_limit: parsed.credit_limit || null,
    available_credit: parsed.available_credit || null,
    total_payment_due: parsed.total_payment_due,
    minimum_payment: parsed.minimum_payment || null,
    payment_due_date: parsed.payment_due_date || null,
    principal_portion: parsed.principal_portion || null,
    interest_portion: parsed.interest_portion || null,
    escrow_balance: parsed.escrow_balance || null,
    escrow_payment: parsed.escrow_payment || null,
    past_due_amount: parsed.past_due_amount || null,
    late_fee: parsed.late_fee || null,
    grace_date: parsed.grace_date || null,
    finance_charge: parsed.finance_charge || null,
    daily_periodic_rate: parsed.daily_periodic_rate || null,
    ytd_principal_paid: parsed.ytd_principal_paid || null,
    ytd_interest_paid: parsed.ytd_interest_paid || null,
    ytd_escrow_paid: parsed.ytd_escrow_paid || null,
    ytd_fees_paid: parsed.ytd_fees_paid || null,
    maturity_date: parsed.maturity_date || null,
    end_of_draw_date: parsed.end_of_draw_date || null,
    vehicle_description: parsed.vehicle_description || null,
    vin: parsed.vin || null,
    property_address: parsed.property_address || null,
  };

  const { data: summary, error: sumErr } = await supabase
    .from('loan_statement_summaries')
    .insert(summaryRow)
    .select('id')
    .single();

  if (sumErr) {
    console.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.transaction_date && t.description)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.document_id,
      institution: doc.institution,
      account_name: doc.account_name,
      statement_date: parsed.statement_date,
      transaction_date: t.transaction_date,
      description: t.description,
      amount: t.amount || 0,
      principal_amount: t.principal_amount || null,
      interest_amount: t.interest_amount || null,
      other_amount: t.other_amount || null,
      transaction_type: t.transaction_type || null,
    }));

  if (txns.length > 0) {
    for (let i = 0; i < txns.length; i += 200) {
      const batch = txns.slice(i, i + 200);
      const { error } = await supabase.from('loan_transactions').insert(batch);
      if (error) {
        console.error(`  ✗ Loan txn insert error: ${error.message}`);
        return false;
      }
    }
  }

  return true;
}

// ── Process a single inbox item ─────────────────────────────────────────────
async function processItem(item) {
  const label = `${item.institution || '?'}/${item.account_type || '?'} ${item.statement_date || '?'}`;
  console.log(`\n  → Processing: ${label} (${item.attachment_filename})`);

  // Mark as processing
  await supabase
    .from('statement_inbox')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', item.id);

  const tmpPath = `/tmp/inbox-${item.id}.pdf`;

  try {
    // 1. Download PDF from Supabase Storage
    console.log(`    Downloading from storage...`);
    const fileSize = await downloadToFile(item.attachment_url, tmpPath);
    console.log(`    Downloaded ${(fileSize / 1024).toFixed(0)} KB`);

    // 2. Build R2 key and upload
    const r2Key = buildR2Key(item);
    console.log(`    R2 key: ${r2Key}`);

    if (!DRY_RUN) {
      console.log(`    Uploading to R2...`);
      await uploadToR2(tmpPath, r2Key);
    }

    // 3. Upsert document_index
    let documentId = null;
    if (!DRY_RUN) {
      console.log(`    Indexing in document_index...`);
      documentId = await upsertDocumentIndex(item, r2Key, fileSize);

      await supabase
        .from('statement_inbox')
        .update({ status: 'indexed', r2_key: r2Key, document_id: documentId, updated_at: new Date().toISOString() })
        .eq('id', item.id);
    }

    // 4. Parse with Claude CLI
    console.log(`    Parsing with Claude (${MODEL})...`);
    const parsed = await parsePdfWithClaude(tmpPath, item.account_type);

    if (!parsed) {
      throw new Error('Claude CLI returned no parseable JSON');
    }

    if (parsed.is_statement === false) {
      console.log(`    SKIPPED — not a statement`);
      await supabase
        .from('statement_inbox')
        .update({ status: 'error', error_message: 'Not a statement (Claude)', updated_at: new Date().toISOString() })
        .eq('id', item.id);
      return { status: 'not_statement' };
    }

    const txnCount = (parsed.transactions || []).length + (parsed.holdings || []).length;

    if (DRY_RUN) {
      console.log(`    ✓ Parsed: ${txnCount} items (dry-run, not inserting)`);
      return { status: 'dry_run', txnCount };
    }

    // 5. Insert into statement tables
    // Enrich the item with document_id and r2_key for insert functions
    const doc = { ...item, document_id: documentId, r2_key: r2Key };

    const tableType = getTableType(item.account_type);
    let ok = false;

    if (tableType === 'cc') ok = await insertCcStatement(doc, parsed);
    else if (tableType === 'checking') ok = await insertCheckingStatement(doc, parsed);
    else if (tableType === 'investment') ok = await insertInvestmentStatement(doc, parsed);
    else if (tableType === 'loan') ok = await insertLoanStatement(doc, parsed);
    else {
      console.log(`    SKIPPED — unsupported account type: ${item.account_type}`);
      return { status: 'unsupported_type' };
    }

    if (ok) {
      console.log(`    ✓ Inserted: ${txnCount} items`);
      await supabase
        .from('statement_inbox')
        .update({ status: 'parsed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', item.id);
      return { status: 'success', txnCount };
    } else {
      throw new Error('Insert failed');
    }
  } catch (err) {
    console.error(`    ✗ Error: ${err.message}`);
    await supabase
      .from('statement_inbox')
      .update({ status: 'error', error_message: err.message?.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', item.id);
    return { status: 'error' };
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  Statement Inbox Processor               ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Limit: ${LIMIT} | Model: ${MODEL}\n`);

  // Fetch pending items
  let query = supabase
    .from('statement_inbox')
    .select('*')
    .in('status', ['pending', 'indexed'])
    .order('created_at', { ascending: true })
    .limit(LIMIT);

  if (SPECIFIC_ID) {
    query = supabase
      .from('statement_inbox')
      .select('*')
      .eq('id', SPECIFIC_ID);
  }

  const { data: items, error } = await query;
  if (error) throw new Error(`Query error: ${error.message}`);

  console.log(`Found ${items?.length || 0} pending statement(s)\n`);
  if (!items?.length) return;

  const stats = { success: 0, dry_run: 0, error: 0, not_statement: 0, unsupported_type: 0, totalTxns: 0 };
  const startTime = Date.now();

  // Process sequentially (Claude CLI is the bottleneck)
  for (const item of items) {
    const result = await processItem(item);
    stats[result.status] = (stats[result.status] || 0) + 1;
    if (result.txnCount) stats.totalTxns += result.txnCount;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n══════════════════════════════════════════`);
  console.log(`COMPLETE in ${elapsed}s`);
  console.log(`  Successful: ${stats.success + stats.dry_run}`);
  console.log(`  Items extracted: ${stats.totalTxns}`);
  console.log(`  Errors: ${stats.error}`);
  console.log(`  Not statements: ${stats.not_statement}`);
  console.log(`  Unsupported type: ${stats.unsupported_type}`);
  console.log(`══════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
