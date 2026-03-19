#!/usr/bin/env node
/**
 * Process Tax Returns — Hostinger batch script.
 *
 * Reads tax return PDFs, extracts data with Gemini Flash 2.5 (primary) and
 * Claude Sonnet 4.6 (verification), compares results, inserts into typed
 * tables + EAV, and emails conflicts to rahchak@gmail.com.
 *
 * Usage:
 *   node scripts/process-tax-returns.mjs --inbox                     # Poll statement_inbox for pending tax returns
 *   node scripts/process-tax-returns.mjs --dir "/path/to/pdfs"       # Process a directory of local PDFs
 *   node scripts/process-tax-returns.mjs --file "/path/to/file.pdf"  # Process single local file
 *   node scripts/process-tax-returns.mjs --dry-run --inbox           # Extract but don't insert
 *   node scripts/process-tax-returns.mjs --limit 5 --dir "/path"     # Process max 5 files
 *   node scripts/process-tax-returns.mjs --gemini-only               # Skip Claude verification
 *   node scripts/process-tax-returns.mjs --reprocess --entity "Rahul" --year 2023  # Re-extract
 */

import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'fs';
import { promisify } from 'util';
import { basename, join } from 'path';
import { createHmac, createHash } from 'crypto';
import { config } from 'dotenv';

config(); // Load .env

const execAsync = promisify(exec);

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = 'agent@finleg.net';
const NOTIFY_TO = 'rahchak@gmail.com';
const CLAUDE_MODEL = 'sonnet';

