// Schwab OAuth Worker — handles OAuth flow + token management
// Uses PlaidPlus schema: oauth_tokens + institutions tables
// Auth: Bearer token for API routes, redirect-based for OAuth flow
// Secrets: SCHWAB_APP_KEY, SCHWAB_APP_SECRET, SUPABASE_URL,
//          SUPABASE_SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY, AUTH_TOKEN

const SCHWAB_AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
const SCHWAB_TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';
const GITHUB_PAGES_ORIGIN = 'https://rahulio.github.io';
const SCHWAB_INSTITUTION_NAME = 'Charles Schwab';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    try {
      // OAuth routes (no bearer auth — browser redirect flow)
      if (url.pathname === '/schwab/auth') {
        return handleAuth(url, env);
      }
      if (url.pathname === '/schwab/callback') {
        return handleCallback(url, env);
      }

      // API routes (bearer auth required)
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.AUTH_TOKEN}`) {
        return json({ error: 'unauthorized' }, 401);
      }

      if (request.method === 'GET' && url.pathname === '/schwab/status') {
        return handleStatus(env);
      }
      if (request.method === 'POST' && url.pathname === '/schwab/refresh') {
        return handleRefresh(env);
      }
      if (request.method === 'POST' && url.pathname === '/schwab/disconnect') {
        return handleDisconnect(env);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message }, 500);
    }
  }
};

// ============================================================
// Institution lookup
// ============================================================

async function getSchwabInstitutionId(env) {
  const res = await supabaseRequest(env,
    `/rest/v1/institutions?name=eq.${encodeURIComponent(SCHWAB_INSTITUTION_NAME)}&select=id&limit=1`
  );
  const data = await res.json();
  if (!data || data.length === 0) {
    throw new Error('Charles Schwab institution not found in DB. Run migration 020.');
  }
  return data[0].id;
}

// ============================================================
// OAuth Flow
// ============================================================

function handleAuth(url, env) {
  const state = crypto.randomUUID();
  const callbackUrl = 'https://www.portsie.com/schwab/callback';

  const params = new URLSearchParams({
    client_id: env.SCHWAB_APP_KEY,
    redirect_uri: callbackUrl,
    response_type: 'code',
    state,
  });

  return Response.redirect(`${SCHWAB_AUTH_URL}?${params}`, 302);
}

async function handleCallback(url, env) {
  const code = url.searchParams.get('code');
  if (!code) {
    return redirectToIntranet('error=missing_code');
  }

  const callbackUrl = 'https://www.portsie.com/schwab/callback';
  const credentials = btoa(`${env.SCHWAB_APP_KEY}:${env.SCHWAB_APP_SECRET}`);

  const tokenRes = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('Token exchange failed:', tokenRes.status, errText);
    return redirectToIntranet('error=token_exchange_failed');
  }

  const tokens = await tokenRes.json();
  const now = Date.now();
  const institutionId = await getSchwabInstitutionId(env);

  // Encrypt tokens
  const encKey = await importEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  const accessEncrypted = await encrypt(tokens.access_token, encKey);
  const refreshEncrypted = await encrypt(tokens.refresh_token, encKey);

  // Upsert into oauth_tokens (unique on institution_id)
  const supabaseRes = await supabaseRequest(env, '/rest/v1/oauth_tokens', {
    method: 'POST',
    headers: {
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      institution_id: institutionId,
      access_token: accessEncrypted,
      refresh_token: refreshEncrypted,
      access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      external_client_id: env.SCHWAB_APP_KEY,
      last_refreshed_at: new Date().toISOString(),
    }),
  });

  if (!supabaseRes.ok) {
    const errText = await supabaseRes.text();
    console.error('Supabase store failed:', supabaseRes.status, errText);
    return redirectToIntranet('error=store_failed');
  }

  return redirectToIntranet('schwab=connected');
}

// ============================================================
// API Routes
// ============================================================

async function handleStatus(env) {
  const institutionId = await getSchwabInstitutionId(env);
  const res = await supabaseRequest(env,
    `/rest/v1/oauth_tokens?institution_id=eq.${institutionId}&select=id,status,access_token_expires_at,refresh_token_expires_at,last_refreshed_at,updated_at&limit=1`
  );
  const data = await res.json();

  if (!data || data.length === 0) {
    return json({ connected: false });
  }

  const token = data[0];
  const refreshExpires = token.refresh_token_expires_at ? new Date(token.refresh_token_expires_at) : null;
  const connected = token.status === 'active' && (!refreshExpires || new Date() < refreshExpires);

  return json({
    connected,
    accessTokenExpiresAt: token.access_token_expires_at,
    refreshTokenExpiresAt: token.refresh_token_expires_at,
    lastUpdated: token.updated_at,
  });
}

async function handleRefresh(env) {
  const institutionId = await getSchwabInstitutionId(env);
  const res = await supabaseRequest(env,
    `/rest/v1/oauth_tokens?institution_id=eq.${institutionId}&select=*&limit=1`
  );
  const data = await res.json();
  if (!data || data.length === 0) {
    return json({ error: 'no tokens found' }, 404);
  }

  const encKey = await importEncryptionKey(env.TOKEN_ENCRYPTION_KEY);
  const refreshToken = await decrypt(data[0].refresh_token, encKey);

  const credentials = btoa(`${env.SCHWAB_APP_KEY}:${env.SCHWAB_APP_SECRET}`);
  const tokenRes = await fetch(SCHWAB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('Refresh failed:', tokenRes.status, errText);

    // Mark as expired if refresh fails
    if (tokenRes.status === 401 || tokenRes.status === 400) {
      await supabaseRequest(env,
        `/rest/v1/oauth_tokens?id=eq.${data[0].id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'expired', error_message: errText }) }
      );
    }

    return json({ error: 'refresh_failed', details: errText }, tokenRes.status);
  }

  const tokens = await tokenRes.json();
  const now = Date.now();

  const accessEncrypted = await encrypt(tokens.access_token, encKey);
  const refreshEncrypted = await encrypt(tokens.refresh_token, encKey);

  await supabaseRequest(env, `/rest/v1/oauth_tokens?id=eq.${data[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: accessEncrypted,
      refresh_token: refreshEncrypted,
      access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      last_refreshed_at: new Date().toISOString(),
      error_message: null,
    }),
  });

  return json({ ok: true, expiresAt: new Date(now + tokens.expires_in * 1000).toISOString() });
}

async function handleDisconnect(env) {
  const institutionId = await getSchwabInstitutionId(env);
  await supabaseRequest(env,
    `/rest/v1/oauth_tokens?institution_id=eq.${institutionId}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) }
  );
  return json({ ok: true });
}

// ============================================================
// Encryption — AES-256-GCM via Web Crypto API
// Format: base64(iv).base64(ciphertext+authTag)
// ============================================================

async function importEncryptionKey(hexKey) {
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

async function decrypt(blob, key) {
  const [ivB64, ciphertextB64] = blob.split('.');
  if (!ivB64 || !ciphertextB64) throw new Error('Invalid encrypted format');
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ============================================================
// Supabase HTTP helper
// ============================================================

async function supabaseRequest(env, path, options = {}) {
  const url = `${env.SUPABASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

// ============================================================
// Helpers
// ============================================================

function redirectToIntranet(query) {
  return Response.redirect(`${GITHUB_PAGES_ORIGIN}/finleg/intranet/bookkeeping/brokerage?${query}`, 302);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': GITHUB_PAGES_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
