#!/usr/bin/env node
/**
 * Ingest statement PDFs from R2 into Supabase.
 *
 * Supports: credit-card, checking, credit-line, brokerage, ira, crypto, heloc, auto-loan, mortgage, closed
 *
 * Usage:
 *   node scripts/ingest-statements.mjs                          # All account types
 *   node scripts/ingest-statements.mjs --account-type credit-card
 *   node scripts/ingest-statements.mjs --account-type brokerage
 *   node scripts/ingest-statements.mjs --dry-run --sample       # Parse 1 PDF per account, don't insert
 *   node scripts/ingest-statements.mjs --institution amex       # Only Amex statements
 *   node scripts/ingest-statements.mjs --concurrency 3          # Process 3 PDFs at a time
 */

import { exec } from 'child_process';
import { unlinkSync, writeFileSync } from 'fs';
import { promisify } from 'util';

import {
  loadSupabaseEnv,
  createSupabaseClient,
  createLogger,
  parseArgs,
  retry,
  run,
  fetchAllPages,
  FatalError,
} from './lib/index.mjs';

const execAsync = promisify(exec);

const env = loadSupabaseEnv();
const supabase = createSupabaseClient({ env });

// ── CLI args ────────────────────────────────────────────────────────────────
const cliArgs = parseArgs(process.argv.slice(2), {
  booleans: ['sample'],
  numbers: { concurrency: 2 },
  strings: ['account-type', 'institution'],
  help: `Ingest statement PDFs from R2 into Supabase.

Usage: node scripts/ingest-statements.mjs [options]

Options:
  --account-type TYPE    filter to one account type
  --institution NAME     filter by institution (e.g. amex)
  --concurrency N        concurrent PDFs to parse (default 2)
  --sample               1 PDF per account, for smoke testing
  --dry-run              parse but don't insert
  --verbose              show debug logs
  --help                 this text
`,
});

const DRY_RUN = cliArgs.dryRun;
const SAMPLE = cliArgs.sample;
const ACCOUNT_TYPE = cliArgs.accountType;
const INSTITUTION_FILTER = cliArgs.institution;
const CONCURRENCY = cliArgs.concurrency;
const MODEL = 'sonnet';

const log = createLogger({ verbose: cliArgs.verbose });

const ALL_TYPES = ['credit-card', 'checking', 'credit-line', 'brokerage', 'ira', 'crypto', 'heloc', 'auto-loan', 'mortgage', 'closed'];

// ── Account type → table mapping ────────────────────────────────────────────
// credit-line uses same tables as credit-card
// closed accounts are mixed types — we detect from content
function getTableType(accountType) {
  if (accountType === 'credit-card' || accountType === 'credit-line') return 'cc';
  if (accountType === 'checking') return 'checking';
  if (accountType === 'brokerage' || accountType === 'ira' || accountType === 'crypto') return 'investment';
  if (accountType === 'heloc' || accountType === 'auto-loan' || accountType === 'mortgage') return 'loan';
  if (accountType === 'closed') return 'closed'; // determined at parse time
  return null;
}

