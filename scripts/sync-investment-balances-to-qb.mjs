#!/usr/bin/env node

/**
 * Sync Investment Balances to QuickBooks
 *
 * Monthly batch job that pushes aggregate investment account balances
 * from finleg's investment_statement_summaries into QB as JournalEntry
 * proposals on `qb_writeback_queue`. Also queues Deposit proposals for
 * dividend/interest/capital-gain transactions in the last 30 days.
 *
 * Entries are queued with status='proposed' — admin approval is required
 * before the qb-writeback edge function will execute them in QB.
 *
 * Usage:
 *   node scripts/sync-investment-balances-to-qb.mjs
 *   node scripts/sync-investment-balances-to-qb.mjs --dry-run
 *
 * Prerequisites:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 *   - QB OAuth tokens configured (used by qb-writeback edge function)
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
  help: `Queue investment balance updates + recent investment-income deposits in qb_writeback_queue.

Usage: node scripts/sync-investment-balances-to-qb.mjs [options]

Options:
  --dry-run      compute and print but don't insert any queue rows
  --verbose      enable debug logs
  --help         this text

Notes:
  Entries land with status='proposed' — admin approval is required before the
  qb-writeback edge function will execute them.
`,
});

const env = loadSupabaseEnv();
const supabase = createSupabaseClient({ env });
const log = createLogger({ verbose: args.verbose });

async function main() {
  log.info('Investment Balance → QB Sync');
  log.info(`Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);

  const { data: summaries, error: sumErr } = await supabase
    .from('investment_statement_summaries')
    .select('id, institution, account_name, account_holder, ending_value, statement_date')
    .order('statement_date', { ascending: false });

  if (sumErr) {
    throw new FatalError(`Failed to fetch investment summaries: ${sumErr.message}`, {
      cause: sumErr,
    });
  }

  if (!summaries?.length) {
    log.info('No investment statement summaries found.');
    return;
  }

  // Dedupe: keep only the most recent per (institution, account_name).
  const latestByAccount = new Map();
  for (const s of summaries) {
    const key = `${s.institution}|${s.account_name}`;
    if (!latestByAccount.has(key)) {
      latestByAccount.set(key, s);
    }
  }

  log.info(`Found ${latestByAccount.size} investment accounts with latest balances:`);

  let totalValue = 0;
  const entries = [];

  for (const summary of latestByAccount.values()) {
    const value = Number(summary.ending_value) || 0;
    totalValue += value;

    log.info(`  ${summary.institution} - ${summary.account_name}`);
    log.debug(`    Holder: ${summary.account_holder}`);
    log.debug(`    Balance: $${value.toLocaleString()}`);
    log.debug(`    As of: ${summary.statement_date}`);

    entries.push({
      institution: summary.institution,
      account_name: summary.account_name,
      account_holder: summary.account_holder,
      ending_value: value,
      statement_date: summary.statement_date,
    });
  }

  log.info(`Total portfolio value: $${totalValue.toLocaleString()}`);

  if (args.dryRun) {
    log.info('[dry-run] Would create QB writeback queue entries for each account.');
    log.info('         Each entry would create/update a Journal Entry in QB adjusting the');
    log.info('         investment account balance to match the latest statement value.');
    return;
  }

  let queued = 0;

  for (const entry of entries) {
    const description = `Investment balance update: ${entry.institution} ${entry.account_name} (${entry.account_holder}) as of ${entry.statement_date}`;

    const { data: existing } = await supabase
      .from('qb_writeback_queue')
      .select('id')
      .eq('qb_entity_type', 'JournalEntry')
      .eq('field_name', 'investment_balance')
      .ilike('reason', `%${entry.institution}%${entry.account_name}%`)
      .in('status', ['proposed', 'approved'])
      .limit(1);

    if (existing?.length) {
      log.info(`  Skipping ${entry.institution} ${entry.account_name} — already queued`);
      continue;
    }

    const { error: insertErr } = await supabase.from('qb_writeback_queue').insert({
      qb_entity_type: 'JournalEntry',
      qb_entity_id: 'new',
      field_name: 'investment_balance',
      old_value: null,
      new_value: JSON.stringify({
        amount: entry.ending_value,
        account_name: `${entry.institution} - ${entry.account_name}`,
        memo: description,
      }),
      reason: `Monthly balance update: ${entry.institution} ${entry.account_name} = $${entry.ending_value.toLocaleString()} as of ${entry.statement_date}`,
      status: 'proposed',
    });

    if (insertErr) {
      log.error(`  Failed to queue ${entry.institution} ${entry.account_name}: ${insertErr.message}`);
    } else {
      log.info(`  Queued: ${entry.institution} ${entry.account_name} = $${entry.ending_value.toLocaleString()}`);
      queued++;
    }
  }

  // Investment income (dividends, capital gains) in the last 30 days → Deposit proposals.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
  const { data: investmentIncome } = await supabase
    .from('investment_transactions')
    .select('id, institution, account_name, transaction_type, security_name, total_amount, trade_date')
    .in('transaction_type', ['Dividend', 'Interest', 'Capital Gain Distribution'])
    .gte('trade_date', thirtyDaysAgo);

  if (investmentIncome?.length) {
    log.info(`Found ${investmentIncome.length} investment income transactions in last 30 days:`);

    for (const income of investmentIncome) {
      log.debug(`  ${income.trade_date}: ${income.transaction_type} - ${income.security_name} $${income.total_amount}`);

      const { error: incErr } = await supabase.from('qb_writeback_queue').insert({
        qb_entity_type: 'Deposit',
        qb_entity_id: 'new',
        field_name: 'investment_income',
        old_value: null,
        new_value: JSON.stringify({
          amount: Number(income.total_amount),
          type: income.transaction_type,
          security: income.security_name,
          date: income.trade_date,
        }),
        reason: `${income.transaction_type}: ${income.security_name} $${income.total_amount} on ${income.trade_date}`,
        status: 'proposed',
      });

      if (!incErr) queued++;
    }
  }

  log.info(`Done. Queued ${queued} writeback entries for admin approval.`);
  log.info('Approve them in the UI, then run the qb-writeback edge function to execute.');
}

run(main);
