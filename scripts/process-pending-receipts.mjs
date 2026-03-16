#!/usr/bin/env node
/**
 * Process pending receipts using Claude CLI headless mode (claude --print).
 * Designed to run on Hostinger VPS via cron.
 *
 * Flow:
 *   1. Fetch receipts with status='pending' from Supabase
 *   2. Download each attachment
 *   3. Parse with `claude --print` (Claude Max plan, no API key needed)
 *   4. Update receipt with parsed data
 *   5. Try to match against QB transactions
 *   6. Log activity
 *
 * Usage: node scripts/process-pending-receipts.mjs
 * Cron:  */5 * * * * cd /root/finleg && node scripts/process-pending-receipts.mjs >> /var/log/receipt-processor.log 2>&1
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gjdvzzxsrzuorguwkaih.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function shiftDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function daysBetween(a, b) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

async function tryMatchTransaction(amount, date, vendor) {
  if (!amount || !date) return null;

  const { data: candidates } = await supabase
    .from('qb_transactions')
    .select('id, txn_date, amount, vendor_name, receipt_id')
    .is('receipt_id', null)
    .gte('txn_date', shiftDate(date, -5))
    .lte('txn_date', shiftDate(date, 5))
    .order('txn_date', { ascending: false });

  if (!candidates?.length) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const txn of candidates) {
    let score = 0;
    const txnAmount = Math.abs(parseFloat(txn.amount));
    const receiptAmount = Math.abs(amount);

    if (Math.abs(txnAmount - receiptAmount) < 0.01) {
      score += 0.6;
    } else if (Math.abs(txnAmount - receiptAmount) < 1.0) {
      score += 0.3;
    } else {
      continue;
    }

    const daysDiff = Math.abs(daysBetween(date, txn.txn_date));
    score += Math.max(0, 0.2 - daysDiff * 0.04);

    if (vendor && txn.vendor_name) {
      const vl = vendor.toLowerCase();
      const tl = txn.vendor_name.toLowerCase();
      if (tl.includes(vl) || vl.includes(tl)) score += 0.2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = txn;
    }
  }

  return bestMatch && bestScore >= 0.5
    ? { qb_txn_id: bestMatch.id, confidence: Math.round(bestScore * 100) / 100 }
    : null;
}

async function parseReceiptWithClaude(attachmentUrl, contentType, emailSubject) {
  const tmpFile = join(tmpdir(), `receipt_${Date.now()}`);
  const ext = contentType.includes('pdf') ? '.pdf'
    : contentType.includes('png') ? '.png'
    : '.jpg';
  const filePath = tmpFile + ext;

  try {
    // Download the attachment
    const res = await fetch(attachmentUrl);
    if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filePath, buffer);

    const prompt = `Parse this receipt/invoice image and extract the following as JSON. Return ONLY valid JSON, no markdown, no explanation:
{
  "vendor": "store/company name",
  "amount": 0.00,
  "date": "YYYY-MM-DD",
  "category": "best category guess",
  "tax": 0.00,
  "payment_method": "card type or last 4 digits if visible",
  "line_items": [{"description": "item", "amount": 0.00, "quantity": 1}],
  "confidence": 0.95
}

Email subject was: "${emailSubject || '(none)'}"
If the subject contains a category hint, use that as the category.
Categories: Office Supplies, Meals & Entertainment, Software & Subscriptions, Travel & Transport, Auto & Gas, Professional Services, Utilities & Telecom, Insurance, Medical & Health, Groceries, Shopping, Advertising, Education, Rent & Facilities, Equipment, Shipping, Taxes & Licenses, Other.`;

    // Use claude --print with the file attachment
    const result = execSync(
      `claude --print --allowedTools '' "${prompt}" --file "${filePath}"`,
      { encoding: 'utf-8', timeout: 60000, maxBuffer: 1024 * 1024 }
    );

    // Extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    return JSON.parse(jsonMatch[0]);
  } finally {
    if (existsSync(filePath)) unlinkSync(filePath);
  }
}

async function processReceipt(receipt) {
  console.log(`Processing receipt ${receipt.id} (${receipt.attachment_filename})...`);

  try {
    const parsed = await parseReceiptWithClaude(
      receipt.attachment_url,
      receipt.attachment_content_type,
      receipt.email_subject
    );

    // Use user-provided category if available, otherwise AI
    const category = receipt.user_category || parsed.category || null;

    // Update receipt with parsed data
    await supabase
      .from('receipts')
      .update({
        parsed_vendor: parsed.vendor || null,
        parsed_amount: parsed.amount || null,
        parsed_date: parsed.date || null,
        parsed_category: category,
        parsed_line_items: parsed.line_items || null,
        parsed_tax: parsed.tax || null,
        parsed_payment_method: parsed.payment_method || null,
        ai_confidence: parsed.confidence || 0,
        ai_raw_response: parsed,
        status: 'parsed',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receipt.id);

    // Try to match with a QB transaction
    if (parsed.amount && parsed.date) {
      const match = await tryMatchTransaction(parsed.amount, parsed.date, parsed.vendor);

      if (match) {
        await supabase
          .from('receipts')
          .update({
            matched_qb_txn_id: match.qb_txn_id,
            match_confidence: match.confidence,
            match_method: match.confidence >= 0.8 ? 'exact_amount' : 'fuzzy',
            status: 'matched',
          })
          .eq('id', receipt.id);

        await supabase
          .from('qb_transactions')
          .update({
            receipt_id: receipt.id,
            our_category: category,
            category_confidence: parsed.confidence,
            category_source: receipt.user_category ? 'human' : 'ai',
            review_status: match.confidence >= 0.8 ? 'auto_categorized' : 'needs_review',
          })
          .eq('id', match.qb_txn_id);

        await supabase.from('bookkeeping_activity_log').insert({
          action: 'receipt_matched',
          entity_type: 'receipt',
          entity_id: receipt.id,
          actor: 'ai',
          details: { qb_txn_id: match.qb_txn_id, confidence: match.confidence, amount: parsed.amount, vendor: parsed.vendor },
        });

        console.log(`  Matched to QB txn ${match.qb_txn_id} (confidence: ${match.confidence})`);
      }
    }

    await supabase.from('bookkeeping_activity_log').insert({
      action: 'receipt_parsed',
      entity_type: 'receipt',
      entity_id: receipt.id,
      actor: 'ai',
      details: { vendor: parsed.vendor, amount: parsed.amount, confidence: parsed.confidence, category },
    });

    console.log(`  Parsed: ${parsed.vendor} $${parsed.amount} (${category})`);
  } catch (err) {
    console.error(`  Error processing receipt ${receipt.id}:`, err.message);

    await supabase
      .from('receipts')
      .update({
        status: 'error',
        error_message: err.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receipt.id);
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for pending receipts...`);

  const { data: pending, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('Error fetching pending receipts:', error);
    process.exit(1);
  }

  if (!pending?.length) {
    console.log('No pending receipts.');
    return;
  }

  console.log(`Found ${pending.length} pending receipt(s)`);

  for (const receipt of pending) {
    await processReceipt(receipt);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
