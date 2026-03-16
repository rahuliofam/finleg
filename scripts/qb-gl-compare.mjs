#!/usr/bin/env node
/**
 * Fetch QuickBooks General Ledger via API and compare against the CSV export.
 * Optionally uploads API response to Cloudflare R2.
 *
 * Usage:
 *   node scripts/qb-gl-compare.mjs                    # fetch + compare
 *   node scripts/qb-gl-compare.mjs --upload            # also upload to R2
 *   node scripts/qb-gl-compare.mjs --upload --test     # upload with test flag
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', 'local.env');
dotenv.config({ path: envPath });

const CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID;
const CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
const REALM_ID = process.env.QUICKBOOKS_REALM_ID;
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const BASE_API = 'https://quickbooks.api.intuit.com';

const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// --- Args ---
const args = process.argv.slice(2);
const shouldUpload = args.includes('--upload');
const isTest = args.includes('--test');

// --- OAuth refresh ---
async function getAccessToken() {
  const refreshToken = process.env.QUICKBOOKS_REFRESH_TOKEN;
  if (!refreshToken) {
    console.error('Missing QUICKBOOKS_REFRESH_TOKEN in local.env');
    process.exit(1);
  }

  console.log('   Refreshing access token...');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const tokens = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(tokens)}`);

  // Save rotated refresh token
  if (tokens.refresh_token) {
    try {
      let envContent = readFileSync(envPath, 'utf-8');
      envContent = envContent.replace(
        /QUICKBOOKS_REFRESH_TOKEN=.*/,
        `QUICKBOOKS_REFRESH_TOKEN=${tokens.refresh_token}`
      );
      writeFileSync(envPath, envContent);
      console.log('   Saved new refresh token to local.env');
    } catch { /* silent */ }
  }

  return tokens.access_token;
}

// --- Parse API GL report into flat rows ---
function parseGLReport(glData) {
  const rows = [];

  function walk(items, currentAccount) {
    if (!items) return;
    for (const item of items) {
      if (item.type === 'Section') {
        const header = item.Header?.ColData || [];
        const acctName = header[0]?.value || currentAccount;
        // Check for Beginning Balance in header
        if (header.length > 1 && header[0]?.value === 'Beginning Balance') {
          const balance = header[header.length - 1]?.value || '0';
          rows.push({
            account: currentAccount,
            distribution_account: 'Beginning Balance',
            transaction_date: null,
            transaction_type: null,
            num: null,
            name: null,
            memo_description: null,
            split: null,
            amount: null,
            balance: balance,
            is_beginning_balance: true,
          });
        }
        walk(item.Rows?.Row, acctName);
      } else if (item.type === 'Data') {
        const cols = item.ColData || [];
        // Columns: tx_date, txn_type, doc_num, name, memo, split_acc, subt_nat_amount, rbal_nat_amount
        rows.push({
          account: currentAccount,
          distribution_account: cols[0]?.value || null,
          transaction_date: cols[1]?.value || null,
          transaction_type: cols[2]?.value || null,
          num: cols[3]?.value || null,
          name: cols[4]?.value || null,
          memo_description: cols[5]?.value || null,
          split: cols[6]?.value || null,
          amount: cols[7]?.value || null,
          balance: cols[8]?.value || null,
          is_beginning_balance: false,
        });
      }
    }
  }

  walk(glData.Rows?.Row, null);
  return rows;
}

// --- Upload to R2 ---
async function uploadToR2(data, key) {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const bucket = 'bookkeeping-docs';
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
    Metadata: {
      source: 'quickbooks-api',
      type: isTest ? 'test' : 'production',
      fetched_at: new Date().toISOString(),
      realm_id: REALM_ID,
    },
  }));

  console.log(`   Uploaded to R2: ${bucket}/${key}`);
}

