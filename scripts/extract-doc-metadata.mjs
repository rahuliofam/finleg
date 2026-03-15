#!/usr/bin/env node
/**
 * Extract rich metadata from documents using Claude API (Sonnet 4.6).
 * Designed to run on Hostinger VPS or any server with ANTHROPIC_API_KEY set.
 *
 * Reads documents from Cloudflare R2, sends to Claude for parsing,
 * and updates Supabase document_index with extracted metadata.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/extract-doc-metadata.mjs [--dry-run] [--limit=N] [--category=legal]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required (uses Claude Sonnet 4.6 for document parsing)
 *
 * The script:
 *   1. Queries Supabase for documents missing enriched metadata (description IS NULL)
 *   2. Downloads each file from R2
 *   3. Sends to Claude Sonnet 4.6 with a structured extraction prompt
 *   4. Updates Supabase with extracted fields
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Config ──
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ERROR: Set ANTHROPIC_API_KEY environment variable');
  process.exit(1);
}

const SUPABASE_URL = 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZHZ6enhzcnp1b3JndXdrYWloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQzMTk1NywiZXhwIjoyMDg5MDA3OTU3fQ.iYlTfc9IhMpOphSLUjBCTEto2Mq_1dD1-gVIEo4LUrc';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 999;
const CATEGORY_FILTER = process.argv.find(a => a.startsWith('--category='))?.split('=')[1] || null;
const PARALLEL = 3; // concurrent Claude API calls (rate limit friendly)
const TMP_DIR = '/tmp/doc-extract';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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
    const cmd = `wrangler r2 object get '${bucket}/${r2Key}' --file='${tmpPath}' --remote`;
    await execAsync(cmd, { timeout: 60000 });
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

  let content;

  if (IMAGE_TYPES.includes(fileType)) {
    // Send as image
    const imageData = readFileSync(filePath);
    const base64 = imageData.toString('base64');
    const mediaType = fileType === 'png' ? 'image/png' : 'image/jpeg';

    content = [
      { type: 'text', text: `${EXTRACTION_PROMPT}\n\nContext:\n${context}` },
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
    ];
  } else if (fileType === 'pdf') {
    // Send as PDF document
    const pdfData = readFileSync(filePath);
    const base64 = pdfData.toString('base64');

    content = [
      { type: 'text', text: `${EXTRACTION_PROMPT}\n\nContext:\n${context}` },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
    ];
  } else {
    // Read as text for docx/txt/csv/xml
    let textContent;
    try {
      textContent = readFileSync(filePath, 'utf-8').slice(0, 50000); // limit to 50k chars
    } catch {
      textContent = `[Binary file: ${filename}, type: ${fileType}]`;
    }

    content = [
      { type: 'text', text: `${EXTRACTION_PROMPT}\n\nContext:\n${context}\n\nDocument content:\n${textContent}` },
    ];
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0]?.text || '';

  // Parse JSON from response
  try {
    // Try to extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error(`  JSON parse error: ${e.message}`);
    console.error(`  Raw response: ${text.slice(0, 200)}`);
  }

  return null;
}

async function processDocument(doc) {
  const { id, bucket, r2_key, filename, file_type, category, account_type, institution, original_path } = doc;

  console.log(`Processing: ${filename} [${bucket}/${r2_key}]`);

  // Skip non-parseable types
  if (!PARSEABLE_TYPES.includes(file_type) && !IMAGE_TYPES.includes(file_type)) {
    console.log(`  Skipping: unsupported file type '${file_type}'`);
    return { id, skipped: true };
  }

  // Download from R2
  const tmpPath = await downloadFromR2(bucket, r2_key);
  if (!tmpPath) return { id, error: 'download failed' };

  try {
    // Extract with Claude
    const metadata = await extractWithClaude(tmpPath, file_type, filename, { category, account_type, institution, original_path });

    if (!metadata) {
      console.log(`  No metadata extracted`);
      return { id, error: 'extraction failed' };
    }

    console.log(`  Extracted: ${metadata.title || 'untitled'} (${metadata.document_type})`);

    // Build Supabase update
    const updates = {};

    // Update description (new column — will add via migration)
    // For now, store enriched data in a JSON-friendly way
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
  } finally {
    // Cleanup temp file
    try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  console.log(`[START] Claude Metadata Extraction`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | Limit: ${LIMIT} | Category: ${CATEGORY_FILTER || 'all'}\n`);

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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Extracted: ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Total:     ${docs.length}`);
}

main().catch(console.error);
