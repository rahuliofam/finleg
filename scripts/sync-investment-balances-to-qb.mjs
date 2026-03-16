#!/usr/bin/env node

/**
 * Sync Investment Balances to QuickBooks
 *
 * Monthly batch job that pushes aggregate investment account balances
 * from finleg's investment_statement_summaries into QB as journal entries.
 * This keeps QB's balance sheet accurate without making QB track positions.
 *
 * Usage:
 *   node scripts/sync-investment-balances-to-qb.mjs
 *   node scripts/sync-investment-balances-to-qb.mjs --dry-run
 *
 * Prerequisites:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 *   - QB OAuth tokens configured
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://gjdvzzxsrzuorguwkaih.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`Investment Balance → QB Sync`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  // 1. Get latest investment statement summaries (most recent per account)
  const { data: summaries, error: sumErr } = await supabase
    .from("investment_statement_summaries")
    .select("id, institution, account_name, account_holder, ending_value, statement_date")
    .order("statement_date", { ascending: false });

  if (sumErr) {
    console.error("Failed to fetch investment summaries:", sumErr.message);
    process.exit(1);
  }

  if (!summaries?.length) {
    console.log("No investment statement summaries found.");
    return;
  }

  // Dedupe: keep only the most recent per account
  const latestByAccount = new Map();
  for (const s of summaries) {
    const key = `${s.institution}|${s.account_name}`;
    if (!latestByAccount.has(key)) {
      latestByAccount.set(key, s);
    }
  }

  console.log(`Found ${latestByAccount.size} investment accounts with latest balances:\n`);

  let totalValue = 0;
  const entries = [];

  for (const [key, summary] of latestByAccount) {
    const value = Number(summary.ending_value) || 0;
    totalValue += value;

    console.log(`  ${summary.institution} - ${summary.account_name}`);
    console.log(`    Holder: ${summary.account_holder}`);
    console.log(`    Balance: $${value.toLocaleString()}`);
    console.log(`    As of: ${summary.statement_date}\n`);

    entries.push({
      institution: summary.institution,
      account_name: summary.account_name,
      account_holder: summary.account_holder,
      ending_value: value,
      statement_date: summary.statement_date,
    });
  }

  console.log(`\nTotal portfolio value: $${totalValue.toLocaleString()}\n`);

  if (dryRun) {
    console.log("[DRY RUN] Would create QB writeback queue entries for each account.");
    console.log("Each entry would create/update a Journal Entry in QB adjusting the");
    console.log("investment account balance to match the latest statement value.");
    return;
  }

  // 2. Create writeback queue entries
  // Each investment account gets a journal entry that adjusts its balance
  // The QB account for investments should be an "Other Asset" type account
  let queued = 0;

  for (const entry of entries) {
    const description = `Investment balance update: ${entry.institution} ${entry.account_name} (${entry.account_holder}) as of ${entry.statement_date}`;

    // Check if there's already a pending/approved entry for this account
    const { data: existing } = await supabase
      .from("qb_writeback_queue")
      .select("id")
      .eq("qb_entity_type", "JournalEntry")
      .eq("field_name", "investment_balance")
      .ilike("reason", `%${entry.institution}%${entry.account_name}%`)
      .in("status", ["proposed", "approved"])
      .limit(1);

    if (existing?.length) {
      console.log(`  Skipping ${entry.institution} ${entry.account_name} — already queued`);
      continue;
    }

    const { error: insertErr } = await supabase.from("qb_writeback_queue").insert({
      qb_entity_type: "JournalEntry",
      qb_entity_id: "new", // Will create new JE
      field_name: "investment_balance",
      old_value: null,
      new_value: JSON.stringify({
        amount: entry.ending_value,
        account_name: `${entry.institution} - ${entry.account_name}`,
        memo: description,
      }),
      reason: `Monthly balance update: ${entry.institution} ${entry.account_name} = $${entry.ending_value.toLocaleString()} as of ${entry.statement_date}`,
      status: "proposed", // Needs admin approval before executing
    });

    if (insertErr) {
      console.error(`  Failed to queue ${entry.institution} ${entry.account_name}:`, insertErr.message);
    } else {
      console.log(`  Queued: ${entry.institution} ${entry.account_name} = $${entry.ending_value.toLocaleString()}`);
      queued++;
    }
  }

  // 3. Also detect investment income (dividends, capital gains) for QB
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const { data: investmentIncome } = await supabase
    .from("investment_transactions")
    .select("id, institution, account_name, transaction_type, security_name, total_amount, trade_date")
    .in("transaction_type", ["Dividend", "Interest", "Capital Gain Distribution"])
    .gte("trade_date", thirtyDaysAgo);

  if (investmentIncome?.length) {
    console.log(`\nFound ${investmentIncome.length} investment income transactions in last 30 days:`);

    for (const income of investmentIncome) {
      console.log(`  ${income.trade_date}: ${income.transaction_type} - ${income.security_name} $${income.total_amount}`);

      const { error: incErr } = await supabase.from("qb_writeback_queue").insert({
        qb_entity_type: "Deposit",
        qb_entity_id: "new",
        field_name: "investment_income",
        old_value: null,
        new_value: JSON.stringify({
          amount: Number(income.total_amount),
          type: income.transaction_type,
          security: income.security_name,
          date: income.trade_date,
        }),
        reason: `${income.transaction_type}: ${income.security_name} $${income.total_amount} on ${income.trade_date}`,
        status: "proposed",
      });

      if (!incErr) queued++;
    }
  }

  console.log(`\nDone. Queued ${queued} writeback entries for admin approval.`);
  console.log(`Approve them in the UI, then run the qb-writeback edge function to execute.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
