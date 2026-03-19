#!/usr/bin/env node
// Insert missing document_index rows into Supabase (files already in R2)

import { createClient } from '@supabase/supabase-js';
import { readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }

const SRC = '/Users/rahulio/Documents/CodingProjects/noncode/Finleg/AI Financial/Current Sonnad Accounting Files - Amanda 2022+';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CONTENT_TYPES = { pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',htm:'text/html',html:'text/html',zip:'application/zip',msg:'application/vnd.ms-outlook',xls:'application/vnd.ms-excel' };

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
  [/^Cash App/, { r2Prefix: 'bank-accounts/cash-app', category: 'statement', accountType: 'payment', institution: 'cash-app', accountName: 'Cash App', accountHolder: 'Rahul' }],
  [/^Venmo/, { r2Prefix: 'bank-accounts/venmo', category: 'statement', accountType: 'payment', institution: 'venmo', accountName: 'Venmo', accountHolder: 'Rahul' }],
  [/^Paypal/, { r2Prefix: 'bank-accounts/paypal', category: 'statement', accountType: 'payment', institution: 'paypal', accountName: 'PayPal', accountHolder: 'Rahul' }],
  [/^CS Brokerage \(0566\)/, { r2Prefix: 'brokerage/schwab-brokerage-0566', category: 'statement', accountType: 'brokerage', institution: 'charles-schwab', accountName: 'CS Brokerage', accountNumber: '0566', accountHolder: 'Rahul' }],
  [/^CS Brokerage \(2028\)/, { r2Prefix: 'brokerage/schwab-brokerage-2028', category: 'statement', accountType: 'brokerage', institution: 'charles-schwab', accountName: 'CS Brokerage', accountNumber: '2028', accountHolder: 'Subhash' }],
  [/^CS Trading \(2192\)/, { r2Prefix: 'brokerage/schwab-trading-2192', category: 'statement', accountType: 'brokerage', institution: 'charles-schwab', accountName: 'CS Trading', accountNumber: '2192', accountHolder: 'Rahul' }],
  [/^CS IRA \(3902\)/, { r2Prefix: 'brokerage/schwab-ira-3902', category: 'statement', accountType: 'ira', institution: 'charles-schwab', accountName: 'CS IRA', accountNumber: '3902', accountHolder: 'Rahul' }],
  [/^CS Trust \(0044\)/, { r2Prefix: 'brokerage/schwab-trust-0044', category: 'statement', accountType: 'trust', institution: 'charles-schwab', accountName: 'CS Trust', accountNumber: '0044', accountHolder: 'Trust' }],
  [/^Coinbase/, { r2Prefix: 'brokerage/coinbase', category: 'statement', accountType: 'crypto', institution: 'coinbase', accountName: 'Coinbase', accountHolder: 'Rahul' }],
  [/^Robinhood  - Roth IRA/, { r2Prefix: 'brokerage/robinhood-ira-8249-2310', category: 'statement', accountType: 'ira', institution: 'robinhood', accountName: 'Robinhood Roth IRA & Traditional IRA', accountNumber: '8249/2310', accountHolder: 'Rahul' }],
  [/^Robinhood Consolidated IRA/, { r2Prefix: 'brokerage/robinhood-consolidated-ira', category: 'statement', accountType: 'ira', institution: 'robinhood', accountName: 'Robinhood Consolidated IRA', accountHolder: 'Rahul' }],
  [/^PNC Mortgage/, { r2Prefix: 'loans/pnc-mortgage', category: 'statement', accountType: 'mortgage', institution: 'pnc', accountName: 'PNC Mortgage', accountHolder: 'Rahul' }],
  [/^US Bank Equity \(9078\)/, { r2Prefix: 'loans/us-bank-equity-9078', category: 'statement', accountType: 'heloc', institution: 'us-bank', accountName: 'US Bank Equity Line', accountNumber: '9078', accountHolder: 'Rahul' }],
  [/^US Bank Overdraft Credit Line \(3784\)/, { r2Prefix: 'loans/us-bank-overdraft-3784', category: 'statement', accountType: 'credit-line', institution: 'us-bank', accountName: 'US Bank Overdraft Credit Line', accountNumber: '3784', accountHolder: 'Rahul' }],
  [/^Auto Loans/, { r2Prefix: 'loans/auto-loans', category: 'statement', accountType: 'auto-loan', institution: 'various', accountName: 'Auto Loans', accountHolder: 'Rahul' }],
  [/^SBA Loan 4469264009/, { r2Prefix: 'loans/sba-4469264009-physical-business', category: 'statement', accountType: 'sba-loan', institution: 'sba', accountName: 'SBA Physical Business Disaster Loan', accountNumber: '4469264009', accountHolder: 'Family' }],
  [/^SBA Loan 9663307809/, { r2Prefix: 'loans/sba-9663307809-covid-injury', category: 'statement', accountType: 'sba-loan', institution: 'sba', accountName: 'SBA COVID-19 Economic Injury Loan', accountNumber: '9663307809', accountHolder: 'Tesloop' }],
  [/^Taxes/, { bucket: 'bookkeeping-docs', r2Prefix: 'taxes', category: 'tax', accountType: 'tax', institution: 'irs', accountName: 'Taxes', accountHolder: 'Family' }],
  [/^Insurance Policies/, { bucket: 'bookkeeping-docs', r2Prefix: 'insurance', category: 'insurance', accountType: 'insurance', institution: 'various', accountName: 'Insurance Policies', accountHolder: 'Family' }],
  [/^AAP/, { bucket: 'bookkeeping-docs', r2Prefix: 'property/alpaca-playhouse', category: 'property-expense', accountType: 'property', institution: 'various', accountName: 'Alpaca Playhouse', accountHolder: 'Family', property: 'alpaca-playhouse' }],
  [/^WA House/, { bucket: 'bookkeeping-docs', r2Prefix: 'property/wa-sharingwood', category: 'property-expense', accountType: 'property', institution: 'various', accountName: 'WA Sharingwood House', accountHolder: 'Family', property: 'wa-sharingwood' }],
  [/^Rahul.*Credit/, { bucket: 'bookkeeping-docs', r2Prefix: 'credit-reports', category: 'credit-report', accountType: 'credit-report', institution: 'various', accountName: 'Rahul Credit Reports', accountHolder: 'Rahul' }],
  [/^X Closed Accounts/, { r2Prefix: 'closed-accounts', category: 'statement', accountType: 'closed', institution: 'various', accountName: 'Closed Accounts', accountHolder: 'various', isClosed: true }],
  [/^Quickbooks Backups/, { bucket: 'bookkeeping-docs', r2Prefix: 'quickbooks', category: 'backup', accountType: 'accounting-software', institution: 'quickbooks', accountName: 'QuickBooks Backups', accountHolder: 'Family' }],
  [/^AI Analysis/, { bucket: 'bookkeeping-docs', r2Prefix: 'ai-analysis', category: 'analysis', accountType: 'analysis', institution: 'internal', accountName: 'AI Analysis', accountHolder: 'Rahul' }],
];

