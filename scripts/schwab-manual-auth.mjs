#!/usr/bin/env node
// Manual Schwab OAuth — uses the portsie callback URL (already registered with Schwab)
// to get tokens, then stores them encrypted in finleg's Supabase.
//
// Secrets are pulled from Bitwarden CLI (bw must be unlocked).
//
// Usage:
//   node scripts/schwab-manual-auth.mjs            # prints auth URL
//   node scripts/schwab-manual-auth.mjs <code>      # exchanges code for tokens

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { webcrypto } from 'crypto';

// ============================================================
// Bitwarden helpers — pull secrets at runtime
// ============================================================

function bwGet(itemName, fieldName) {
  try {
    const out = execSync(
      `bw list items --search "${itemName}" --session "$BW_SESSION" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    const items = JSON.parse(out);
    const item = items.find(i => i.name === itemName);
    if (!item) throw new Error(`Bitwarden item "${itemName}" not found`);
    const field = item.fields?.find(f => f.name === fieldName);
    if (!field) throw new Error(`Field "${fieldName}" not found in "${itemName}"`);
    return field.value;
  } catch (e) {
    console.error(`\nFailed to read "${fieldName}" from Bitwarden item "${itemName}":`);
    console.error(e.message);
    console.error('\nMake sure Bitwarden is unlocked: export BW_SESSION=$(bw unlock --raw)');
    process.exit(1);
  }
}

if (!process.env.BW_SESSION) {
  console.error('BW_SESSION not set. Unlock Bitwarden first:\n  export BW_SESSION=$(bw unlock --raw)');
  process.exit(1);
}

// Load env for Supabase credentials
let envPath = resolve(import.meta.dirname, '..', '.env');
try { readFileSync(envPath); } catch { envPath = '/Users/rahulio/Documents/CodingProjects/finleg/.env'; }
const envLines = readFileSync(envPath, 'utf-8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}

// Schwab app credentials — from Bitwarden (Oauth folder)
console.log('Reading secrets from Bitwarden...');
const BW_ITEM = 'Schwab Developer API — App Credentials';
const APP_KEY = bwGet(BW_ITEM, 'App Key');
const APP_SECRET = bwGet(BW_ITEM, 'App Secret');
const TOKEN_ENCRYPTION_KEY = bwGet(BW_ITEM, 'Token Encryption Key');
const CALLBACK_URL = bwGet(BW_ITEM, 'Callback URL (Portsie)');
const SCHWAB_AUTH_URL = bwGet(BW_ITEM, 'Authorization URL');
const SCHWAB_TOKEN_URL = bwGet(BW_ITEM, 'Token URL');
const INSTITUTION_NAME = 'Charles Schwab';
const WORKER_AUTH_TOKEN = bwGet('Finleg Schwab Worker — Auth Token', 'Worker Status Auth Token');
console.log('Secrets loaded.\n');

// Supabase
const SUPABASE_URL = env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// Encryption — matches the Cloudflare worker's AES-256-GCM format
// ============================================================

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function encrypt(plaintext, hexKey) {
  const keyBytes = hexToBytes(hexKey);
  const key = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

// ============================================================
// Main
// ============================================================

const code = process.argv[2];

if (!code) {
  // Step 1: Print auth URL
  const params = new URLSearchParams({
    client_id: APP_KEY,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
  });
  console.log('\n=== Schwab OAuth — Manual Flow ===\n');
  console.log('1. Open this URL in your browser:\n');
  console.log(`   ${SCHWAB_AUTH_URL}?${params}\n`);
  console.log('2. Log in with your Schwab brokerage credentials');
  console.log('3. After authorizing, you\'ll be redirected to portsie.com');
  console.log('   The page may show an error — that\'s fine!');
  console.log('   Copy the "code" parameter from the URL bar.\n');
  console.log('   Example URL: https://portsie.com/schwab/callback?code=XXXXX&session=YYY');
  console.log('   Copy everything after "code=" up to the next "&"\n');
  console.log('4. Run: node scripts/schwab-manual-auth.mjs "PASTE_CODE_HERE"\n');
  process.exit(0);
}

// Step 2: Exchange code for tokens
console.log('\nExchanging authorization code for tokens...');

const credentials = Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString('base64');

const tokenRes = await fetch(SCHWAB_TOKEN_URL, {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CALLBACK_URL,
  }),
});

if (!tokenRes.ok) {
  const errText = await tokenRes.text();
  console.error(`\nToken exchange failed (${tokenRes.status}):`);
  console.error(errText);
  process.exit(1);
}

const tokens = await tokenRes.json();
console.log('Token exchange successful!');
console.log(`  Access token expires in: ${tokens.expires_in}s`);
console.log(`  Scope: ${tokens.scope || 'N/A'}`);
console.log(`  Token type: ${tokens.token_type}`);

// Look up institution ID
const { data: institutions, error: instErr } = await supabase
  .from('institutions')
  .select('id')
  .eq('name', INSTITUTION_NAME)
  .limit(1);

if (instErr || !institutions?.length) {
  console.error('Charles Schwab institution not found in DB:', instErr);
  process.exit(1);
}

const institutionId = institutions[0].id;
console.log(`\nInstitution ID: ${institutionId}`);

// Encrypt tokens
console.log('Encrypting tokens...');
const accessEncrypted = await encrypt(tokens.access_token, TOKEN_ENCRYPTION_KEY);
const refreshEncrypted = await encrypt(tokens.refresh_token, TOKEN_ENCRYPTION_KEY);

// Upsert into oauth_tokens
const now = new Date();
const { error: upsertErr } = await supabase
  .from('oauth_tokens')
  .upsert({
    institution_id: institutionId,
    access_token: accessEncrypted,
    refresh_token: refreshEncrypted,
    access_token_expires_at: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    external_client_id: APP_KEY,
    last_refreshed_at: now.toISOString(),
  }, { onConflict: 'institution_id' });

if (upsertErr) {
  console.error('Failed to store tokens:', upsertErr);
  process.exit(1);
}

console.log('\nTokens stored in Supabase (encrypted)!');

// Verify
const statusRes = await fetch('https://schwab-oauth.finleg.workers.dev/schwab/status', {
  headers: { 'Authorization': `Bearer ${WORKER_AUTH_TOKEN}` },
});
const status = await statusRes.json();
console.log('\nWorker status check:', JSON.stringify(status, null, 2));
console.log('\nDone! You can now run the sync function to pull portfolio data.');
