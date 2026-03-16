#!/usr/bin/env node
/**
 * QuickBooks OAuth 2.0 test script — two modes:
 *
 * MODE 1 — Fresh auth (get tokens via OAuth Playground):
 *   1. Go to https://developer.intuit.com/v2/OAuth2Playground
 *   2. Select your app, connect, authorize
 *   3. Copy the access_token and refresh_token
 *   4. Run: QUICKBOOKS_REALM_ID=xxx QUICKBOOKS_ACCESS_TOKEN=xxx node scripts/test-quickbooks.mjs
 *
 * MODE 2 — Refresh (if you have a saved refresh token):
 *   Run: node scripts/test-quickbooks.mjs
 *   (uses QUICKBOOKS_REFRESH_TOKEN and QUICKBOOKS_REALM_ID from local.env)
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', 'local.env');
dotenv.config({ path: envPath });

const CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID;
const CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
const ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const BASE_API = ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET in local.env');
  process.exit(1);
}

const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// Get access token — either from env (fresh from playground) or via refresh
async function getAccessToken() {
  // If access token passed directly (from OAuth Playground)
  if (process.env.QUICKBOOKS_ACCESS_TOKEN) {
    console.log('   Using access token from environment');
    return process.env.QUICKBOOKS_ACCESS_TOKEN;
  }

  // Otherwise, use refresh token
  const refreshToken = process.env.QUICKBOOKS_REFRESH_TOKEN;
  if (!refreshToken) {
    console.error('\nNo access token or refresh token found.');
    console.error('Get tokens from the OAuth Playground:');
    console.error('  https://developer.intuit.com/v2/OAuth2Playground');
    console.error('\nThen run:');
    console.error('  QUICKBOOKS_ACCESS_TOKEN=xxx QUICKBOOKS_REALM_ID=xxx node scripts/test-quickbooks.mjs');
    process.exit(1);
  }

  console.log('   Refreshing access token...');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const tokens = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(tokens)}`);
  }

  // Save new refresh token to local.env for next time
  if (tokens.refresh_token) {
    try {
      let envContent = readFileSync(envPath, 'utf-8');
      if (envContent.includes('QUICKBOOKS_REFRESH_TOKEN=')) {
        envContent = envContent.replace(
          /QUICKBOOKS_REFRESH_TOKEN=.*/,
          `QUICKBOOKS_REFRESH_TOKEN=${tokens.refresh_token}`
        );
      } else {
        envContent += `\nQUICKBOOKS_REFRESH_TOKEN=${tokens.refresh_token}\n`;
      }
      writeFileSync(envPath, envContent);
      console.log('   Saved new refresh token to local.env');
    } catch {
      console.log(`   New refresh token: ${tokens.refresh_token}`);
    }
  }

  return tokens.access_token;
}

const realmId = process.env.QUICKBOOKS_REALM_ID;
if (!realmId) {
  console.error('Missing QUICKBOOKS_REALM_ID. Set it in local.env or pass as env var.');
  process.exit(1);
}

console.log('\n🔑 QuickBooks API Test');
console.log(`   Environment: ${ENVIRONMENT}`);
console.log(`   Realm ID:    ${realmId}`);

const accessToken = await getAccessToken();

// Test API call — get company info
console.log('\n📡 Fetching CompanyInfo...');

const apiRes = await fetch(
  `${BASE_API}/v3/company/${realmId}/companyinfo/${realmId}`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  }
);

// Capture intuit_tid for troubleshooting
const intuitTid = apiRes.headers.get('intuit_tid');
if (intuitTid) {
  console.log(`   intuit_tid: ${intuitTid}`);
}

const companyData = await apiRes.json();

if (!apiRes.ok) {
  console.error(`\n❌ API Error (${apiRes.status}): ${JSON.stringify(companyData, null, 2)}`);
  process.exit(1);
}

const info = companyData.CompanyInfo;
console.log('\n✅ QuickBooks API is working!\n');
console.log('   Company Info:');
console.log(`   Name:    ${info.CompanyName}`);
console.log(`   Legal:   ${info.LegalName || 'N/A'}`);
console.log(`   Country: ${info.Country}`);
console.log(`   Email:   ${info.Email?.Address || 'N/A'}`);
console.log(`   Realm:   ${realmId}`);

// Quick GL test — fetch chart of accounts
console.log('\n📡 Fetching Chart of Accounts...');

const coaRes = await fetch(
  `${BASE_API}/v3/company/${realmId}/query?query=${encodeURIComponent('SELECT * FROM Account MAXRESULTS 1000')}`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  }
);

const coaData = await coaRes.json();
if (coaRes.ok) {
  const accounts = coaData.QueryResponse?.Account || [];
  console.log(`   Found ${accounts.length} accounts in Chart of Accounts`);
  console.log('\n   Top accounts:');
  accounts.slice(0, 10).forEach(a => {
    console.log(`   - ${a.Name} (${a.AccountType}) Balance: ${a.CurrentBalance ?? 'N/A'}`);
  });
} else {
  console.error(`   CoA query failed: ${JSON.stringify(coaData)}`);
}

// Fetch General Ledger report
console.log('\n📡 Fetching General Ledger report...');

const glRes = await fetch(
  `${BASE_API}/v3/company/${realmId}/reports/GeneralLedger?start_date=2024-01-01&end_date=2025-12-31&columns=tx_date,txn_type,doc_num,name,memo,split_acc,subt_nat_amount,rbal_nat_amount&minorversion=75`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  }
);

const glData = await glRes.json();
if (glRes.ok) {
  const header = glData.Header;
  console.log(`   Report: ${header?.ReportName}`);
  console.log(`   Period: ${header?.StartPeriod} to ${header?.EndPeriod}`);
  console.log(`   Currency: ${header?.Currency}`);

  // Count rows
  let rowCount = 0;
  function countRows(rows) {
    if (!rows) return;
    for (const row of rows) {
      if (row.type === 'Data') rowCount++;
      if (row.Rows?.Row) countRows(row.Rows.Row);
    }
  }
  countRows(glData.Rows?.Row);
  console.log(`   Transaction rows: ${rowCount}`);

  // Save full GL to file for comparison
  const outPath = resolve(__dirname, '..', 'qb-general-ledger-api.json');
  writeFileSync(outPath, JSON.stringify(glData, null, 2));
  console.log(`\n   Full GL report saved to: qb-general-ledger-api.json`);
} else {
  console.error(`   GL report failed: ${JSON.stringify(glData)}`);
}

console.log('\n✅ Done!\n');