// ── Prompts ─────────────────────────────────────────────────────────────────
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
  "credits": null,
  "debits": null,
  "transfers_in": null,
  "transfers_out": null,
  "income_reinvested": null,
  "change_in_value": null,
  "starting_cash": null,
  "ending_cash": null,
  "total_income": null,
  "bank_sweep_interest": null,
  "dividends": null,
  "capital_gains_distributions": null,
  "interest_earned": null,
  "realized_gain_loss_short": null,
  "realized_gain_loss_long": null,
  "unrealized_gain_loss": null,
  "margin_loan_balance": null,
  "margin_loan_rate": null,
  "holdings": [
    {
      "security_name": "APPLE INC",
      "ticker_symbol": "AAPL",
      "cusip": null,
      "asset_class": "equity",
      "quantity": 100.0,
      "market_price": 150.25,
      "market_value": 15025.00,
      "cost_basis": 12000.00,
      "unrealized_gain_loss": 3025.00,
      "pct_of_account": 28.89,
      "estimated_yield": 0.55,
      "estimated_annual_income": 82.50,
      "marginable": true
    }
  ],
  "transactions": [
    {
      "trade_date": "YYYY-MM-DD",
      "settle_date": "YYYY-MM-DD or null",
      "transaction_type": "Buy",
      "description": "BOUGHT AAPL",
      "security_name": "APPLE INC",
      "ticker_symbol": "AAPL",
      "quantity": 10,
      "unit_price": 150.25,
      "charges_and_interest": null,
      "subtotal": null,
      "total_amount": -1502.50,
      "notes": null
    }
  ],
  "realized_gains": [
    {
      "security_name": "MSFT",
      "ticker_symbol": "MSFT",
      "quantity": 5,
      "acquired_date": "YYYY-MM-DD",
      "sold_date": "YYYY-MM-DD",
      "proceeds": 2000.00,
      "cost_basis": 1500.00,
      "gain_loss": 500.00,
      "term": "long"
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
  "credit_limit": null,
  "available_credit": null,
  "total_payment_due": 1500.00,
  "minimum_payment": null,
  "payment_due_date": "YYYY-MM-DD",
  "principal_portion": 500.00,
  "interest_portion": 800.00,
  "escrow_balance": null,
  "escrow_payment": null,
  "past_due_amount": null,
  "late_fee": null,
  "grace_date": null,
  "finance_charge": null,
  "daily_periodic_rate": null,
  "ytd_principal_paid": null,
  "ytd_interest_paid": null,
  "ytd_escrow_paid": null,
  "ytd_fees_paid": null,
  "maturity_date": null,
  "end_of_draw_date": null,
  "vehicle_description": null,
  "vin": null,
  "property_address": null,
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

const CLOSED_PROMPT = `This is a statement from a closed financial account. First identify what type of statement it is, then extract ALL data.

If it's a CREDIT CARD or revolving credit statement, return the same JSON format as a credit card statement:
{"is_statement": true, "detected_type": "credit-card", "statement_date": "YYYY-MM-DD", "period_start": ..., "period_end": ..., "previous_balance": ..., "payments_credits": ..., "new_charges": ..., "fees": ..., "interest_charged": ..., "new_balance": ..., "minimum_due": ..., "payment_due_date": ..., "credit_limit": ..., "available_credit": ..., "transactions": [...]}

If it's a CHECKING/SAVINGS statement, return:
{"is_statement": true, "detected_type": "checking", "statement_date": "YYYY-MM-DD", "period_start": ..., "period_end": ..., "beginning_balance": ..., "total_deposits": ..., "total_withdrawals": ..., "fees": ..., "interest_earned": ..., "ending_balance": ..., "transactions": [...]}

Return ONLY valid JSON, no markdown fences.
- Positive amounts for charges/withdrawals, negative for credits/deposits (credit card) or positive for deposits, negative for withdrawals (checking).
- Include EVERY transaction.
- If the PDF is NOT a financial statement, return: {"is_statement": false}`;

function getPrompt(accountType) {
  const tt = getTableType(accountType);
  if (tt === 'cc') return CC_PROMPT;
  if (tt === 'checking') return CHECKING_PROMPT;
  if (tt === 'investment') return INVESTMENT_PROMPT;
  if (tt === 'loan') return LOAN_PROMPT;
  if (tt === 'closed') return CLOSED_PROMPT;
  return CC_PROMPT; // fallback
}

// ── Shell escape ────────────────────────────────────────────────────────────
function shellEsc(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Fetch documents from Supabase ───────────────────────────────────────────
async function fetchStatements() {
  let q = supabase
    .from('document_index')
    .select('*')
    .eq('category', 'statement')
    .eq('file_type', 'pdf')
    .order('institution')
    .order('account_name')
    .order('year', { ascending: true })
    .order('month', { ascending: true });

  const accountTypes = ACCOUNT_TYPE ? [ACCOUNT_TYPE] : ALL_TYPES;
  q = q.in('account_type', accountTypes);

  if (INSTITUTION_FILTER) q = q.eq('institution', INSTITUTION_FILTER);

  const { data, error } = await q;
  if (error) throw new FatalError(`Supabase query error: ${error.message}`, { cause: error });
  return data || [];
}

// ── Check what's already ingested ───────────────────────────────────────────
async function getIngestedDocIds() {
  const ids = new Set();
  const tables = [
    'cc_statement_summaries',
    'checking_statement_summaries',
    'investment_statement_summaries',
    'loan_statement_summaries',
  ];

  for (const table of tables) {
    const rows = await fetchAllPages((offset, limit) =>
      supabase.from(table).select('document_id').range(offset, offset + limit - 1)
    );
    rows.forEach(d => ids.add(d.document_id));
  }

  return ids;
}

// ── Download PDF from R2 ────────────────────────────────────────────────────
async function downloadPdf(bucket, r2Key) {
  const tmpPath = `/tmp/stmt-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  const cmd = `wrangler r2 object get ${shellEsc(bucket + '/' + r2Key)} --file=${shellEsc(tmpPath)} --remote`;
  try {
    // retry() gives us exponential backoff on transient wrangler / network failures.
    await retry(
      () => execAsync(cmd, { timeout: 60000, cwd: '/Users/rahulio/Documents/CodingProjects/finleg' }),
      { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 10000,
        onRetry: (err, attempt) => log.warn(`  ⟳ R2 download retry ${attempt} for ${r2Key}: ${err.message?.slice(0, 80)}`) }
    );
    return tmpPath;
  } catch (e) {
    log.error(`  ✗ Download failed: ${r2Key}: ${e.message?.slice(0, 80)}`);
    return null;
  }
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
        log.error(`  ✗ JSON parse error: ${e.message}`);
        log.error(`  Raw (first 300 chars): ${text.slice(0, 300)}`);
        return null;
      }
    }

    log.error(`  ✗ No JSON found in response (first 200 chars): ${text.slice(0, 200)}`);
    return null;
  } catch (e) {
    log.error(`  ✗ Claude CLI error: ${e.message?.slice(0, 100)}`);
    return null;
  } finally {
    try { unlinkSync(promptPath); } catch (e) { /* ignore */ }
  }
}

// ── Insert CC statement ─────────────────────────────────────────────────────
async function insertCcStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.id,
    r2_key: doc.r2_key,
    source_file_name: doc.filename,
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
    log.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.transaction_date && t.description && t.amount != null)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.id,
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
        log.error(`  ✗ Transaction insert error (batch ${i}): ${txnErr.message}`);
        return false;
      }
    }
  }

  return true;
}

// ── Insert checking statement ───────────────────────────────────────────────
async function insertCheckingStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.id,
    r2_key: doc.r2_key,
    source_file_name: doc.filename,
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
    log.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.transaction_date && t.description && t.amount != null)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.id,
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
        log.error(`  ✗ Transaction insert error (batch ${i}): ${txnErr.message}`);
        return false;
      }
    }
  }

  return true;
}

// ── Insert investment statement ─────────────────────────────────────────────
async function insertInvestmentStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.id,
    r2_key: doc.r2_key,
    source_file_name: doc.filename,
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
    log.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  // Holdings
  const holdings = (parsed.holdings || [])
    .filter(h => h.security_name)
    .map(h => ({
      summary_id: summary.id,
      document_id: doc.id,
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
        log.error(`  ✗ Holdings insert error: ${error.message}`);
        return false;
      }
    }
  }

  // Transactions
  const txns = (parsed.transactions || [])
    .filter(t => t.description)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.id,
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
        log.error(`  ✗ Transaction insert error: ${error.message}`);
        return false;
      }
    }
  }

  // Realized gains
  const gains = (parsed.realized_gains || [])
    .filter(g => g.security_name)
    .map(g => ({
      summary_id: summary.id,
      document_id: doc.id,
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
        log.error(`  ✗ Realized gains insert error: ${error.message}`);
        return false;
      }
    }
  }

  return true;
}

// ── Insert loan statement ───────────────────────────────────────────────────
async function insertLoanStatement(doc, parsed) {
  const summaryRow = {
    document_id: doc.id,
    r2_key: doc.r2_key,
    source_file_name: doc.filename,
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
    log.error(`  ✗ Summary insert error: ${sumErr.message}`);
    return false;
  }

  const txns = (parsed.transactions || [])
    .filter(t => t.transaction_date && t.description)
    .map(t => ({
      summary_id: summary.id,
      document_id: doc.id,
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
        log.error(`  ✗ Loan txn insert error: ${error.message}`);
        return false;
      }
    }
  }

  return true;
}

// ── Process a single statement ──────────────────────────────────────────────
async function processStatement(doc) {
  const label = `${doc.institution}/${doc.account_name} ${doc.year}-${String(doc.month || 0).padStart(2, '0')}`;
  process.stdout.write(`  → ${label}...`);

  // Download
  const pdfPath = await downloadPdf(doc.bucket, doc.r2_key);
  if (!pdfPath) return { status: 'download_failed' };

  try {
    // Parse with Claude
    const parsed = await parsePdfWithClaude(pdfPath, doc.account_type);
    if (!parsed) return { status: 'parse_failed' };

    if (parsed.is_statement === false) {
      log.info(' SKIPPED (not a statement)');
      return { status: 'not_statement' };
    }

    const txnCount = (parsed.transactions || []).length + (parsed.holdings || []).length;

    if (DRY_RUN) {
      log.info(` ✓ ${txnCount} items (dry-run)`);
      return { status: 'dry_run', txnCount };
    }

    // Determine insert path
    let tableType = getTableType(doc.account_type);

    // For closed accounts, detect type from parsed content
    if (tableType === 'closed' && parsed.detected_type) {
      tableType = parsed.detected_type === 'credit-card' ? 'cc' : 'checking';
    }

    let ok = false;
    if (tableType === 'cc') {
      ok = await insertCcStatement(doc, parsed);
    } else if (tableType === 'checking') {
      ok = await insertCheckingStatement(doc, parsed);
    } else if (tableType === 'investment') {
      ok = await insertInvestmentStatement(doc, parsed);
    } else if (tableType === 'loan') {
      ok = await insertLoanStatement(doc, parsed);
    } else {
      log.info(` SKIPPED (unknown type: ${doc.account_type})`);
      return { status: 'not_statement' };
    }

    if (ok) {
      log.info(` ✓ ${txnCount} items`);
      return { status: 'success', txnCount };
    } else {
      return { status: 'insert_failed' };
    }
  } finally {
    try { unlinkSync(pdfPath); } catch (e) { /* ignore */ }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log.info(`\n╔══════════════════════════════════════════╗`);
  log.info(`║  Statement Ingestion Pipeline v2         ║`);
  log.info(`╚══════════════════════════════════════════╝`);
  log.info(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Sample: ${SAMPLE} | Model: ${MODEL}`);
  log.info(`Account type: ${ACCOUNT_TYPE || 'all'}`);
  log.info(`Concurrency: ${CONCURRENCY}\n`);

  const allDocs = await fetchStatements();
  log.info(`Found ${allDocs.length} PDF statements in document_index\n`);

  if (allDocs.length === 0) return;

  const ingestedIds = await getIngestedDocIds();
  const pending = allDocs.filter(d => !ingestedIds.has(d.id));
  log.info(`Already ingested: ${ingestedIds.size} | Pending: ${pending.length}\n`);

  let toProcess;
  if (SAMPLE) {
    const seen = new Set();
    toProcess = [];
    for (const doc of pending) {
      const key = `${doc.institution}|${doc.account_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        toProcess.push(doc);
      }
    }
    log.info(`Sample mode: processing ${toProcess.length} PDFs (1 per account)\n`);
  } else {
    toProcess = pending;
  }

  const stats = { success: 0, dry_run: 0, not_statement: 0, download_failed: 0, parse_failed: 0, insert_failed: 0, totalTxns: 0 };
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(doc => processStatement(doc)));

    for (const r of results) {
      stats[r.status] = (stats[r.status] || 0) + 1;
      if (r.txnCount) stats.totalTxns += r.txnCount;
    }

    const done = Math.min(i + CONCURRENCY, toProcess.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    if (done % 10 === 0 || done === toProcess.length) {
      log.info(`\n[${elapsed}s] Progress: ${done}/${toProcess.length} | Success: ${stats.success + stats.dry_run} | Failed: ${stats.download_failed + stats.parse_failed + stats.insert_failed}\n`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.info(`\n══════════════════════════════════════════`);
  log.info(`COMPLETE in ${elapsed}s`);
  log.info(`  Successful: ${stats.success + stats.dry_run}`);
  log.info(`  Items extracted: ${stats.totalTxns}`);
  log.info(`  Not statements: ${stats.not_statement}`);
  log.info(`  Download failed: ${stats.download_failed}`);
  log.info(`  Parse failed: ${stats.parse_failed}`);
  log.info(`  Insert failed: ${stats.insert_failed}`);
  log.info(`══════════════════════════════════════════\n`);
}

run(main);
