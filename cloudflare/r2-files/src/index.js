/**
 * R2 Files Worker — serves files from Cloudflare R2 at files.finleg.net
 *
 * URL pattern: https://files.finleg.net/{bucket}/{r2_key}
 * Example:     https://files.finleg.net/financial-statements/credit-cards/apple-card-2202/2026-02.pdf
 *
 * Buckets: financial-statements, bookkeeping-docs, legal-docs
 */

const BUCKET_MAP = {
  'financial-statements': 'FINANCIAL_STATEMENTS',
  'bookkeeping-docs': 'BOOKKEEPING_DOCS',
  'legal-docs': 'LEGAL_DOCS',
};

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  csv: 'text/csv',
  json: 'application/json',
  txt: 'text/plain',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function getContentType(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Only GET/HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'r2-files' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Parse: /{bucket}/{r2_key}
    const parts = url.pathname.slice(1).split('/');
    if (parts.length < 2) {
      return new Response('Not found — expected /{bucket}/{key}', { status: 404 });
    }

    const bucketName = parts[0];
    const r2Key = parts.slice(1).join('/');
    const bindingName = BUCKET_MAP[bucketName];

    if (!bindingName || !env[bindingName]) {
      return new Response(`Unknown bucket: ${bucketName}`, { status: 404 });
    }

    const bucket = env[bindingName];
    const object = await bucket.get(r2Key);

    if (!object) {
      return new Response(`Not found: ${bucketName}/${r2Key}`, { status: 404 });
    }

    const headers = {
      'Content-Type': getContentType(r2Key),
      'Content-Length': object.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': object.etag,
      ...corsHeaders(origin),
    };

    // For PDFs, allow inline viewing
    if (r2Key.endsWith('.pdf')) {
      headers['Content-Disposition'] = 'inline';
    }

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, { status: 200, headers });
  },
};
