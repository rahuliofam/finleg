#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
const s = createClient('https://gjdvzzxsrzuorguwkaih.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZHZ6enhzcnp1b3JndXdrYWloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQzMTk1NywiZXhwIjoyMDg5MDA3OTU3fQ.iYlTfc9IhMpOphSLUjBCTEto2Mq_1dD1-gVIEo4LUrc');

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