function collectFiles(dir, base) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    if (entry.isDirectory()) files.push(...collectFiles(full, base));
    else files.push({ fullPath: full, relPath: rel, size: statSync(full).size });
  }
  return files;
}

function getR(relpath) {
  const topDir = relpath.split('/')[0];
  const result = { bucket: 'financial-statements', r2Prefix: '', category: '', accountType: '', institution: '', accountName: '', accountNumber: '', accountHolder: '', isClosed: false, property: null, convertible: false };
  for (const [pattern, overrides] of routes) {
    if (pattern.test(topDir)) { Object.assign(result, overrides); return result; }
  }
  result.bucket = 'bookkeeping-docs'; result.r2Prefix = 'reference-spreadsheets'; result.category = 'reference'; result.accountType = 'summary'; result.institution = 'internal'; result.accountName = 'Master Reference Files'; result.accountHolder = 'Family'; result.convertible = true;
  return result;
}

function extractD(filename, relpath) {
  let year = null, month = null, sd = null;
  let m = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) { year = parseInt(m[1]); month = parseInt(m[2]); sd = `${m[1]}-${m[2]}-${m[3]}`; }
  if (!m) { m = filename.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/); if (m && parseInt(m[1])>=2000 && parseInt(m[1])<=2030) { year=parseInt(m[1]); month=parseInt(m[2]); sd=`${m[1]}-${m[2]}-${m[3]}`; } }
  if (!sd) { m = filename.match(/(\d{2})-(\d{2})-(\d{4})/); if (m) { month=parseInt(m[1]); year=parseInt(m[3]); sd=`${m[3]}-${m[1]}-${m[2]}`; } }
  if (!year) { m = relpath.match(/(20\d{2})/); if (m) year=parseInt(m[1]); }
  if (sd) {
    const [y,mo,d] = sd.split('-').map(Number);
    const dim = new Date(y, mo, 0).getDate();
    if (d > dim || d < 1 || mo > 12 || mo < 1) sd = null;
  }
  return { year, month, statementDate: sd };
}

// Get existing keys
const existingKeys = new Set();
let offset = 0;
while (true) {
  const { data } = await supabase.from('document_index').select('r2_key').range(offset, offset + 999);
  if (!data || data.length === 0) break;
  data.forEach(d => existingKeys.add(d.r2_key));
  offset += 1000;
}
console.log('Existing keys in Supabase:', existingKeys.size);

const allFiles = collectFiles(SRC, SRC);
const missing = [];

for (const file of allFiles) {
  const routing = getR(file.relPath);
  const parts = file.relPath.split('/');
  const subpath = parts.length > 1 ? parts.slice(1).join('/') : basename(file.relPath);
  const r2Key = `${routing.r2Prefix}/${subpath}`;
  if (existingKeys.has(r2Key)) continue;

  const ext = extname(file.relPath).slice(1).toLowerCase();
  const dates = extractD(basename(file.relPath), file.relPath);
  missing.push({
    bucket: routing.bucket, r2_key: r2Key, filename: basename(file.relPath),
    file_type: ext || 'unknown', file_size: file.size, content_type: CONTENT_TYPES[ext] || 'application/octet-stream',
    category: routing.category, account_type: routing.accountType, institution: routing.institution || null,
    account_name: routing.accountName || null, account_number: routing.accountNumber || null,
    account_holder: routing.accountHolder || null, year: dates.year, month: dates.month,
    statement_date: dates.statementDate, is_closed: routing.isClosed || false,
    property: routing.property || null, convertible: routing.convertible || false,
    original_path: file.relPath,
  });
}

console.log('Missing rows to insert:', missing.length);

for (let i = 0; i < missing.length; i += 50) {
  const batch = missing.slice(i, i + 50);
  const { error } = await supabase.from('document_index').upsert(batch, { onConflict: 'r2_key' });
  if (error) console.error('Batch error at', i, ':', error.message);
  else console.log('Inserted batch', i, '-', i + batch.length);
}

const { count: finalCount } = await supabase.from('document_index').select('id', { count: 'exact', head: true });
console.log('FINAL total indexed:', finalCount);
