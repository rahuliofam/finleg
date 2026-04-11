#!/usr/bin/env node
/**
 * QuickBooks token refresh script — keeps tokens from expiring.
 *
 * Refresh tokens expire after 100 days of non-use. This script:
 * 1. Uses the current refresh token to get a fresh access + refresh token
 * 2. Saves new tokens to Supabase qb_tokens table
 * 3. Saves new refresh token to local.env
 *
 * Run weekly via scheduled task or cron to prevent token expiry.
 *
 * Usage: node scripts/qb-refresh-token.mjs
 */

import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localEnvPath = resolve(__dirname, '..', 'local.env');

config(); // Load .env
config({ path: localEnvPath, override: true });

const CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID;
const CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
const REALM_ID = process.env.QUICKBOOKS_REALM_ID;
const ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT || 'production';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const BASE_API = ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

// Support getting refresh token from Supabase if not in env
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET');
  process.exit(1);
}

if (!REALM_ID) {
  console.error('Missing QUICKBOOKS_REALM_ID');
  process.exit(1);
}

const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

async function getRefreshToken() {
  // Always prefer Supabase — it's the authoritative store.
  // qb-sync and qb-writeback edge functions rotate the refresh token there,
  // so local.env goes stale whenever those functions run.
  if (SUPABASE_SERVICE_KEY) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/qb_tokens?realm_id=eq.${REALM_ID}&select=refresh_token`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const rows = await res.json();
    if (rows.length > 0 && rows[0].refresh_token) {
      return rows[0].refresh_token;
    }
  }

  // Fall back to local.env only if Supabase is unavailable
  if (process.env.QUICKBOOKS_REFRESH_TOKEN) {
    console.log('   ⚠️  Using local.env token (Supabase unavailable) — may be stale');
    return process.env.QUICKBOOKS_REFRESH_TOKEN;
  }

  return null;
}

async function refreshTokens() {
  console.log('\n🔄 QuickBooks Token Refresh');
  console.log(`   Environment: ${ENVIRONMENT}`);
  console.log(`   Realm ID:    ${REALM_ID}`);
  console.log(`   Time:        ${new Date().toISOString()}`);

  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    console.error('\n❌ No refresh token found in local.env or Supabase.');
    console.error('   Re-authorize via OAuth Playground first.');
    process.exit(1);
  }

  console.log('   Refreshing tokens...');

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
  if (!res.ok) {
    console.error(`\n❌ Token refresh failed (${res.status}):`, JSON.stringify(tokens));
    process.exit(1);
  }

  console.log('   ✅ Token refresh successful!');
  console.log(`   New access token expires in: ${tokens.expires_in}s`);
  console.log(`   New refresh token expires in: ${Math.round(tokens.x_refresh_token_expires_in / 86400)} days`);

  // Verify by calling CompanyInfo
  const verifyRes = await fetch(
    `${BASE_API}/v3/company/${REALM_ID}/companyinfo/${REALM_ID}`,
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
    }
  );

  if (verifyRes.ok) {
    const data = await verifyRes.json();
    console.log(`   ✅ API verified — Company: ${data.CompanyInfo.CompanyName}`);
  } else {
    console.error(`   ⚠️  API verification failed (${verifyRes.status})`);
  }

  // Save to local.env
  try {
    let envContent = readFileSync(localEnvPath, 'utf-8');
    if (envContent.includes('QUICKBOOKS_REFRESH_TOKEN=')) {
      envContent = envContent.replace(
        /QUICKBOOKS_REFRESH_TOKEN=.*/,
        `QUICKBOOKS_REFRESH_TOKEN=${tokens.refresh_token}`
      );
    } else {
      envContent += `\nQUICKBOOKS_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    writeFileSync(localEnvPath, envContent);
    console.log('   ✅ Saved refresh token to local.env');
  } catch (e) {
    console.log(`   ⚠️  Could not save to local.env: ${e.message}`);
  }

  // Save to Supabase
  if (SUPABASE_SERVICE_KEY) {
    try {
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      const refreshExpiresAt = new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString();

      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/qb_tokens?realm_id=eq.${REALM_ID}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: expiresAt,
            refresh_expires_at: refreshExpiresAt,
            updated_at: new Date().toISOString(),
          }),
        }
      );

      if (upsertRes.ok) {
        console.log('   ✅ Saved tokens to Supabase qb_tokens');
      } else {
        const err = await upsertRes.text();
        console.log(`   ⚠️  Supabase save failed: ${err}`);
      }
    } catch (e) {
      console.log(`   ⚠️  Supabase save error: ${e.message}`);
    }
  }

  console.log('\n✅ Token refresh complete!\n');
}

refreshTokens().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