if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY in .env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const GEMINI_ONLY = args.includes('--gemini-only');
const INBOX_MODE = args.includes('--inbox');
const LIMIT = parseInt(getArg('--limit') || '100');
const DIR_PATH = getArg('--dir');
const FILE_PATH = getArg('--file');
const REPROCESS = args.includes('--reprocess');
const FILTER_ENTITY = getArg('--entity');
const FILTER_YEAR = getArg('--year');

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function shellEsc(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Known entity mapping (from filenames) ───────────────────────────────────
// Maps name patterns from filenames to entity info
const ENTITY_MAP = {
  'Sonnad Rahul': { display_name: 'Rahul Sonnad', entity_type: 'individual' },
  'Sonnad Hannah': { display_name: 'Hannah Sonnad', entity_type: 'individual' },
  'Sonnad Kathleen': { display_name: 'Kathleen Sonnad', entity_type: 'individual' },
  'Sonnad Haydn': { display_name: 'Haydn Sonnad', entity_type: 'individual' },
  'Sonnad Emina': { display_name: 'Emina Sonnad', entity_type: 'individual' },
  'Subhash Sonnad Rvoc Tr': { display_name: 'Subhash Sonnad Revocable Trust', entity_type: 'trust' },
};

// ── Form manifest prompt — first pass to inventory all forms ────────────────
const MANIFEST_PROMPT = `You are a tax return analysis system. Scan this entire PDF and list EVERY form, schedule, and worksheet present.

Return ONLY valid JSON (no markdown fences) with this structure:

{
  "return_type": "1040 | 1041 | 1065 | 1120S | 706 | 709",
  "tax_year": 2023,
  "entity_name": "Name as shown on return",
  "total_pages": 0,
  "forms": [
    {
      "form_code": "Form 1040",
      "pages": "1-2",
      "description": "U.S. Individual Income Tax Return"
    }
  ]
}

RULES:
- List EVERY form, schedule, and worksheet — even W-2s, 1099s, and state returns.
- Include the page range where each form appears.
- Common forms to look for: Form 1040, Schedule 1, 2, 3, A, B, C, D, E, SE, Form 2555, 4562, 4797, 8949, 8959, 8960, 8962, 8995, 1040-V, W-2, 1099-INT, 1099-DIV, 1099-B, 1099-NEC, 1099-MISC, K-1, Form 1041, state returns.
- Be thorough — missing a form means missing data.`;

// ── Extraction prompt — comprehensive for all tax return types ──────────────
const TAX_RETURN_PROMPT = `You are a tax return data extraction system. Extract ALL data from this tax return PDF as JSON.

First, identify what type of return this is, then extract all forms and schedules present.

Return ONLY valid JSON (no markdown fences) with this structure:

{
  "return_type": "1040 | 1041 | 1065 | 1120S | 706 | 709",
  "tax_year": 2023,
  "entity": {
    "name": "Full name as shown on return",
    "entity_type": "individual | trust | estate | partnership | corporation",
    "ssn_last4": "1234",
    "ein": "XX-XXXXXXX or null",
    "address": { "street": "...", "city": "...", "state": "XX", "zip": "XXXXX" },
    "filing_status": "single | mfj | mfs | hoh | qss | null",
    "spouse_name": "Name or null"
  },
  "preparer": {
    "name": "Preparer name or null",
    "firm": "Firm name or null",
    "ptin": "PXXXXXXXX or null",
    "firm_ein": "XX-XXXXXXX or null"
  },
  "summary": {
    "total_income": 0.00,
    "adjusted_gross_income": 0.00,
    "taxable_income": 0.00,
    "total_tax": 0.00,
    "total_payments": 0.00,
    "amount_owed": 0.00,
    "refund_amount": 0.00
  },
  "forms": {
    "form_1040": {
      "filing_status": "single | mfj | mfs | hoh | qss",
      "digital_assets_activity": false,
      "dependents": [
        { "first_name": "...", "last_name": "...", "relationship": "son", "ssn_last4": "1234", "child_tax_credit": true, "other_dependent_credit": false }
      ],
      "line_1a_w2_wages": 0.00,
      "line_1z_total_w2_income": 0.00,
      "line_2a_tax_exempt_interest": 0.00,
      "line_2b_taxable_interest": 0.00,
      "line_3a_qualified_dividends": 0.00,
      "line_3b_ordinary_dividends": 0.00,
      "line_4a_ira_distributions": 0.00,
      "line_4b_ira_taxable": 0.00,
      "line_5a_pensions_annuities": 0.00,
      "line_5b_pensions_taxable": 0.00,
      "line_6a_social_security": 0.00,
      "line_6b_social_security_taxable": 0.00,
      "line_7_capital_gain_loss": 0.00,
      "line_8_schedule1_additional_income": 0.00,
      "line_9_total_income": 0.00,
      "line_10_schedule1_adjustments": 0.00,
      "line_11_adjusted_gross_income": 0.00,
      "line_12_standard_or_itemized_deduction": 0.00,
      "line_13_qbi_deduction": 0.00,
      "line_14_total_deductions": 0.00,
      "line_15_taxable_income": 0.00,
      "line_16_tax": 0.00,
      "line_24_total_tax": 0.00,
      "line_25d_total_withholding": 0.00,
      "line_26_estimated_payments": 0.00,
      "line_33_total_payments": 0.00,
      "line_34_overpaid": 0.00,
      "line_35a_refund": 0.00,
      "line_37_amount_owed": 0.00,
      "line_38_estimated_tax_penalty": 0.00
    },
    "schedule_1": {
      "line_3_business_income_schedule_c": 0.00,
      "line_5_rental_royalty_schedule_e": 0.00,
      "line_10_total_additional_income": 0.00,
      "line_15_se_tax_deduction": 0.00,
      "line_17_se_health_insurance": 0.00,
      "line_26_total_adjustments": 0.00
    },
    "schedule_2": {
      "line_1_amt": 0.00,
      "line_4_se_tax": 0.00,
      "line_12_net_investment_income_tax": 0.00,
      "line_21_total_other_taxes": 0.00
    },
    "schedule_c": [
      {
        "business_name": "...",
        "principal_activity": "...",
        "business_code": "XXXXXX",
        "accounting_method": "cash | accrual",
        "line_1_gross_receipts": 0.00,
        "line_7_gross_income": 0.00,
        "line_28_total_expenses": 0.00,
        "line_31_net_profit_loss": 0.00,
        "expenses": {
          "line_8_advertising": 0.00,
          "line_9_car_truck": 0.00,
          "line_11_contract_labor": 0.00,
          "line_13_depreciation": 0.00,
          "line_15_insurance": 0.00,
          "line_17_legal_professional": 0.00,
          "line_18_office_expense": 0.00,
          "line_21_repairs": 0.00,
          "line_22_supplies": 0.00,
          "line_23_taxes_licenses": 0.00,
          "line_25_utilities": 0.00
        },
        "other_expenses": [
          { "description": "...", "amount": 0.00 }
        ]
      }
    ],
    "schedule_d": {
      "line_7_net_short_term": 0.00,
      "line_15_net_long_term": 0.00,
      "line_16_combined": 0.00
    },
    "form_8949_transactions": [
      {
        "holding_period": "short_term | long_term",
        "description": "100 sh XYZ Corp",
        "date_acquired": "YYYY-MM-DD or VARIOUS",
        "date_sold": "YYYY-MM-DD",
        "proceeds": 0.00,
        "cost_basis": 0.00,
        "adjustment_amount": 0.00,
        "gain_or_loss": 0.00
      }
    ],
    "schedule_e": {
      "rental_properties": [
        {
          "property_label": "A",
          "property_address": "...",
          "property_type": 1,
          "fair_rental_days": 365,
          "personal_use_days": 0,
          "line_3_rents_received": 0.00,
          "line_20_total_expenses": 0.00,
          "line_18_depreciation": 0.00,
          "line_21_net_income_loss": 0.00,
          "expenses": {
            "line_5_advertising": 0.00,
            "line_7_cleaning_maintenance": 0.00,
            "line_9_insurance": 0.00,
            "line_12_mortgage_interest": 0.00,
            "line_14_repairs": 0.00,
            "line_16_taxes": 0.00,
            "line_17_utilities": 0.00
          }
        }
      ],
      "partnerships": [
        {
          "entity_name": "...",
          "is_partnership": true,
          "passive_income": 0.00,
          "nonpassive_income": 0.00
        }
      ],
      "trusts_estates": [
        {
          "entity_name": "...",
          "passive_income": 0.00,
          "nonpassive_income": 0.00
        }
      ],
      "line_26_total_rental_royalty": 0.00,
      "line_41_total_schedule_e": 0.00
    },
    "schedule_se": {
      "line_2_net_profit": 0.00,
      "line_12_se_tax": 0.00,
      "line_13_deduction_half_se": 0.00
    },
    "schedule_a": {
      "line_4_medical_dental": 0.00,
      "line_5a_state_local_income_tax": 0.00,
      "line_5b_state_local_sales_tax": 0.00,
      "line_5d_real_estate_taxes": 0.00,
      "line_5e_personal_property_tax": 0.00,
      "line_7_total_salt": 0.00,
      "line_8a_home_mortgage_interest": 0.00,
      "line_10_total_interest": 0.00,
      "line_12_charitable_cash": 0.00,
      "line_13_charitable_noncash": 0.00,
      "line_14_total_charitable": 0.00,
      "line_17_total_itemized": 0.00
    },
    "form_4562": [
      {
        "business_or_activity": "...",
        "line_12_section_179_expense": 0.00,
        "line_14_special_depreciation": 0.00,
        "line_17_macrs_prior_years": 0.00,
        "line_22_total_depreciation": 0.00,
        "assets": [
          {
            "description": "...",
            "date_placed_in_service": "YYYY-MM-DD",
            "cost_or_basis": 0.00,
            "recovery_period": "27.5 years",
            "method": "S/L",
            "depreciation_deduction": 0.00
          }
        ]
      }
    ],
    "form_8962": {
      "line_1_family_size": 0,
      "line_3_household_income": 0.00,
      "line_5_poverty_percentage": 0.00,
      "line_24_total_ptc": 0.00,
      "line_25_advance_ptc": 0.00,
      "line_26_net_ptc": 0.00,
      "line_29_excess_repayment": 0.00
    },
    "form_8995": {
      "line_15_qbi_deduction": 0.00,
      "businesses": [
        { "trade_business_name": "...", "qualified_business_income": 0.00 }
      ]
    },
    "form_1041": {
      "trust_name": "...",
      "fiduciary_name": "...",
      "trust_ein": "XX-XXXXXXX",
      "trust_type": "simple | complex | grantor",
      "line_1_interest_income": 0.00,
      "line_2a_ordinary_dividends": 0.00,
      "line_4_capital_gain_loss": 0.00,
      "line_5_rents_royalties": 0.00,
      "line_9_total_income": 0.00,
      "line_17_adjusted_total_income": 0.00,
      "line_18_income_distribution_deduction": 0.00,
      "line_23_taxable_income": 0.00,
      "line_24_total_tax": 0.00,
      "schedule_b": {
        "line_7_distributable_net_income": 0.00,
        "line_15_income_distribution_deduction": 0.00
      },
      "schedule_g": {
        "line_1a_tax_on_taxable_income": 0.00,
        "line_5_niit": 0.00,
        "line_9_total_tax": 0.00,
        "line_19_total_payments": 0.00
      }
    },
    "schedule_k1": [
      {
        "source_form": "1041 | 1065 | 1120S",
        "issuing_entity_name": "...",
        "issuing_entity_ein": "XX-XXXXXXX",
        "recipient_name": "...",
        "interest_income": 0.00,
        "ordinary_dividends": 0.00,
        "qualified_dividends": 0.00,
        "net_short_term_capital_gain": 0.00,
        "net_long_term_capital_gain": 0.00,
        "ordinary_business_income": 0.00,
        "net_rental_income": 0.00,
        "distributions": 0.00,
        "tax_exempt_interest": 0.00,
        "all_line_items": {}
      }
    ],
    "form_2555": {
      "foreign_country": "...",
      "employer_name": "...",
      "line_19_regular_exclusion_limit": 0.00,
      "line_24_housing_exclusion": 0.00,
      "line_27_foreign_earned_income": 0.00,
      "line_36_housing_deduction": 0.00,
      "line_42_foreign_earned_income_exclusion": 0.00,
      "line_45_housing_exclusion": 0.00,
      "line_50_total_exclusion": 0.00
    },
    "form_1040v": {
      "amount_owed": 0.00,
      "payment_date": "YYYY-MM-DD or null"
    }
  }
}

RULES:
- Include ONLY forms/schedules that are actually present in the PDF. Omit keys for forms not present.
- Use null for fields not visible on the return. Use 0.00 only if the form explicitly shows zero.
- For monetary values, use positive for income/tax and negative for losses/refunds where the form shows parentheses or minus signs.
- SSN: extract only last 4 digits. Do NOT extract full SSN.
- EIN: extract fully (XX-XXXXXXX format) — these are not personal identifiers.
- For multi-page returns, make sure to read ALL pages for ALL schedules.
- For Schedule C: if multiple businesses, include all as array items.
- For Form 8949: include ALL listed transactions.
- For Schedule E rental properties: include all properties (A, B, C).
- For K-1s: include all K-1s attached to the return.
- If this is a 1040-V payment voucher only (not a full return), set return_type to "1040V" and only populate forms.form_1040v.
- If the PDF is NOT a tax return, return: {"return_type": "not_tax_return"}`;

// ── Form manifest extraction (Pass 1) ──────────────────────────────────────
async function extractManifest(pdfPath) {
  const pdfBuffer = readFileSync(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');

  const requestBody = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
        { text: MANIFEST_PROMPT },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };

  const url = `${process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta'}/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  if (!res.ok) {
    console.warn(`    Manifest extraction failed (${res.status}) — proceeding without`);
    return null;
  }
  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  return parseJsonResponse(text, 'Manifest');
}

// Map manifest form names to our extraction JSON keys
const FORM_KEY_MAP = {
  'form 1040': 'form_1040', 'schedule 1': 'schedule_1', 'schedule 2': 'schedule_2',
  'schedule 3': 'schedule_3', 'schedule a': 'schedule_a', 'schedule b': 'schedule_b',
  'schedule c': 'schedule_c', 'schedule d': 'schedule_d', 'schedule e': 'schedule_e',
  'schedule se': 'schedule_se', 'form 2555': 'form_2555', 'form 4562': 'form_4562',
  'form 4797': 'form_4797', 'form 8949': 'form_8949_transactions',
  'form 8959': 'form_8959', 'form 8960': 'form_8960',
  'form 8962': 'form_8962', 'form 8995': 'form_8995',
  'form 1041': 'form_1041', 'schedule k-1': 'schedule_k1', 'k-1': 'schedule_k1',
  'form 1040-v': 'form_1040v', '1040-v': 'form_1040v',
};

function checkManifestCoverage(manifest, extractedForms) {
  if (!manifest?.forms?.length) return [];
  const missing = [];
  for (const mf of manifest.forms) {
    const code = mf.form_code.toLowerCase().trim();
    // Skip informational documents (W-2, 1099s, state returns)
    if (/^(w-2|1099|state|city|it-|ca-|ny-)/.test(code)) continue;
    const key = FORM_KEY_MAP[code];
    if (key && !extractedForms[key]) {
      missing.push({ form_code: mf.form_code, expected_key: key, pages: mf.pages });
    }
  }
  return missing;
}

// ── Gemini Flash extraction ─────────────────────────────────────────────────
async function extractWithGemini(pdfPath) {
  const pdfBuffer = readFileSync(pdfPath);
  const pdfBase64 = pdfBuffer.toString('base64');

  const requestBody = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: 'application/pdf',
            data: pdfBase64,
          },
        },
        { text: TAX_RETURN_PROMPT },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };

  const url = `${process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta'}/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text content');

  return parseJsonResponse(text, 'Gemini');
}

// ── Claude Sonnet extraction (via CLI on Hostinger) ─────────────────────────
async function extractWithClaude(pdfPath) {
  const promptPath = pdfPath.replace('.pdf', '-tax-prompt.txt');
  const fullPrompt = `Read the PDF file at ${pdfPath} and extract the data.\n\n${TAX_RETURN_PROMPT}`;
  writeFileSync(promptPath, fullPrompt);

  const cmd = `cat ${shellEsc(promptPath)} | CLAUDECODE="" claude --print --model ${CLAUDE_MODEL} --allowedTools Read --max-turns 4`;

  try {
    const { stdout } = await execAsync(cmd, {
      timeout: 300000, // 5 min for large returns
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseJsonResponse(stdout, 'Claude');
  } finally {
    try { unlinkSync(promptPath); } catch { /* ignore */ }
  }
}

// ── Parse JSON from LLM response ────────────────────────────────────────────
function parseJsonResponse(text, source) {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    console.error(`  ✗ ${source}: No JSON found (first 200 chars): ${trimmed.slice(0, 200)}`);
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    console.error(`  ✗ ${source}: JSON parse error: ${e.message}`);
    return null;
  }
}

// ── Compare two extraction results for conflicts ────────────────────────────
function compareExtractions(gemini, claude) {
  const conflicts = [];

  if (!gemini || !claude) return conflicts;

  // Compare key summary numbers with tolerance
  const tolerance = 0.01; // $0.01 tolerance for rounding
  const summaryFields = [
    'summary.total_income', 'summary.adjusted_gross_income', 'summary.taxable_income',
    'summary.total_tax', 'summary.total_payments', 'summary.amount_owed', 'summary.refund_amount',
  ];

  for (const path of summaryFields) {
    const gVal = getNestedValue(gemini, path);
    const cVal = getNestedValue(claude, path);
    if (gVal != null && cVal != null && Math.abs(Number(gVal) - Number(cVal)) > tolerance) {
      conflicts.push({
        field: path,
        gemini_value: gVal,
        claude_value: cVal,
        diff: Math.abs(Number(gVal) - Number(cVal)),
      });
    }
  }

  // Compare return type
  if (gemini.return_type !== claude.return_type) {
    conflicts.push({
      field: 'return_type',
      gemini_value: gemini.return_type,
      claude_value: claude.return_type,
    });
  }

  // Compare tax year
  if (gemini.tax_year !== claude.tax_year) {
    conflicts.push({
      field: 'tax_year',
      gemini_value: gemini.tax_year,
      claude_value: claude.tax_year,
    });
  }

  // Compare entity name
  const gName = gemini.entity?.name;
  const cName = claude.entity?.name;
  if (gName && cName && gName.toLowerCase() !== cName.toLowerCase()) {
    conflicts.push({
      field: 'entity.name',
      gemini_value: gName,
      claude_value: cName,
    });
  }

  // Compare key form line items if both have them
  const formPaths = [
    'forms.form_1040.line_11_adjusted_gross_income',
    'forms.form_1040.line_15_taxable_income',
    'forms.form_1040.line_24_total_tax',
    'forms.form_1040.line_33_total_payments',
    'forms.form_1041.line_9_total_income',
    'forms.form_1041.line_23_taxable_income',
    'forms.form_1041.line_24_total_tax',
  ];

  for (const path of formPaths) {
    const gVal = getNestedValue(gemini, path);
    const cVal = getNestedValue(claude, path);
    if (gVal != null && cVal != null && Math.abs(Number(gVal) - Number(cVal)) > tolerance) {
      conflicts.push({
        field: path,
        gemini_value: gVal,
        claude_value: cVal,
        diff: Math.abs(Number(gVal) - Number(cVal)),
      });
    }
  }

  return conflicts;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

// ── Austin time helper ──────────────────────────────────────────────────────
function austinNow() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' CT';
}

// ── HMAC signing for email action URLs ──────────────────────────────────────
function hmacSign(payload) {
  const secret = process.env.QUICK_ACTION_SECRET || SUPABASE_SERVICE_KEY || '';
  return createHmac('sha256', secret).update(payload).digest('hex');
}

// ── Send conflict resolution email ──────────────────────────────────────────
async function sendConflictEmail(filename, conflicts, gemini, claude, returnId, r2Key) {
  if (!RESEND_API_KEY) {
    console.log('    (No RESEND_API_KEY — skipping conflict email)');
    return;
  }

  const entityName = gemini?.entity?.name || claude?.entity?.name || 'Unknown';
  const taxYear = gemini?.tax_year || claude?.tax_year || '?';
  const returnType = gemini?.return_type || claude?.return_type || '?';
  const fileUrl = `https://files.finleg.net/financial-statements/${r2Key}`;

  // Generate a unique token for this batch of conflicts
  const token = createHash('sha256').update(`${returnId}:${Date.now()}`).digest('hex').slice(0, 24);

  // Insert conflict rows into DB for tracking
  for (const c of conflicts) {
    await supabase.from('tax_conflict_resolutions').insert({
      return_id: returnId,
      token,
      field: c.field,
      gemini_value: String(c.gemini_value ?? ''),
      claude_value: String(c.claude_value ?? ''),
      total_conflicts: conflicts.length,
    });
  }

  // Build resolution URLs
  const fnBase = `${SUPABASE_URL}/functions/v1/resolve-tax-conflict`;
  function resolveUrl(field, source) {
    const payload = `resolve:${token}:${field}:${source}`;
    const sig = hmacSign(payload);
    return `${fnBase}?token=${encodeURIComponent(token)}&field=${encodeURIComponent(field)}&source=${source}&sig=${sig}`;
  }

  const metaRow = (label, value) =>
    `<tr><td style="padding:3px 8px;color:#666;font-size:13px;white-space:nowrap;">${label}</td><td style="padding:3px 8px;font-size:13px;">${value}</td></tr>`;

  const btnStyle = (color) =>
    `display:inline-block;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;color:white;background:${color};`;

  let html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:750px;margin:0 auto;color:#1a1a1a;">`;
  html += `<h2 style="margin-bottom:4px;color:#dc2626;">⚠️ Tax Return Extraction Conflict</h2>`;
  html += `<p style="color:#666;margin-top:0;">${entityName} — ${taxYear} Form ${returnType}</p>`;

  // Document info card with file link
  html += `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:16px;">`;
  html += `<div style="font-weight:600;margin-bottom:8px;"><a href="${fileUrl}" style="color:#1a1a1a;text-decoration:none;">📄 ${filename}</a></div>`;
  html += `<table style="border-collapse:collapse;">`;
  html += metaRow('Entity', entityName);
  html += metaRow('Tax Year', taxYear);
  html += metaRow('Return Type', `Form ${returnType}`);
  html += metaRow('Conflicts', `${conflicts.length} field(s) disagree`);
  html += metaRow('Detected', austinNow());
  html += metaRow('Document', `<a href="${fileUrl}" style="color:#2563eb;">View PDF &rarr;</a>`);
  html += `</table></div>`;

  // Instructions
  html += `<p style="font-size:13px;color:#444;margin-bottom:12px;">Click <strong>Use Gemini</strong> or <strong>Use Claude</strong> for each field below to pick the correct value. You'll get a summary email when all are resolved.</p>`;

  // Conflict table with action buttons
  html += `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">`;
  html += `<tr style="background:#fef2f2;text-align:left;">`;
  html += `<th style="padding:6px 8px;">Field</th>`;
  html += `<th style="padding:6px 8px;text-align:right;">Gemini</th>`;
  html += `<th style="padding:6px 8px;text-align:right;">Claude</th>`;
  html += `<th style="padding:6px 8px;text-align:right;">Diff</th>`;
  html += `<th style="padding:6px 8px;text-align:center;">Pick</th>`;
  html += `</tr>`;

  for (const c of conflicts) {
    const fmtG = typeof c.gemini_value === 'number' ? `$${c.gemini_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : String(c.gemini_value);
    const fmtC = typeof c.claude_value === 'number' ? `$${c.claude_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : String(c.claude_value);
    const fmtD = c.diff != null ? `$${c.diff.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
    const geminiUrl = resolveUrl(c.field, 'gemini');
    const claudeUrl = resolveUrl(c.field, 'claude');

    html += `<tr style="border-bottom:1px solid #eee;">`;
    html += `<td style="padding:6px 8px;font-family:monospace;font-size:12px;">${c.field}</td>`;
    html += `<td style="padding:6px 8px;text-align:right;">${fmtG}</td>`;
    html += `<td style="padding:6px 8px;text-align:right;">${fmtC}</td>`;
    html += `<td style="padding:6px 8px;text-align:right;color:#dc2626;">${fmtD}</td>`;
    html += `<td style="padding:6px 8px;text-align:center;white-space:nowrap;">`;
    html += `<a href="${geminiUrl}" style="${btnStyle('#2563eb')}">Use Gemini</a> `;
    html += `<a href="${claudeUrl}" style="${btnStyle('#7c3aed')}">Use Claude</a>`;
    html += `</td>`;
    html += `</tr>`;
  }
  html += `</table>`;

  html += `<p style="font-size:12px;color:#999;">Gemini was used as the primary source. Your selections will update the database and you'll receive a confirmation summary.</p>`;
  html += `</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [NOTIFY_TO],
        subject: `Resolve: ${entityName} ${taxYear} Form ${returnType} — ${conflicts.length} conflict(s)`,
        html,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`    ✗ Conflict email failed: ${res.status} ${text}`);
    } else {
      console.log(`    ✉ Conflict email sent to ${NOTIFY_TO} (token: ${token})`);
    }
  } catch (err) {
    console.error(`    ✗ Email error: ${err.message}`);
  }
}

// ── Send success email ──────────────────────────────────────────────────────
async function sendSuccessEmail(filename, data, formsInserted) {
  if (!RESEND_API_KEY) return;

  const entityName = data.entity?.name || 'Unknown';
  const taxYear = data.tax_year || '?';
  const returnType = data.return_type || '?';

  const metaRow = (label, value) =>
    `<tr><td style="padding:3px 8px;color:#666;font-size:13px;white-space:nowrap;">${label}</td><td style="padding:3px 8px;font-size:13px;">${value}</td></tr>`;

  const fmtUsd = (v) => v != null ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';

  let html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">`;
  html += `<h2 style="margin-bottom:4px;">📋 Tax Return Extracted</h2>`;
  html += `<p style="color:#666;margin-top:0;">${entityName} — ${taxYear} Form ${returnType}</p>`;

  // Summary card
  html += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;">`;
  html += `<table style="border-collapse:collapse;">`;
  html += metaRow('File', filename);
  html += metaRow('Entity', entityName);
  html += metaRow('Tax Year', taxYear);
  html += metaRow('Return Type', `Form ${returnType}`);
  html += metaRow('Filing Status', data.entity?.filing_status || '—');
  if (data.summary) {
    html += metaRow('Total Income', fmtUsd(data.summary.total_income));
    html += metaRow('AGI', fmtUsd(data.summary.adjusted_gross_income));
    html += metaRow('Taxable Income', fmtUsd(data.summary.taxable_income));
    html += metaRow('Total Tax', fmtUsd(data.summary.total_tax));
    html += metaRow('Payments', fmtUsd(data.summary.total_payments));
    if (data.summary.amount_owed) html += metaRow('Amount Owed', fmtUsd(data.summary.amount_owed));
    if (data.summary.refund_amount) html += metaRow('Refund', fmtUsd(data.summary.refund_amount));
  }
  html += metaRow('Forms Extracted and Stored', formsInserted.join(', '));
  html += metaRow('Processed', austinNow());
  html += `</table></div>`;
  html += `</div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [NOTIFY_TO],
        subject: `Extracted: ${entityName} ${taxYear} Form ${returnType}`,
        html,
      }),
    });
  } catch { /* non-critical */ }
}

// ── Upload to R2 ────────────────────────────────────────────────────────────
async function uploadToR2(localPath, r2Key) {
  const body = readFileSync(localPath);
  const bucket = 'financial-statements';
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKey || !secretKey) throw new Error('Missing R2 credentials in .env');

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${r2Key}`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const amzDate = dateStamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';

  const payloadHash = createHash('sha256').update(body).digest('hex');
  const canonicalUri = `/${bucket}/${r2Key}`;
  const canonicalHeaders = `content-type:application/pdf\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStamp), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: 'PUT',
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

// ── Build R2 key for tax returns ────────────────────────────────────────────
function buildTaxR2Key(data) {
  const entitySlug = (data.entity?.name || 'unknown')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const year = data.tax_year || 'unknown';
  const returnType = (data.return_type || 'unknown').toLowerCase();
  return `tax-returns/${entitySlug}/${year}-form-${returnType}.pdf`;
}

// ── Get or create entity ────────────────────────────────────────────────────
async function getOrCreateEntity(entityData) {
  const name = entityData.name;
  if (!name) throw new Error('No entity name in extraction');

  // Try to match against known entities
  const { data: existing } = await supabase
    .from('tax_entities')
    .select('id, display_name')
    .ilike('display_name', `%${name.split(' ').pop()}%`)
    .limit(5);

  // Try exact match first
  const exact = existing?.find(e =>
    e.display_name.toLowerCase() === name.toLowerCase()
  );
  if (exact) return exact.id;

  // Try matching against our known entity map
  for (const [pattern, info] of Object.entries(ENTITY_MAP)) {
    if (name.toLowerCase().includes(pattern.toLowerCase()) ||
        pattern.toLowerCase().includes(name.toLowerCase().split(',').reverse().join(' ').trim())) {
      const mapped = existing?.find(e =>
        e.display_name.toLowerCase() === info.display_name.toLowerCase()
      );
      if (mapped) return mapped.id;
    }
  }

  // Create new entity
  const entityType = entityData.entity_type || 'individual';
  const row = {
    display_name: name,
    entity_type: entityType,
    tax_id_last4: entityData.ssn_last4 || null,
  };

  if (entityType === 'trust' || entityType === 'estate') {
    row.trust_name = name;
    row.trust_ein = entityData.ein || null;
  } else {
    const parts = name.split(/\s+/);
    row.first_name = parts[0] || null;
    row.last_name = parts.slice(1).join(' ') || null;
  }

  if (entityData.address) {
    row.address_street = entityData.address.street;
    row.address_city = entityData.address.city;
    row.address_state = entityData.address.state;
    row.address_zip = entityData.address.zip;
  }

  const { data: created, error } = await supabase
    .from('tax_entities')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(`Entity create error: ${error.message}`);
  console.log(`    Created entity: ${name} (${created.id})`);
  return created.id;
}

// ── Create tax_returns envelope ─────────────────────────────────────────────
async function createTaxReturn(entityId, data, inboxId = null) {
  const row = {
    entity_id: entityId,
    inbox_id: inboxId,
    tax_year: data.tax_year,
    return_type: data.return_type === '1040V' ? '1040' : data.return_type,
    filing_status: data.entity?.filing_status || null,
    is_amended: false,
    preparer_name: data.preparer?.name || null,
    preparer_firm: data.preparer?.firm || null,
    preparer_ptin: data.preparer?.ptin || null,
    preparer_firm_ein: data.preparer?.firm_ein || null,
    total_income: data.summary?.total_income || null,
    adjusted_gross_income: data.summary?.adjusted_gross_income || null,
    taxable_income: data.summary?.taxable_income || null,
    total_tax: data.summary?.total_tax || null,
    total_payments: data.summary?.total_payments || null,
    amount_owed: data.summary?.amount_owed || null,
    refund_amount: data.summary?.refund_amount || null,
    extraction_status: 'extracted',
    extraction_model: 'gemini-2.5-flash',
    extraction_confidence: 0.9,
    extraction_notes: data._missing_forms?.length
      ? `Missing forms: ${data._missing_forms.map(f => f.form_code).join(', ')}`
      : null,
  };

  // Check if return already exists
  const { data: existing } = await supabase
    .from('tax_returns')
    .select('id')
    .eq('entity_id', entityId)
    .eq('tax_year', data.tax_year)
    .eq('return_type', row.return_type)
    .eq('is_amended', false)
    .maybeSingle();

  if (existing && !REPROCESS) {
    console.log(`    Return already exists (${existing.id}) — use --reprocess to overwrite`);
    return null;
  }

  if (existing && REPROCESS) {
    // Delete old data and re-insert
    await deleteReturnData(existing.id);
    const { error } = await supabase
      .from('tax_returns')
      .update(row)
      .eq('id', existing.id);
    if (error) throw new Error(`Return update error: ${error.message}`);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from('tax_returns')
    .insert(row)
    .select('id')
    .single();

  if (error) throw new Error(`Return create error: ${error.message}`);
  return created.id;
}

// ── Delete all form data for a return (for reprocessing) ────────────────────
async function deleteReturnData(returnId) {
  const tables = [
    'tax_form_1040_dependents', 'tax_form_1040',
    'tax_schedule_1', 'tax_schedule_2',
    'tax_schedule_c_other_expenses', 'tax_schedule_c',
    'tax_form_8949_transactions', 'tax_schedule_d',
    'tax_schedule_e_rental_properties', 'tax_schedule_e_partnerships',
    'tax_schedule_e_estates_trusts', 'tax_schedule_e_summary',
    'tax_schedule_se',
    'tax_form_4562_assets', 'tax_form_4562',
    'tax_form_8962_monthly', 'tax_form_8962',
    'tax_form_1041_schedule_b', 'tax_form_1041_schedule_g',
    'tax_form_1041_schedule_i', 'tax_form_1041_schedule_j', 'tax_form_1041',
    'tax_form_8995_businesses', 'tax_form_8995',
    'tax_schedule_k1',
    'tax_return_line_items',
    'tax_return_documents',
  ];

  for (const table of tables) {
    // For child tables that reference parent tables (not return_id directly),
    // we need special handling
    if (table === 'tax_schedule_c_other_expenses') {
      const { data: parents } = await supabase.from('tax_schedule_c').select('id').eq('return_id', returnId);
      if (parents?.length) {
        for (const p of parents) {
          await supabase.from(table).delete().eq('schedule_c_id', p.id);
        }
      }
      continue;
    }
    if (table === 'tax_form_4562_assets') {
      const { data: parents } = await supabase.from('tax_form_4562').select('id').eq('return_id', returnId);
      if (parents?.length) {
        for (const p of parents) {
          await supabase.from(table).delete().eq('form_4562_id', p.id);
        }
      }
      continue;
    }
    if (table === 'tax_form_8962_monthly') {
      const { data: parents } = await supabase.from('tax_form_8962').select('id').eq('return_id', returnId);
      if (parents?.length) {
        for (const p of parents) {
          await supabase.from(table).delete().eq('form_8962_id', p.id);
        }
      }
      continue;
    }
    if (table === 'tax_form_8995_businesses') {
      const { data: parents } = await supabase.from('tax_form_8995').select('id').eq('return_id', returnId);
      if (parents?.length) {
        for (const p of parents) {
          await supabase.from(table).delete().eq('form_8995_id', p.id);
        }
      }
      continue;
    }
    await supabase.from(table).delete().eq('return_id', returnId);
  }
}

// ── Insert extracted data into typed tables ──────────────────────────────────
async function insertFormData(returnId, taxYear, data) {
  const forms = data.forms || {};
  const inserted = [];

  // Form 1040
  if (forms.form_1040) {
    const f = forms.form_1040;
    const { error } = await supabase.from('tax_form_1040').insert({
      return_id: returnId, tax_year: taxYear,
      filing_status: f.filing_status,
      digital_assets_activity: f.digital_assets_activity,
      line_1a_w2_wages: f.line_1a_w2_wages,
      line_1z_total_w2_income: f.line_1z_total_w2_income,
      line_2a_tax_exempt_interest: f.line_2a_tax_exempt_interest,
      line_2b_taxable_interest: f.line_2b_taxable_interest,
      line_3a_qualified_dividends: f.line_3a_qualified_dividends,
      line_3b_ordinary_dividends: f.line_3b_ordinary_dividends,
      line_4a_ira_distributions: f.line_4a_ira_distributions,
      line_4b_ira_taxable: f.line_4b_ira_taxable,
      line_5a_pensions_annuities: f.line_5a_pensions_annuities,
      line_5b_pensions_taxable: f.line_5b_pensions_taxable,
      line_6a_social_security: f.line_6a_social_security,
      line_6b_social_security_taxable: f.line_6b_social_security_taxable,
      line_7_capital_gain_loss: f.line_7_capital_gain_loss,
      line_8_schedule1_additional_income: f.line_8_schedule1_additional_income,
      line_9_total_income: f.line_9_total_income,
      line_10_schedule1_adjustments: f.line_10_schedule1_adjustments,
      line_11_adjusted_gross_income: f.line_11_adjusted_gross_income,
      line_12_standard_or_itemized_deduction: f.line_12_standard_or_itemized_deduction,
      line_13_qbi_deduction: f.line_13_qbi_deduction,
      line_14_total_deductions: f.line_14_total_deductions,
      line_15_taxable_income: f.line_15_taxable_income,
      line_16_tax: f.line_16_tax,
      line_24_total_tax: f.line_24_total_tax,
      line_25d_total_withholding: f.line_25d_total_withholding,
      line_26_estimated_payments: f.line_26_estimated_payments,
      line_33_total_payments: f.line_33_total_payments,
      line_34_overpaid: f.line_34_overpaid,
      line_35a_refund: f.line_35a_refund,
      line_37_amount_owed: f.line_37_amount_owed,
      line_38_estimated_tax_penalty: f.line_38_estimated_tax_penalty,
    });
    if (error) console.error(`  ✗ form_1040 insert: ${error.message}`);
    else inserted.push('1040');

    // Dependents
    if (f.dependents?.length) {
      for (const dep of f.dependents) {
        await supabase.from('tax_form_1040_dependents').insert({
          return_id: returnId,
          first_name: dep.first_name,
          last_name: dep.last_name,
          ssn_last4: dep.ssn_last4,
          relationship: dep.relationship,
          qualifies_child_tax_credit: dep.child_tax_credit ?? false,
          qualifies_other_dependent_credit: dep.other_dependent_credit ?? false,
        });
      }
    }
  }

  // Schedule 1
  if (forms.schedule_1) {
    const f = forms.schedule_1;
    const { error } = await supabase.from('tax_schedule_1').insert({
      return_id: returnId, tax_year: taxYear,
      line_3_business_income_schedule_c: f.line_3_business_income_schedule_c,
      line_5_rental_royalty_schedule_e: f.line_5_rental_royalty_schedule_e,
      line_10_total_additional_income: f.line_10_total_additional_income,
      line_15_se_tax_deduction: f.line_15_se_tax_deduction,
      line_17_se_health_insurance: f.line_17_se_health_insurance,
      line_26_total_adjustments: f.line_26_total_adjustments,
    });
    if (error) console.error(`  ✗ schedule_1 insert: ${error.message}`);
    else inserted.push('Schedule 1');
  }

  // Schedule 2
  if (forms.schedule_2) {
    const f = forms.schedule_2;
    const { error } = await supabase.from('tax_schedule_2').insert({
      return_id: returnId, tax_year: taxYear,
      line_1_amt: f.line_1_amt,
      line_4_se_tax: f.line_4_se_tax,
      line_12_net_investment_income_tax: f.line_12_net_investment_income_tax,
      line_21_total_other_taxes: f.line_21_total_other_taxes,
    });
    if (error) console.error(`  ✗ schedule_2 insert: ${error.message}`);
    else inserted.push('Schedule 2');
  }

  // Schedule C (array — multiple businesses)
  if (forms.schedule_c?.length) {
    for (let i = 0; i < forms.schedule_c.length; i++) {
      const f = forms.schedule_c[i];
      const exp = f.expenses || {};
      const { data: sc, error } = await supabase.from('tax_schedule_c').insert({
        return_id: returnId, tax_year: taxYear,
        business_sequence: i + 1,
        business_name: f.business_name,
        principal_activity: f.principal_activity,
        business_code: f.business_code,
        accounting_method: f.accounting_method,
        line_1_gross_receipts: f.line_1_gross_receipts,
        line_7_gross_income: f.line_7_gross_income,
        line_28_total_expenses: f.line_28_total_expenses,
        line_31_net_profit_loss: f.line_31_net_profit_loss,
        line_8_advertising: exp.line_8_advertising,
        line_9_car_truck: exp.line_9_car_truck,
        line_11_contract_labor: exp.line_11_contract_labor,
        line_13_depreciation: exp.line_13_depreciation,
        line_15_insurance: exp.line_15_insurance,
        line_17_legal_professional: exp.line_17_legal_professional,
        line_18_office_expense: exp.line_18_office_expense,
        line_21_repairs: exp.line_21_repairs,
        line_22_supplies: exp.line_22_supplies,
        line_23_taxes_licenses: exp.line_23_taxes_licenses,
        line_25_utilities: exp.line_25_utilities,
      }).select('id').single();

      if (error) { console.error(`  ✗ schedule_c insert: ${error.message}`); continue; }
      inserted.push(`Schedule C (${f.business_name || i + 1})`);

      // Other expenses
      if (f.other_expenses?.length && sc) {
        for (const oe of f.other_expenses) {
          await supabase.from('tax_schedule_c_other_expenses').insert({
            schedule_c_id: sc.id,
            description: oe.description,
            amount: oe.amount,
          });
        }
      }
    }
  }

  // Schedule D
  if (forms.schedule_d) {
    const f = forms.schedule_d;
    const { error } = await supabase.from('tax_schedule_d').insert({
      return_id: returnId, tax_year: taxYear,
      line_7_net_short_term: f.line_7_net_short_term,
      line_15_net_long_term: f.line_15_net_long_term,
      line_16_combined: f.line_16_combined,
    });
    if (error) console.error(`  ✗ schedule_d insert: ${error.message}`);
    else inserted.push('Schedule D');
  }

  // Form 8949 transactions
  if (forms.form_8949_transactions?.length) {
    for (const txn of forms.form_8949_transactions) {
      await supabase.from('tax_form_8949_transactions').insert({
        return_id: returnId, tax_year: taxYear,
        holding_period: txn.holding_period,
        basis_reporting_box: txn.holding_period === 'short_term' ? 'A' : 'D',
        description: txn.description,
        date_acquired: txn.date_acquired === 'VARIOUS' ? null : txn.date_acquired,
        date_acquired_text: txn.date_acquired === 'VARIOUS' ? 'VARIOUS' : null,
        date_sold: txn.date_sold,
        proceeds: txn.proceeds,
        cost_basis: txn.cost_basis,
        adjustment_amount: txn.adjustment_amount,
        gain_or_loss: txn.gain_or_loss,
      });
    }
    inserted.push(`Form 8949 (${forms.form_8949_transactions.length} txns)`);
  }

  // Schedule E
  if (forms.schedule_e) {
    const se = forms.schedule_e;

    // Rental properties
    if (se.rental_properties?.length) {
      for (const p of se.rental_properties) {
        const exp = p.expenses || {};
        await supabase.from('tax_schedule_e_rental_properties').insert({
          return_id: returnId, tax_year: taxYear,
          property_label: p.property_label,
          property_address: p.property_address,
          property_type: p.property_type,
          fair_rental_days: p.fair_rental_days,
          personal_use_days: p.personal_use_days,
          line_3_rents_received: p.line_3_rents_received,
          line_20_total_expenses: p.line_20_total_expenses,
          line_18_depreciation: p.line_18_depreciation || exp.line_18_depreciation,
          line_21_net_income_loss: p.line_21_net_income_loss,
          line_5_advertising: exp.line_5_advertising,
          line_7_cleaning_maintenance: exp.line_7_cleaning_maintenance,
          line_9_insurance: exp.line_9_insurance,
          line_12_mortgage_interest: exp.line_12_mortgage_interest,
          line_14_repairs: exp.line_14_repairs,
          line_16_taxes: exp.line_16_taxes,
          line_17_utilities: exp.line_17_utilities,
        });
      }
      inserted.push(`Schedule E (${se.rental_properties.length} properties)`);
    }

    // Partnerships
    if (se.partnerships?.length) {
      for (const p of se.partnerships) {
        await supabase.from('tax_schedule_e_partnerships').insert({
          return_id: returnId, tax_year: taxYear,
          entity_name: p.entity_name,
          is_partnership: p.is_partnership ?? true,
          passive_income: p.passive_income,
          nonpassive_income: p.nonpassive_income,
        });
      }
    }

    // Trusts/estates
    if (se.trusts_estates?.length) {
      for (const t of se.trusts_estates) {
        await supabase.from('tax_schedule_e_estates_trusts').insert({
          return_id: returnId, tax_year: taxYear,
          entity_name: t.entity_name,
          passive_income: t.passive_income,
          nonpassive_income: t.nonpassive_income,
        });
      }
    }

    // Summary
    if (se.line_41_total_schedule_e != null) {
      await supabase.from('tax_schedule_e_summary').insert({
        return_id: returnId, tax_year: taxYear,
        line_26_total_rental_royalty: se.line_26_total_rental_royalty,
        line_41_total_schedule_e: se.line_41_total_schedule_e,
      });
    }
  }

  // Schedule SE
  if (forms.schedule_se) {
    const f = forms.schedule_se;
    const { error } = await supabase.from('tax_schedule_se').insert({
      return_id: returnId, tax_year: taxYear,
      line_2_net_profit: f.line_2_net_profit,
      line_12_se_tax: f.line_12_se_tax,
      line_13_deduction_half_se: f.line_13_deduction_half_se,
    });
    if (error) console.error(`  ✗ schedule_se insert: ${error.message}`);
    else inserted.push('Schedule SE');
  }

  // Schedule A (goes into EAV since no typed table)
  if (forms.schedule_a) {
    const f = forms.schedule_a;
    const fields = Object.entries(f).filter(([_, v]) => v != null);
    for (const [key, value] of fields) {
      await supabase.from('tax_return_line_items').insert({
        return_id: returnId, tax_year: taxYear,
        form_name: 'Schedule A',
        form_part: key.startsWith('line_4') ? 'Medical and Dental' :
                   key.startsWith('line_5') || key.startsWith('line_7') ? 'Taxes You Paid' :
                   key.startsWith('line_8') || key.startsWith('line_10') ? 'Interest You Paid' :
                   key.startsWith('line_12') || key.startsWith('line_13') || key.startsWith('line_14') ? 'Gifts to Charity' :
                   'Total',
        line_number: key.replace(/^line_/, '').replace(/_/g, ' '),
        line_description: key.replace(/^line_\d+[a-z]?_/, '').replace(/_/g, ' '),
        amount: typeof value === 'number' ? value : null,
        text_value: typeof value === 'string' ? value : null,
      });
    }
    inserted.push('Schedule A');
  }

  // Form 2555 - Foreign Earned Income Exclusion (EAV)
  if (forms.form_2555) {
    const f = forms.form_2555;
    const fields = Object.entries(f).filter(([_, v]) => v != null);
    for (const [key, value] of fields) {
      await supabase.from('tax_return_line_items').insert({
        return_id: returnId, tax_year: taxYear,
        form_name: 'Form 2555',
        form_part: key.startsWith('line_19') || key.startsWith('line_24') ? 'Foreign Earned Income Exclusion' :
                   key.startsWith('line_27') || key.startsWith('line_36') ? 'Foreign Housing' :
                   key.startsWith('line_42') || key.startsWith('line_45') || key.startsWith('line_50') ? 'Exclusion Summary' :
                   'General',
        line_number: key.replace(/^line_/, '').replace(/_/g, ' '),
        line_description: key.replace(/^line_\d+[a-z]?_/, '').replace(/_/g, ' '),
        amount: typeof value === 'number' ? value : null,
        text_value: typeof value === 'string' ? value : null,
      });
    }
    inserted.push('Form 2555');
  }

  // Form 4562
  if (forms.form_4562?.length) {
    for (const f of forms.form_4562) {
      const { data: f4562, error } = await supabase.from('tax_form_4562').insert({
        return_id: returnId, tax_year: taxYear,
        business_or_activity: f.business_or_activity,
        line_12_section_179_expense: f.line_12_section_179_expense,
        line_14_special_depreciation: f.line_14_special_depreciation,
        line_17_macrs_prior_years: f.line_17_macrs_prior_years,
        line_22_total_depreciation: f.line_22_total_depreciation,
      }).select('id').single();

      if (error) { console.error(`  ✗ form_4562 insert: ${error.message}`); continue; }
      inserted.push(`Form 4562 (${f.business_or_activity || '?'})`);

      if (f.assets?.length && f4562) {
        for (const a of f.assets) {
          await supabase.from('tax_form_4562_assets').insert({
            form_4562_id: f4562.id,
            description: a.description,
            date_placed_in_service: a.date_placed_in_service,
            cost_or_basis: a.cost_or_basis,
            recovery_period: a.recovery_period,
            method: a.method,
            depreciation_deduction: a.depreciation_deduction,
          });
        }
      }
    }
  }

  // Form 8962
  if (forms.form_8962) {
    const f = forms.form_8962;
    const { error } = await supabase.from('tax_form_8962').insert({
      return_id: returnId, tax_year: taxYear,
      line_1_family_size: f.line_1_family_size,
      line_3_household_income: f.line_3_household_income,
      line_5_poverty_percentage: f.line_5_poverty_percentage,
      line_24_total_ptc: f.line_24_total_ptc,
      line_25_advance_ptc: f.line_25_advance_ptc,
      line_26_net_ptc: f.line_26_net_ptc,
      line_29_excess_repayment: f.line_29_excess_repayment,
    });
    if (error) console.error(`  ✗ form_8962 insert: ${error.message}`);
    else inserted.push('Form 8962');
  }

  // Form 8995
  if (forms.form_8995) {
    const f = forms.form_8995;
    const { data: f8995, error } = await supabase.from('tax_form_8995').insert({
      return_id: returnId, tax_year: taxYear,
      line_15_qbi_deduction: f.line_15_qbi_deduction,
    }).select('id').single();

    if (error) console.error(`  ✗ form_8995 insert: ${error.message}`);
    else {
      inserted.push('Form 8995');
      if (f.businesses?.length && f8995) {
        for (let i = 0; i < f.businesses.length; i++) {
          await supabase.from('tax_form_8995_businesses').insert({
            form_8995_id: f8995.id,
            business_sequence: i + 1,
            trade_business_name: f.businesses[i].trade_business_name,
            qualified_business_income: f.businesses[i].qualified_business_income,
          });
        }
      }
    }
  }

  // Form 1041
  if (forms.form_1041) {
    const f = forms.form_1041;
    const { error } = await supabase.from('tax_form_1041').insert({
      return_id: returnId, tax_year: taxYear,
      trust_name: f.trust_name,
      fiduciary_name: f.fiduciary_name,
      trust_ein: f.trust_ein,
      trust_type: f.trust_type,
      line_1_interest_income: f.line_1_interest_income,
      line_2a_ordinary_dividends: f.line_2a_ordinary_dividends,
      line_2b_qualified_dividends: f.line_2b_qualified_dividends,
      line_4_capital_gain_loss: f.line_4_capital_gain_loss,
      line_5_rents_royalties: f.line_5_rents_royalties,
      line_9_total_income: f.line_9_total_income,
      line_17_adjusted_total_income: f.line_17_adjusted_total_income,
      line_18_income_distribution_deduction: f.line_18_income_distribution_deduction,
      line_23_taxable_income: f.line_23_taxable_income,
      line_24_total_tax: f.line_24_total_tax,
    });
    if (error) console.error(`  ✗ form_1041 insert: ${error.message}`);
    else inserted.push('Form 1041');

    if (f.schedule_b) {
      await supabase.from('tax_form_1041_schedule_b').insert({
        return_id: returnId, tax_year: taxYear,
        line_7_distributable_net_income: f.schedule_b.line_7_distributable_net_income,
        line_15_income_distribution_deduction: f.schedule_b.line_15_income_distribution_deduction,
      });
    }

    if (f.schedule_g) {
      await supabase.from('tax_form_1041_schedule_g').insert({
        return_id: returnId, tax_year: taxYear,
        line_1a_tax_on_taxable_income: f.schedule_g.line_1a_tax_on_taxable_income,
        line_5_niit: f.schedule_g.line_5_niit,
        line_9_total_tax: f.schedule_g.line_9_total_tax,
        line_19_total_payments: f.schedule_g.line_19_total_payments,
      });
    }
  }

  // K-1s
  if (forms.schedule_k1?.length) {
    for (const k of forms.schedule_k1) {
      await supabase.from('tax_schedule_k1').insert({
        return_id: returnId, tax_year: taxYear,
        source_form: k.source_form,
        issuing_entity_name: k.issuing_entity_name,
        issuing_entity_ein: k.issuing_entity_ein,
        recipient_name: k.recipient_name,
        interest_income: k.interest_income,
        ordinary_dividends: k.ordinary_dividends,
        qualified_dividends: k.qualified_dividends,
        net_short_term_capital_gain: k.net_short_term_capital_gain,
        net_long_term_capital_gain: k.net_long_term_capital_gain,
        ordinary_business_income: k.ordinary_business_income,
        net_rental_income: k.net_rental_income,
        distributions: k.distributions,
        tax_exempt_interest: k.tax_exempt_interest,
        all_line_items: k.all_line_items || null,
      });
    }
    inserted.push(`K-1 (${forms.schedule_k1.length})`);
  }

  return inserted;
}

// ── Process a single PDF file ───────────────────────────────────────────────
async function processFile(filePath, { inboxId = null } = {}) {
  const filename = basename(filePath);
  console.log(`\n  → Processing: ${filename}`);

  try {
    // Step 0: Form manifest (Pass 1) — inventory all forms in the PDF
    console.log(`    Pass 1: Scanning form manifest...`);
    const manifest = await extractManifest(filePath);
    if (manifest?.forms?.length) {
      console.log(`    Found ${manifest.forms.length} forms: ${manifest.forms.map(f => f.form_code).join(', ')}`);
    }

    // Step 1: Extract with Gemini Flash 2.5 (primary, Pass 2)
    console.log(`    Pass 2: Extracting with Gemini Flash 2.5...`);
    const geminiResult = await extractWithGemini(filePath);

    if (!geminiResult) throw new Error('Gemini returned no parseable result');
    if (geminiResult.return_type === 'not_tax_return') {
      console.log(`    SKIPPED — not a tax return`);
      return { status: 'not_tax_return' };
    }

    // Check manifest coverage — flag any forms found in PDF but missing from extraction
    const missingForms = checkManifestCoverage(manifest, geminiResult.forms || {});
    if (missingForms.length > 0) {
      console.log(`    ⚠ ${missingForms.length} form(s) in PDF but missing from extraction:`);
      for (const mf of missingForms) {
        console.log(`      - ${mf.form_code} (pages ${mf.pages})`);
      }
      // Store missing forms in extraction_notes for review
      geminiResult._missing_forms = missingForms;
    } else if (manifest) {
      console.log(`    ✓ All manifest forms covered in extraction`);
    }

    console.log(`    Gemini: ${geminiResult.return_type} for ${geminiResult.entity?.name} (${geminiResult.tax_year})`);

    // Step 2: Extract with Claude Sonnet (verification) unless --gemini-only
    let claudeResult = null;
    let conflicts = [];

    if (!GEMINI_ONLY) {
      console.log(`    Verifying with Claude Sonnet 4.6...`);
      claudeResult = await extractWithClaude(filePath);

      if (claudeResult) {
        console.log(`    Claude: ${claudeResult.return_type} for ${claudeResult.entity?.name} (${claudeResult.tax_year})`);

        // Step 3: Compare results
        conflicts = compareExtractions(geminiResult, claudeResult);
        if (conflicts.length > 0) {
          console.log(`    ⚠ ${conflicts.length} conflict(s) detected`);
          for (const c of conflicts) {
            console.log(`      ${c.field}: Gemini=${c.gemini_value} vs Claude=${c.claude_value}`);
          }
        } else {
          console.log(`    ✓ Both models agree`);
        }
      } else {
        console.log(`    ⚠ Claude extraction failed — using Gemini only`);
      }
    }

    // Use Gemini as primary (as specified)
    const data = geminiResult;

    if (DRY_RUN) {
      console.log(`    ✓ Dry run — would insert ${data.return_type} for ${data.entity?.name} (${data.tax_year})`);
      if (conflicts.length > 0) {
        console.log(`    Would send conflict email for ${conflicts.length} conflict(s)`);
      }
      return { status: 'dry_run' };
    }

    // Step 4: Upload to R2
    const r2Key = buildTaxR2Key(data);
    console.log(`    R2 key: ${r2Key}`);
    await uploadToR2(filePath, r2Key);

    // Step 5: Create entity + return envelope
    const entityId = await getOrCreateEntity(data.entity);
    const returnId = await createTaxReturn(entityId, data, inboxId);

    if (!returnId) {
      return { status: 'skipped_existing' };
    }

    // Step 6: Link document
    const fileSize = statSync(filePath).size;
    const formsContained = Object.keys(data.forms || {}).map(k =>
      k.replace(/^form_/, 'Form ').replace(/^schedule_/, 'Schedule ').replace(/_/g, ' ')
    );

    await supabase.from('tax_return_documents').insert({
      return_id: returnId,
      file_path: filePath,
      storage_url: `https://files.finleg.net/financial-statements/${r2Key}`,
      file_name: filename,
      file_size_bytes: fileSize,
      forms_contained: formsContained,
    });

    // Step 7: Upsert document_index
    await supabase.from('document_index').upsert({
      bucket: 'financial-statements',
      r2_key: r2Key,
      filename,
      file_type: 'pdf',
      content_type: 'application/pdf',
      file_size: fileSize,
      category: 'tax-return',
      year: data.tax_year,
      original_path: filePath,
    }, { onConflict: 'r2_key' });

    // Step 8: Insert form data into typed tables
    console.log(`    Inserting form data...`);
    const formsInserted = await insertFormData(returnId, data.tax_year, data);
    console.log(`    ✓ Inserted: ${formsInserted.join(', ')}`);

    // Step 9: Update verification metadata
    if (!GEMINI_ONLY) {
      const verificationStatus = claudeResult
        ? (conflicts.length > 0 ? 'conflicts' : 'agreed')
        : 'failed';
      await supabase.from('tax_returns').update({
        verification_model: 'claude-sonnet-4.6',
        verification_status: verificationStatus,
        verification_conflicts: conflicts.length > 0 ? conflicts : null,
      }).eq('id', returnId);
    }

    // Step 10: Send conflict email if needed
    if (conflicts.length > 0) {
      await sendConflictEmail(filename, conflicts, geminiResult, claudeResult, returnId, r2Key);
    }

    // Step 11: Send success email
    await sendSuccessEmail(filename, data, formsInserted);

    return { status: 'success', formsInserted };
  } catch (err) {
    console.error(`    ✗ Error: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

// ── Discover PDF files ──────────────────────────────────────────────────────
function discoverPdfs(dirPath) {
  if (!existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = readdirSync(dirPath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => join(dirPath, f))
    .sort();

  // Apply filters
  let filtered = files;
  if (FILTER_ENTITY) {
    filtered = filtered.filter(f => basename(f).toLowerCase().includes(FILTER_ENTITY.toLowerCase()));
  }
  if (FILTER_YEAR) {
    filtered = filtered.filter(f => basename(f).includes(FILTER_YEAR));
  }

  return filtered.slice(0, LIMIT);
}

// ── Download file from URL to temp path ─────────────────────────────────────
async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buffer);
  return buffer.length;
}

// ── Inbox mode: poll statement_inbox for pending tax returns ─────────────────
async function processInbox() {
  console.log(`Polling statement_inbox for pending tax returns...\n`);

  const { data: items, error } = await supabase
    .from('statement_inbox')
    .select('*')
    .eq('doc_type', 'tax_return')
    .in('status', ['pending', 'indexed'])
    .order('created_at', { ascending: true })
    .limit(LIMIT);

  if (error) throw new Error(`Inbox query error: ${error.message}`);

  console.log(`Found ${items?.length || 0} pending tax return(s)\n`);
  if (!items?.length) return { total: 0 };

  const stats = { success: 0, dry_run: 0, error: 0, not_tax_return: 0, skipped_existing: 0 };

  for (const item of items) {
    const label = `${item.account_name || '?'} — ${item.account_type || '?'} (${item.attachment_filename})`;
    console.log(`\n  → Inbox item: ${label}`);

    // Mark as processing
    await supabase
      .from('statement_inbox')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', item.id);

    const tmpPath = `/tmp/tax-inbox-${item.id}.pdf`;

    try {
      // Download from Supabase Storage
      console.log(`    Downloading from storage...`);
      const fileSize = await downloadToFile(item.attachment_url, tmpPath);
      console.log(`    Downloaded ${(fileSize / 1024).toFixed(0)} KB`);

      // Process the file
      const result = await processFile(tmpPath, { inboxId: item.id });
      stats[result.status] = (stats[result.status] || 0) + 1;

      // Update inbox status
      if (result.status === 'success') {
        await supabase
          .from('statement_inbox')
          .update({
            status: 'parsed',
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      } else if (result.status === 'not_tax_return') {
        await supabase
          .from('statement_inbox')
          .update({
            status: 'error',
            error_message: 'Not a tax return',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      } else if (result.status === 'error') {
        await supabase
          .from('statement_inbox')
          .update({
            status: 'error',
            error_message: result.error?.slice(0, 500) || 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }
    } catch (err) {
      console.error(`    ✗ Error: ${err.message}`);
      stats.error++;
      await supabase
        .from('statement_inbox')
        .update({
          status: 'error',
          error_message: err.message?.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // Rate-limit delay between extractions to avoid Gemini 429s (60s between items)
    if (items.indexOf(item) < items.length - 1) {
      console.log('    Waiting 60s before next extraction (rate limit)...');
      await new Promise(r => setTimeout(r, 60_000));
    }
  }

  return { total: items.length, ...stats };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  Tax Return Processor                    ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Source: ${INBOX_MODE ? 'INBOX' : 'LOCAL'} | Extraction: ${GEMINI_ONLY ? 'Gemini only' : 'Gemini + Claude'} | Limit: ${LIMIT}\n`);

  const startTime = Date.now();
  let stats;

  if (INBOX_MODE) {
    // Poll statement_inbox for pending tax returns
    const result = await processInbox();
    stats = result;
  } else {
    // Local file mode
    let files = [];

    if (FILE_PATH) {
      if (!existsSync(FILE_PATH)) {
        console.error(`File not found: ${FILE_PATH}`);
        process.exit(1);
      }
      files = [FILE_PATH];
    } else if (DIR_PATH) {
      files = discoverPdfs(DIR_PATH);
    } else {
      console.error('Must specify --inbox, --dir, or --file');
      console.log('Usage:');
      console.log('  node scripts/process-tax-returns.mjs --inbox                        # Poll inbox');
      console.log('  node scripts/process-tax-returns.mjs --dir "/path/to/pdfs"          # Local directory');
      console.log('  node scripts/process-tax-returns.mjs --file "/path/to/file.pdf"     # Single file');
      process.exit(1);
    }

    console.log(`Found ${files.length} PDF(s) to process\n`);
    if (!files.length) return;

    stats = { success: 0, dry_run: 0, error: 0, not_tax_return: 0, skipped_existing: 0 };

    // Process sequentially (API rate limits)
    for (const file of files) {
      const result = await processFile(file);
      stats[result.status] = (stats[result.status] || 0) + 1;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n══════════════════════════════════════════`);
  console.log(`COMPLETE in ${elapsed}s`);
  console.log(`  Successful: ${stats.success || 0}`);
  console.log(`  Errors: ${stats.error || 0}`);
  console.log(`  Not tax returns: ${stats.not_tax_return || 0}`);
  console.log(`  Skipped (existing): ${stats.skipped_existing || 0}`);
  console.log(`══════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
