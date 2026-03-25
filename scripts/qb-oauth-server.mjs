#!/usr/bin/env node
/**
 * QuickBooks OAuth 2.0 helper — runs a local server to complete the OAuth flow
 * and store tokens in Supabase qb_tokens table.
 *
 * Usage: node scripts/qb-oauth-server.mjs
 *
 * 1. Opens browser to QB authorization page
 * 2. QB redirects back to localhost:3847/callback
 * 3. Exchanges auth code for tokens
 * 4. Stores tokens in Supabase qb_tokens table
 */

import { createClient } from '@supabase/supabase-js';
import { createServer } from 'http';
import { config } from 'dotenv';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localEnvPath = resolve(__dirname, '..', 'local.env');

config(); // Load .env
// Also load local.env (override=true so local.env values take precedence)
config({ path: localEnvPath, override: true });

const CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID;
const CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET;
const QB_ENV = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
const REDIRECT_URI = 'http://localhost:3000/callback';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET in .env');
  console.error('Get these from https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0');
  process.exit(1);
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Build authorization URL
const authParams = new URLSearchParams({
  client_id: CLIENT_ID,
  response_type: 'code',
  scope: 'com.intuit.quickbooks.accounting',
  redirect_uri: REDIRECT_URI,
  state: 'finleg-oauth',
});

const authorizationUrl = `${AUTH_URL}?${authParams}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3000`);

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const realmId = url.searchParams.get('realmId');

    if (!code || !realmId) {
      res.writeHead(400);
      res.end('Missing code or realmId');
      return;
    }

    console.log(`\nReceived auth code for realm ${realmId}`);

    try {
      // Exchange code for tokens
      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed: ${tokenRes.status} ${text}`);
      }

      const tokenData = await tokenRes.json();
      console.log('Token exchange successful!');

      // Fetch company info
      const baseUrl = QB_ENV === 'sandbox'
        ? 'https://sandbox-quickbooks.api.intuit.com'
        : 'https://quickbooks.api.intuit.com';

      const companyRes = await fetch(`${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/json',
        },
      });

      let companyName = null;
      if (companyRes.ok) {
        const companyData = await companyRes.json();
        companyName = companyData?.CompanyInfo?.CompanyName;
        console.log(`Connected to: ${companyName}`);
      }

      // Store in Supabase
      const tokenRecord = {
        realm_id: realmId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type || 'bearer',
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        refresh_expires_at: new Date(Date.now() + tokenData.x_refresh_token_expires_in * 1000).toISOString(),
        company_name: companyName,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('qb_tokens')
        .upsert(tokenRecord, { onConflict: 'realm_id' });

      if (error) throw error;

      console.log(`Tokens stored in qb_tokens for realm ${realmId}`);

      // Also save refresh token to local.env for scripts that use it
      try {
        let envContent = readFileSync(localEnvPath, 'utf-8');
        if (envContent.includes('QUICKBOOKS_REFRESH_TOKEN=')) {
          envContent = envContent.replace(
            /QUICKBOOKS_REFRESH_TOKEN=.*/,
            `QUICKBOOKS_REFRESH_TOKEN=${tokenData.refresh_token}`
          );
        } else {
          envContent += `\nQUICKBOOKS_REFRESH_TOKEN=${tokenData.refresh_token}\n`;
        }
        writeFileSync(localEnvPath, envContent);
        console.log(`Refresh token saved to local.env`);
      } catch (e) {
        console.log(`Could not save to local.env: ${e.message}`);
        console.log(`Refresh token: ${tokenData.refresh_token}`);
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>QuickBooks Connected!</h1>
          <p>Company: <strong>${companyName || realmId}</strong></p>
          <p>Tokens stored in Supabase. You can close this window.</p>
        </body></html>
      `);

      console.log('\nOAuth complete! You can now run the QB sync.');
      setTimeout(() => process.exit(0), 1000);
    } catch (err) {
      console.error('OAuth error:', err);
      res.writeHead(500);
      res.end(`Error: ${err.message}`);
      setTimeout(() => process.exit(1), 1000);
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><p>Waiting for OAuth callback...</p></body></html>`);
  }
});

server.listen(3000, () => {
  console.log('OAuth callback server running on http://localhost:3000');
  console.log(`\nOpen this URL to authorize:\n\n${authorizationUrl}\n`);

  // Try to open browser
  try {
    execSync(`open "${authorizationUrl}"`);
    console.log('(Browser opened)');
  } catch {
    console.log('Please open the URL above in your browser.');
  }
});
