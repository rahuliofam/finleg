#!/usr/bin/env node

/**
 * AI Categorization Batch Job
 *
 * Runs on Hostinger VPS using Claude CLI headless mode (claude --print).
 * Fetches uncategorized QB transactions and uses AI to assign categories.
 *
 * Usage:
 *   node scripts/ai-categorize-batch.mjs
 *   node scripts/ai-categorize-batch.mjs --dry-run
 *   node scripts/ai-categorize-batch.mjs --limit 10
 *   node scripts/ai-categorize-batch.mjs --verbose
 *
 * Prerequisites:
 *   - Claude CLI installed: npm i -g @anthropic-ai/claude-code
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 */

import { execSync } from 'child_process';
import {
  loadSupabaseEnv,
  createSupabaseClient,
  createLogger,
  parseArgs,
  run,
  ValidationError,
} from './lib/index.mjs';

const env = loadSupabaseEnv();
const supabase = createSupabaseClient({ env });

const args = parseArgs(process.argv.slice(2), {
  numbers: { limit: 50 },
  help: `AI Categorization Batch Job

Usage: node scripts/ai-categorize-batch.mjs [options]

Options:
  --dry-run        parse but don't update
  --limit N        max transactions to process (default 50)
  --verbose        show debug logs
  --help           this text
`,
});

const log = createLogger({ verbose: args.verbose });

// Categories matching the UI categorize tab
const CATEGORIES = [
  'Groceries & Food',
  'Dining & Restaurants',
  'Gas & Auto',
  'Home & Utilities',
  'Shopping & Retail',
  'Healthcare & Pharmacy',
  'Entertainment & Leisure',
  'Travel & Transportation',
  'Insurance',
  'Subscriptions & Services',
  'Charitable Donations',
  'Education',
  'Professional Services',
  'Office & Business',
  'Personal Care',
  'Pets',
  'Gifts',
  'Transfer',
  'Investment',
  'Other',
];

async function main() {
  log.info(`AI Categorization Batch Job`);
  log.info(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  log.info(`Batch limit: ${args.limit}\n`);

  // 1. Fetch uncategorized transactions
  const { data: pending, error: fetchErr } = await supabase
    .from('qb_transactions')
    .select('id, qb_id, vendor_name, description, memo, amount, txn_date, qb_category_name, qb_account_name')
    .eq('review_status', 'pending')
    .eq('is_deleted', false)
    .order('txn_date', { ascending: false })
    .limit(args.limit);

  if (fetchErr) {
    throw new ValidationError(`Failed to fetch pending transactions: ${fetchErr.message}`);
  }

  if (!pending?.length) {
    log.info('No pending transactions to categorize.');
    return;
  }

  log.info(`Found ${pending.length} pending transactions\n`);

  // 2. Fetch recent human-approved categorizations for few-shot examples
  const { data: examples } = await supabase
    .from('qb_transactions')
    .select('vendor_name, our_category, amount, description')
    .eq('review_status', 'approved')
    .eq('category_source', 'human')
    .order('reviewed_at', { ascending: false })
    .limit(100);

  const examplesByVendor = new Map();
  for (const ex of examples || []) {
    if (!ex.vendor_name) continue;
    const key = ex.vendor_name.toLowerCase();
    if (!examplesByVendor.has(key)) examplesByVendor.set(key, []);
    examplesByVendor.get(key).push(ex);
  }

  // 3. Group by vendor for efficiency
  const vendorGroups = new Map();
  for (const txn of pending) {
    const vendor = txn.vendor_name || 'Unknown';
    if (!vendorGroups.has(vendor)) vendorGroups.set(vendor, []);
    vendorGroups.get(vendor).push(txn);
  }

  log.info(`Grouped into ${vendorGroups.size} vendor groups\n`);

  let totalCategorized = 0;
  let totalErrors = 0;

  // 4. Process each vendor group
  for (const [vendor, txns] of vendorGroups) {
    log.info(`Processing: ${vendor} (${txns.length} transactions)`);

    // Build few-shot examples for this vendor
    const vendorExamples = examplesByVendor.get(vendor.toLowerCase()) || [];
    const fewShot = vendorExamples.slice(0, 5).map(
      (ex) => `  - "${ex.vendor_name}" $${ex.amount}: ${ex.our_category}`
    ).join('\n');

    // Build transaction list
    const txnList = txns.map(
      (t) => `  - ID: ${t.id}, Amount: $${t.amount}, Date: ${t.txn_date}, Description: "${t.description || ''}", Memo: "${t.memo || ''}", QB Category: "${t.qb_category_name || 'none'}", Account: "${t.qb_account_name || ''}"`
    ).join('\n');

    const prompt = `You are categorizing financial transactions for a family's personal finances.

Available categories:
${CATEGORIES.map((c) => `- ${c}`).join('\n')}

${fewShot ? `Previous human-approved categorizations for this vendor:\n${fewShot}\n` : ''}
Vendor: "${vendor}"
Transactions to categorize:
${txnList}

For each transaction, respond with ONLY a JSON array. Each element must have:
- "id": the transaction ID
- "category": one of the categories above
- "confidence": a number 0.0-1.0 indicating your confidence

Respond with ONLY the JSON array, no other text.`;

    try {
      // Use Claude CLI headless mode
      const result = execSync(
        `claude --print "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
        { encoding: 'utf-8', timeout: 60000, maxBuffer: 1024 * 1024 }
      );

      // Parse JSON from Claude's response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        log.warn(`  Failed to parse JSON for vendor ${vendor}`);
        totalErrors += txns.length;
        continue;
      }

      const categorizations = JSON.parse(jsonMatch[0]);

      for (const cat of categorizations) {
        if (!cat.id || !cat.category || !CATEGORIES.includes(cat.category)) {
          log.warn(`  Skipping invalid categorization: ${JSON.stringify(cat)}`);
          totalErrors++;
          continue;
        }

        const confidence = Math.min(1.0, Math.max(0.0, Number(cat.confidence) || 0.5));

        if (args.dryRun) {
          log.info(`  [DRY RUN] ${cat.id}: ${cat.category} (${(confidence * 100).toFixed(0)}%)`);
        } else {
          const { error: updateErr } = await supabase
            .from('qb_transactions')
            .update({
              our_category: cat.category,
              category_confidence: confidence,
              category_source: 'ai',
              review_status: 'auto_categorized',
              updated_at: new Date().toISOString(),
            })
            .eq('id', cat.id);

          if (updateErr) {
            log.error(`  Failed to update ${cat.id}: ${updateErr.message}`);
            totalErrors++;
          } else {
            log.info(`  ${cat.id}: ${cat.category} (${(confidence * 100).toFixed(0)}%)`);
            totalCategorized++;
          }
        }
      }
    } catch (err) {
      log.error(`  Claude CLI error for vendor ${vendor}: ${err.message?.slice(0, 200)}`);
      totalErrors += txns.length;
    }
  }

  // 5. Log activity
  if (!args.dryRun && totalCategorized > 0) {
    await supabase.from('bookkeeping_activity_log').insert({
      action: 'auto_categorized',
      entity_type: 'qb_transaction',
      actor: 'ai',
      details: {
        batch_size: pending.length,
        categorized: totalCategorized,
        errors: totalErrors,
        method: 'claude_cli_batch',
      },
    });
  }

  log.info(`\nDone. Categorized: ${totalCategorized}, Errors: ${totalErrors}`);
}

run(main);