// --- Main ---
async function main() {
  console.log('\n🔑 QuickBooks GL Compare');
  console.log(`   Realm: ${REALM_ID}`);

  const accessToken = await getAccessToken();

  // Fetch GL matching the CSV date range: Jan 1 2025 - Mar 15 2026
  const startDate = '2025-01-01';
  const endDate = '2026-03-15';

  console.log(`\n📡 Fetching General Ledger: ${startDate} to ${endDate}...`);

  const glRes = await fetch(
    `${BASE_API}/v3/company/${REALM_ID}/reports/GeneralLedger?start_date=${startDate}&end_date=${endDate}&columns=subt_nat_home_amount,rbal_nat_home_amount,tx_date,txn_type,doc_num,name,memo,split_acc,subt_nat_amount,rbal_nat_amount&minorversion=75`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!glRes.ok) {
    const text = await glRes.text();
    console.error(`API Error ${glRes.status}: ${text}`);
    process.exit(1);
  }

  const glData = await glRes.json();
  const header = glData.Header;
  console.log(`   Report: ${header?.ReportName}`);
  console.log(`   Period: ${header?.StartPeriod} to ${header?.EndPeriod}`);

  // Parse into flat rows
  const apiRows = parseGLReport(glData);
  const apiTxnRows = apiRows.filter(r => !r.is_beginning_balance);
  console.log(`   API transaction rows: ${apiTxnRows.length}`);
  console.log(`   API beginning balance rows: ${apiRows.length - apiTxnRows.length}`);

  // Save raw API response locally
  const localPath = resolve(__dirname, '..', 'qb-general-ledger-api.json');
  writeFileSync(localPath, JSON.stringify(glData, null, 2));
  console.log(`   Saved to: qb-general-ledger-api.json`);

  // Upload to R2 if requested
  if (shouldUpload) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefix = isTest ? 'test/' : '';
    const r2Key = `quickbooks/${prefix}general-ledger-${startDate}-to-${endDate}-${timestamp}.json`;
    console.log(`\n📤 Uploading to R2...`);
    await uploadToR2(glData, r2Key);
  }

  // --- Compare with Supabase CSV data ---
  console.log('\n📊 Comparing with Supabase CSV data...');

  const sb = createClient(
    process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Fetch all CSV rows with pagination
  let csvRows = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await sb.from('qb_general_ledger')
      .select('account, distribution_account, transaction_date, transaction_type, num, name, memo_description, split, amount, balance, is_beginning_balance')
      .eq('is_beginning_balance', false)
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    csvRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`   CSV transaction rows (Supabase): ${csvRows.length}`);
  console.log(`   API transaction rows:            ${apiTxnRows.length}`);
  console.log(`   Difference:                      ${apiTxnRows.length - csvRows.length}`);

  // Compare accounts
  const apiAccounts = {};
  const csvAccounts = {};
  for (const r of apiTxnRows) apiAccounts[r.account] = (apiAccounts[r.account] || 0) + 1;
  for (const r of csvRows) csvAccounts[r.account] = (csvAccounts[r.account] || 0) + 1;

  const allAccounts = new Set([...Object.keys(apiAccounts), ...Object.keys(csvAccounts)]);

  console.log(`\n   Accounts in API only (${Object.keys(apiAccounts).filter(a => !csvAccounts[a]).length}):`);
  for (const a of Object.keys(apiAccounts).filter(a => !csvAccounts[a]).sort()) {
    console.log(`     + ${apiAccounts[a].toString().padStart(5)} ${a}`);
  }

  console.log(`\n   Accounts in CSV only (${Object.keys(csvAccounts).filter(a => !apiAccounts[a]).length}):`);
  for (const a of Object.keys(csvAccounts).filter(a => !apiAccounts[a]).sort()) {
    console.log(`     - ${csvAccounts[a].toString().padStart(5)} ${a}`);
  }

  // Row count diff per shared account
  const diffs = [];
  for (const a of allAccounts) {
    const apiCount = apiAccounts[a] || 0;
    const csvCount = csvAccounts[a] || 0;
    if (apiCount !== csvCount) {
      diffs.push({ account: a, api: apiCount, csv: csvCount, diff: apiCount - csvCount });
    }
  }

  if (diffs.length > 0) {
    console.log(`\n   Row count mismatches (${diffs.length} accounts):`);
    diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    for (const d of diffs.slice(0, 30)) {
      console.log(`     ${d.diff > 0 ? '+' : ''}${d.diff.toString().padStart(5)}  API:${d.api.toString().padStart(5)} CSV:${d.csv.toString().padStart(5)}  ${d.account}`);
    }
  }

  const matchingAccounts = [...allAccounts].filter(a => apiAccounts[a] === csvAccounts[a]);
  console.log(`\n   Accounts with matching row counts: ${matchingAccounts.length}/${allAccounts.size}`);

  console.log('\n✅ Done!\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
