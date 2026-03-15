#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }

const s = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { count: total } = await s.from('document_index').select('id', { count: 'exact', head: true });
console.log('TOTAL:', total);

console.log('\n--- By Bucket ---');
for (const b of ['financial-statements', 'bookkeeping-docs']) {
  const { count } = await s.from('document_index').select('id', { count: 'exact', head: true }).eq('bucket', b);
  console.log(`  ${b}: ${count}`);
}

console.log('\n--- By Category ---');
for (const cat of ['statement', 'tax', 'insurance', 'property-expense', 'credit-report', 'reference', 'backup', 'analysis']) {
  const { count } = await s.from('document_index').select('id', { count: 'exact', head: true }).eq('category', cat);
  if (count > 0) console.log(`  ${cat}: ${count}`);
}

console.log('\n--- By Account Type ---');
for (const at of ['credit-card', 'checking', 'payment', 'brokerage', 'ira', 'trust', 'crypto', 'mortgage', 'heloc', 'credit-line', 'auto-loan', 'sba-loan', 'tax', 'insurance', 'property', 'credit-report', 'closed', 'summary', 'accounting-software', 'analysis']) {
  const { count } = await s.from('document_index').select('id', { count: 'exact', head: true }).eq('account_type', at);
  if (count > 0) console.log(`  ${at}: ${count}`);
}

console.log('\n--- By Institution ---');
for (const inst of ['amex', 'chase', 'charles-schwab', 'us-bank', 'robinhood', 'apple', 'bank-of-america', 'pnc', 'coinbase', 'venmo', 'paypal', 'cash-app', 'sba', 'irs', 'various', 'quickbooks', 'internal']) {
  const { count } = await s.from('document_index').select('id', { count: 'exact', head: true }).eq('institution', inst);
  if (count > 0) console.log(`  ${inst}: ${count}`);
}

console.log('\n--- By Year ---');
for (let y = 2019; y <= 2026; y++) {
  const { count } = await s.from('document_index').select('id', { count: 'exact', head: true }).eq('year', y);
  if (count > 0) console.log(`  ${y}: ${count}`);
}
