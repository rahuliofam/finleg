#!/usr/bin/env node

/**
 * Compute AI Metrics — Weekly accuracy computation
 *
 * Calculates how well AI categorization is performing by comparing
 * AI-assigned categories against human corrections, then upserts the
 * resulting row into `ai_metrics` (keyed by period_start + period_end).
 *
 * Usage:
 *   node scripts/compute-ai-metrics.mjs                          # last 7 days
 *   node scripts/compute-ai-metrics.mjs --period 2026-03-01 2026-03-15
 *   node scripts/compute-ai-metrics.mjs --dry-run --verbose
 *
 * Prerequisites:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 */

import {
  loadSupabaseEnv,
  createSupabaseClient,
  createLogger,
  parseArgs,
  run,
  FatalError,
} from './lib/index.mjs';

const args = parseArgs(process.argv.slice(2), {
  help: `Compute weekly AI categorization metrics and upsert into ai_metrics.

Usage: node scripts/compute-ai-metrics.mjs [options]

Options:
  --period S E   ISO dates (YYYY-MM-DD) for explicit window; default = last 7 days
  --dry-run      compute and print metrics but don't upsert
  --verbose      enable debug logs
  --help         this text
`,
});

const env = loadSupabaseEnv();
const supabase = createSupabaseClient({ env });
const log = createLogger({ verbose: args.verbose });

function resolvePeriod(positional) {
  // Support either positional `--period S E` (legacy) or two positional args
  // after `--period`. parseArgs hands `--period` to the unknown list and the
  // dates land in `_` since they don't start with `-`.
  if (positional.length >= 2) {
    return { start: positional[0], end: positional[1] };
  }
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];
  return { start, end };
}

async function main() {
  // Backward-compat: scripts were called as `--period S E` before the harness.
  // parseArgs treats `--period` as unknown; the dates show up as positional.
  const periodIdx = process.argv.indexOf('--period');
  let periodStart, periodEnd;
  if (periodIdx >= 0 && process.argv[periodIdx + 1] && process.argv[periodIdx + 2]) {
    periodStart = process.argv[periodIdx + 1];
    periodEnd = process.argv[periodIdx + 2];
  } else {
    const p = resolvePeriod(args._);
    periodStart = p.start;
    periodEnd = p.end;
  }

  log.info(`Computing AI metrics for ${periodStart} to ${periodEnd}`);

  const { data: aiCategorized, error: err1 } = await supabase
    .from('qb_transactions')
    .select('id, our_category, category_confidence, review_status, reviewed_by')
    .eq('category_source', 'ai')
    .gte('updated_at', `${periodStart}T00:00:00Z`)
    .lte('updated_at', `${periodEnd}T23:59:59Z`);

  if (err1) {
    throw new FatalError(`Failed to fetch AI categorized transactions: ${err1.message}`, {
      cause: err1,
    });
  }

  const total = aiCategorized?.length || 0;
  if (total === 0) {
    log.info('No AI-categorized transactions in this period.');
    return;
  }

  let approved = 0;
  let overridden = 0;
  let stillPending = 0;
  let totalConfidence = 0;

  for (const txn of aiCategorized) {
    totalConfidence += Number(txn.category_confidence) || 0;

    if (txn.review_status === 'approved') {
      approved++;
    } else {
      // 'auto_categorized', 'pending', or anything else we haven't reviewed
      stillPending++;
    }
  }

  // Human overrides change category_source to 'human', so we infer them from the
  // activity log rather than the qb_transactions rows above.
  const { data: overrides } = await supabase
    .from('bookkeeping_activity_log')
    .select('details')
    .eq('action', 'manual_categorized')
    .gte('created_at', `${periodStart}T00:00:00Z`)
    .lte('created_at', `${periodEnd}T23:59:59Z`);

  if (overrides) {
    for (const logRow of overrides) {
      if (logRow.details?.previous_source === 'ai') {
        overridden++;
      }
    }
  }

  const { count: newRules } = await supabase
    .from('category_rules')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${periodStart}T00:00:00Z`)
    .lte('created_at', `${periodEnd}T23:59:59Z`);

  const { count: deactivated } = await supabase
    .from('category_rules')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', false)
    .gte('updated_at', `${periodStart}T00:00:00Z`)
    .lte('updated_at', `${periodEnd}T23:59:59Z`);

  const reviewed = approved + overridden;
  const accuracyPct = reviewed > 0 ? Math.round((approved / reviewed) * 100 * 100) / 100 : null;
  const avgConfidence = total > 0 ? Math.round((totalConfidence / total) * 100) / 100 : null;

  const metrics = {
    period_start: periodStart,
    period_end: periodEnd,
    total_ai_categorized: total,
    human_approved: approved,
    human_overridden: overridden,
    accuracy_pct: accuracyPct,
    avg_confidence: avgConfidence,
    new_rules_created: newRules || 0,
    rules_deactivated: deactivated || 0,
  };

  log.info('Metrics:');
  log.info(`  Total AI categorized: ${total}`);
  log.info(`  Human approved: ${approved}`);
  log.info(`  Human overridden: ${overridden}`);
  log.info(`  Still pending: ${stillPending}`);
  log.info(`  Accuracy: ${accuracyPct !== null ? `${accuracyPct}%` : 'N/A (no reviews yet)'}`);
  log.info(`  Avg confidence: ${avgConfidence}`);
  log.info(`  New rules created: ${newRules || 0}`);
  log.info(`  Rules deactivated: ${deactivated || 0}`);

  if (args.dryRun) {
    log.info('[dry-run] skipping upsert into ai_metrics');
    return;
  }

  const { error: upsertErr } = await supabase
    .from('ai_metrics')
    .upsert(metrics, { onConflict: 'period_start,period_end' });

  if (upsertErr) {
    throw new FatalError(`Failed to save metrics: ${upsertErr.message}`, { cause: upsertErr });
  }
  log.info('Metrics saved to ai_metrics table.');
}

run(main);
