#!/usr/bin/env node

/**
 * Compute AI Metrics — Weekly accuracy computation
 *
 * Calculates how well AI categorization is performing by comparing
 * AI-assigned categories against human corrections.
 *
 * Usage:
 *   node scripts/compute-ai-metrics.mjs
 *   node scripts/compute-ai-metrics.mjs --period 2026-03-01 2026-03-15
 *
 * Prerequisites:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://gjdvzzxsrzuorguwkaih.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const periodIdx = args.indexOf("--period");

let periodStart, periodEnd;
if (periodIdx >= 0 && args[periodIdx + 1] && args[periodIdx + 2]) {
  periodStart = args[periodIdx + 1];
  periodEnd = args[periodIdx + 2];
} else {
  // Default: last 7 days
  periodEnd = new Date().toISOString().split("T")[0];
  periodStart = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
}

async function main() {
  console.log(`Computing AI metrics for ${periodStart} to ${periodEnd}\n`);

  // Fetch all AI-categorized transactions in the period
  const { data: aiCategorized, error: err1 } = await supabase
    .from("qb_transactions")
    .select("id, our_category, category_confidence, review_status, reviewed_by")
    .eq("category_source", "ai")
    .gte("updated_at", `${periodStart}T00:00:00Z`)
    .lte("updated_at", `${periodEnd}T23:59:59Z`);

  if (err1) {
    console.error("Failed to fetch AI categorized transactions:", err1.message);
    process.exit(1);
  }

  const total = aiCategorized?.length || 0;
  if (total === 0) {
    console.log("No AI-categorized transactions in this period.");
    return;
  }

  // Count approved (human agreed) vs overridden (human changed category)
  let approved = 0;
  let overridden = 0;
  let stillPending = 0;
  let totalConfidence = 0;

  for (const txn of aiCategorized) {
    totalConfidence += Number(txn.category_confidence) || 0;

    if (txn.review_status === "approved") {
      approved++;
    } else if (txn.review_status === "auto_categorized" || txn.review_status === "pending") {
      stillPending++;
    } else {
      // If category_source is still 'ai' but reviewed_by is human, it was overridden
      // Actually, if human overrides, category_source changes to 'human'
      // So any remaining are still auto_categorized
      stillPending++;
    }
  }

  // Also check for transactions that WERE ai-categorized but then human-overridden
  // These will have category_source='human' now, so we need the activity log
  const { data: overrides } = await supabase
    .from("bookkeeping_activity_log")
    .select("details")
    .eq("action", "manual_categorized")
    .gte("created_at", `${periodStart}T00:00:00Z`)
    .lte("created_at", `${periodEnd}T23:59:59Z`);

  if (overrides) {
    for (const log of overrides) {
      if (log.details?.previous_source === "ai") {
        overridden++;
      }
    }
  }

  // Count new rules created in this period
  const { count: newRules } = await supabase
    .from("category_rules")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${periodStart}T00:00:00Z`)
    .lte("created_at", `${periodEnd}T23:59:59Z`);

  // Count rules deactivated
  const { count: deactivated } = await supabase
    .from("category_rules")
    .select("id", { count: "exact", head: true })
    .eq("is_active", false)
    .gte("updated_at", `${periodStart}T00:00:00Z`)
    .lte("updated_at", `${periodEnd}T23:59:59Z`);

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

  console.log("Metrics:");
  console.log(`  Total AI categorized: ${total}`);
  console.log(`  Human approved: ${approved}`);
  console.log(`  Human overridden: ${overridden}`);
  console.log(`  Still pending: ${stillPending}`);
  console.log(`  Accuracy: ${accuracyPct !== null ? `${accuracyPct}%` : "N/A (no reviews yet)"}`);
  console.log(`  Avg confidence: ${avgConfidence}`);
  console.log(`  New rules created: ${newRules || 0}`);
  console.log(`  Rules deactivated: ${deactivated || 0}`);

  // Upsert metrics
  const { error: upsertErr } = await supabase
    .from("ai_metrics")
    .upsert(metrics, { onConflict: "period_start,period_end" });

  if (upsertErr) {
    console.error("\nFailed to save metrics:", upsertErr.message);
  } else {
    console.log("\nMetrics saved to ai_metrics table.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
