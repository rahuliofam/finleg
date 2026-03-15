#!/usr/bin/env node
/**
 * Extract rich metadata from documents using Claude CLI headless mode.
 * Designed to run on Hostinger VPS via `claude --print`.
 *
 * Reads documents from Cloudflare R2, sends to Claude for parsing,
 * and updates Supabase document_index with extracted metadata.
 *
 * Usage:
 *   node scripts/extract-doc-metadata.mjs [--dry-run] [--limit=N] [--category=legal]
 *
 * Prerequisites on Hostinger:
 *   - Claude CLI installed (`npm install -g @anthropic-ai/claude-code`)
 *   - wrangler installed (`npm install -g wrangler`)
 *   - Node.js 22+
 *
 * The script:
 *   1. Queries Supabase for documents missing enriched metadata (ai_metadata IS NULL)
 *   2. Downloads each file from R2
 *   3. Sends to Claude CLI headless (`claude --print`) for structured extraction
 *   4. Updates Supabase with extracted fields
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { config } from 'dotenv';

config(); // Load .env

const execAsync = promisify(exec);

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Cloudflare R2 via S3 API
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error('Missing R2 credentials in .env (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 999;
const CATEGORY_FILTER = process.argv.find(a => a.startsWith('--category='))?.split('=')[1] || null;
const PARALLEL = 2; // concurrent Claude CLI calls (conservative for headless mode)
const TMP_DIR = '/tmp/doc-extract';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// File types Claude can parse
const PARSEABLE_TYPES = ['pdf', 'docx', 'doc', 'txt', 'csv', 'xlsx', 'xls', 'xml'];
const IMAGE_TYPES = ['jpg', 'jpeg', 'png'];

const EXTRACTION_PROMPT = `You are a document metadata extraction assistant. Analyze this document and extract structured metadata.

Return ONLY valid JSON (no markdown, no explanation) with these fields:
{
  "document_type": "string — specific type: tax-return, w2, 1099-div, 1099-int, 1099-misc, 1099-b, k1, paycheck, power-of-attorney, will, trust, healthcare-directive, divorce-decree, financial-agreement, property-deed, deed-transfer, ein-registration, business-formation, franchise-tax, vehicle-title, investment-agreement, social-security-statement, transcript, resume, affidavit, polst, credit-report, insurance-policy, bank-statement, or other",
  "title": "string — human-readable document title",
  "description": "string — 1-2 sentence summary of what this document is",
  "date": "string|null — document date in YYYY-MM-DD format if found",
  "year": "number|null — tax year or document year",
  "parties": ["string — names of people/entities involved"],
  "institution": "string|null — issuing organization (IRS, SSA, Schwab, court name, etc.)",
  "account_numbers": ["string — any account/EIN/case numbers found"],
  "jurisdiction": "string|null — state/county if applicable",
  "tags": ["string — relevant keywords for search"]
}

If a field cannot be determined, use null or empty array. Be precise with dates and numbers.`;

async function downloadFromR2(bucket, r2Key) {
  mkdirSync(TMP_DIR, { recursive: true });
  const safeFilename = r2Key.replace(/[^a-zA-Z0-9.-]/g, '_');
  const tmpPath = join(TMP_DIR, safeFilename);

  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    await pipeline(resp.Body, createWriteStream(tmpPath));
    return tmpPath;
  } catch (e) {
    console.error(`  Download failed: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

async function extractWithClaude(filePath, fileType, filename, existingMeta) {
  const context = `Filename: ${filename}
Original path: ${existingMeta.original_path || 'unknown'}
Current category: ${existingMeta.category || 'unknown'}
Current account_type: ${existingMeta.account_type || 'unknown'}
Current institution: ${existingMeta.institution || 'unknown'}`;

  let promptText;

  if (IMAGE_TYPES.includes(fileType) || fileType === 'pdf') {
    // For images and PDFs, use allowedTools to let Claude read the local file
    promptText = `${EXTRACTION_PROMPT}\n\nContext:\n${context}\n\nRead and analyze this file: ${filePath}`;
  } else {
    // Read text content for text-based files
    let textContent;
    try {
      textContent = readFileSync(filePath, 'utf-8').slice(0, 50000);
    } catch {
      textContent = `[Binary file: ${filename}, type: ${fileType}]`;
    }
    promptText = `${EXTRACTION_PROMPT}\n\nContext:\n${context}\n\nDocument content:\n${textContent}`;
  }

  // Write prompt to a temp file to avoid shell escaping issues
  const promptPath = join(TMP_DIR, `prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(promptPath, promptText);

  try {
    // Use Claude CLI --print mode
    // For PDFs/images, allow Read tool so Claude can read the local file
    const isPdfOrImage = IMAGE_TYPES.includes(fileType) || fileType === 'pdf';
    const allowTools = isPdfOrImage ? ' --allowedTools "Read"' : '';

    const { stdout } = await execAsync(
      `cat "${promptPath}" | claude --print --model sonnet${allowTools}`,
      { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
    );

    const text = stdout.trim();

    // Parse JSON from response
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error(`  JSON parse error: ${e.message}`);
      console.error(`  Raw response: ${text.slice(0, 200)}`);
    }

    return null;
  } finally {
    try { unlinkSync(promptPath); } catch {}
  }
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_type, category, account_type, institution, original_path } = doc;

  console.log(`Processing: ${filename} [${bucket}/${r2_key}]`);

  // Skip non-parseable types
  if (!PARSEABLE_TYPES.includes(file_type) && !IMAGE_TYPES.includes(file_type)) {
    console.log(`  Skipping: unsupported file type '${file_type}'`);
    return { id, skipped: true };
  }

  let tmpPath;
  try {
    // Download from R2
    tmpPath = await downloadFromR2(bucket, r2_key);
    if (!tmpPath) return { id, error: 'download failed' };

    // Extract with Claude CLI headless
    const metadata = await extractWithClaude(tmpPath, file_type, filename, { category, account_type, institution, original_path });

    if (!metadata) {
      console.log(`  No metadata extracted`);
      return { id, error: 'extraction failed' };
    }

    console.log(`  Extracted: ${metadata.title || 'untitled'} (${metadata.document_type})`);

    // Build Supabase update
    const updates = {};

    if (metadata.description) updates.description = metadata.description;
    if (metadata.date) updates.statement_date = metadata.date;
    if (metadata.year && !doc.year) updates.year = metadata.year;
    if (metadata.institution && (!doc.institution || doc.institution === '')) {
      updates.institution = metadata.institution.toLowerCase().replace(/\s+/g, '-');
    }

    // Store full extraction as metadata JSON
    updates.ai_metadata = JSON.stringify({
      document_type: metadata.document_type,
      title: metadata.title,
      description: metadata.description,
      parties: metadata.parties,
      account_numbers: metadata.account_numbers,
      jurisdiction: metadata.jurisdiction,
      tags: metadata.tags,
      extracted_at: new Date().toISOString(),
    });

    updates.updated_at = new Date().toISOString();

    if (!DRY_RUN) {
      const { error } = await supabase.from('document_index').update(updates).eq('id', id);
      if (error) console.error(`  Supabase update error: ${error.message}`);
    } else {
      console.log(`  [DRY-RUN] Would update:`, JSON.stringify(updates).slice(0, 200));
    }

    return { id, success: true, metadata };
  } catch (e) {
    console.error(`  Error processing ${filename}: ${e.message?.slice(0, 120)}`);
    return { id, error: e.message?.slice(0, 80) || 'unknown error' };
  } finally {
    // Cleanup temp file
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  console.log(`[START] Claude CLI Headless Metadata Extraction`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Limit: ${LIMIT} | Category: ${CATEGORY_FILTER || 'all'}\n`);

  // Verify Claude CLI is available
  try {
    const { stdout } = await execAsync('claude --version', { timeout: 10000 });
    console.log(`Claude CLI: ${stdout.trim()}`);
  } catch {
    console.error('ERROR: Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }

  // Query documents missing enriched metadata
  let query = supabase
    .from('document_index')
    .select('*')
    .is('ai_metadata', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (CATEGORY_FILTER) {
    query = query.eq('category', CATEGORY_FILTER);
  }

  // Filter to new categories only
  query = query.in('category', ['legal', 'tax-personal', 'investment', 'other']);

  const { data: docs, error } = await query;
  if (error) {
    console.error(`Query error: ${error.message}`);
    process.exit(1);
  }

  console.log(`Found ${docs.length} documents to process\n`);

  let success = 0, failed = 0, skipped = 0;

  // Process in batches of PARALLEL
  for (let i = 0; i < docs.length; i += PARALLEL) {
    const batch = docs.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map(d => processDocument(d)));

    for (const r of results) {
      if (r.skipped) skipped++;
      else if (r.success) success++;
      else failed++;
    }

    // Rate limit pause between batches
    if (i + PARALLEL < docs.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Extracted: ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Total:     ${docs.length}`);
}

main().catch(console.error);
