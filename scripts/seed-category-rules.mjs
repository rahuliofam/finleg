#!/usr/bin/env node
/**
 * Seed category_rules table with common vendor patterns.
 * Safe to re-run — skips existing patterns.
 *
 * Usage: node scripts/seed-category-rules.mjs [--dry-run] [--verbose]
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
  help: `Seed common vendor → category rules into category_rules. Idempotent.

Usage: node scripts/seed-category-rules.mjs [options]

Options:
  --dry-run      compute the diff but don't insert any rows
  --verbose      enable debug logs
  --help         this text
`,
});

const env = loadSupabaseEnv();
const supabase = createSupabaseClient({ env });
const log = createLogger({ verbose: args.verbose });

const RULES = [
  // Office & Software
  { match_pattern: 'amazon', match_type: 'contains', category: 'Office Supplies', priority: 5 },
  { match_pattern: 'staples', match_type: 'contains', category: 'Office Supplies', priority: 10 },
  { match_pattern: 'office depot', match_type: 'contains', category: 'Office Supplies', priority: 10 },
  { match_pattern: 'google', match_type: 'starts_with', category: 'Software & Subscriptions', priority: 5 },
  { match_pattern: 'microsoft', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'adobe', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'dropbox', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'slack', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'zoom', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'aws', match_type: 'starts_with', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'cloudflare', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'heroku', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'vercel', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'github', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'openai', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },
  { match_pattern: 'anthropic', match_type: 'contains', category: 'Software & Subscriptions', priority: 10 },

  // Meals & Entertainment
  { match_pattern: 'doordash', match_type: 'contains', category: 'Meals & Entertainment', priority: 10 },
  { match_pattern: 'grubhub', match_type: 'contains', category: 'Meals & Entertainment', priority: 10 },
  { match_pattern: 'uber eats', match_type: 'contains', category: 'Meals & Entertainment', priority: 10 },
  { match_pattern: 'starbucks', match_type: 'contains', category: 'Meals & Entertainment', priority: 10 },
  { match_pattern: 'chipotle', match_type: 'contains', category: 'Meals & Entertainment', priority: 10 },
  { match_pattern: 'restaurant', match_type: 'contains', category: 'Meals & Entertainment', priority: 5 },
  { match_pattern: 'cafe', match_type: 'contains', category: 'Meals & Entertainment', priority: 3 },

  // Travel & Transport
  { match_pattern: 'uber', match_type: 'starts_with', category: 'Travel & Transport', priority: 8 },
  { match_pattern: 'lyft', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'united airlines', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'delta air', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'southwest', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'american air', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'marriott', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'hilton', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'airbnb', match_type: 'contains', category: 'Travel & Transport', priority: 10 },
  { match_pattern: 'parking', match_type: 'contains', category: 'Travel & Transport', priority: 5 },
  { match_pattern: 'shell', match_type: 'starts_with', category: 'Auto & Gas', priority: 10 },
  { match_pattern: 'chevron', match_type: 'contains', category: 'Auto & Gas', priority: 10 },
  { match_pattern: 'exxon', match_type: 'contains', category: 'Auto & Gas', priority: 10 },
  { match_pattern: 'bp ', match_type: 'starts_with', category: 'Auto & Gas', priority: 10 },

  // Utilities
  { match_pattern: 'at&t', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },
  { match_pattern: 'verizon', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },
  { match_pattern: 't-mobile', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },
  { match_pattern: 'comcast', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },
  { match_pattern: 'spectrum', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },
  { match_pattern: 'pg&e', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },
  { match_pattern: 'edison', match_type: 'contains', category: 'Utilities & Telecom', priority: 10 },

  // Professional Services
  { match_pattern: 'law office', match_type: 'contains', category: 'Professional Services', priority: 10 },
  { match_pattern: 'attorney', match_type: 'contains', category: 'Professional Services', priority: 10 },
  { match_pattern: 'cpa', match_type: 'contains', category: 'Professional Services', priority: 8 },
  { match_pattern: 'accounting', match_type: 'contains', category: 'Professional Services', priority: 5 },
  { match_pattern: 'consulting', match_type: 'contains', category: 'Professional Services', priority: 5 },

  // Insurance
  { match_pattern: 'state farm', match_type: 'contains', category: 'Insurance', priority: 10 },
  { match_pattern: 'geico', match_type: 'contains', category: 'Insurance', priority: 10 },
  { match_pattern: 'allstate', match_type: 'contains', category: 'Insurance', priority: 10 },
  { match_pattern: 'progressive', match_type: 'contains', category: 'Insurance', priority: 10 },
  { match_pattern: 'insurance', match_type: 'contains', category: 'Insurance', priority: 5 },

  // Medical
  { match_pattern: 'pharmacy', match_type: 'contains', category: 'Medical & Health', priority: 10 },
  { match_pattern: 'cvs', match_type: 'starts_with', category: 'Medical & Health', priority: 8 },
  { match_pattern: 'walgreens', match_type: 'contains', category: 'Medical & Health', priority: 8 },
  { match_pattern: 'medical', match_type: 'contains', category: 'Medical & Health', priority: 5 },
  { match_pattern: 'doctor', match_type: 'contains', category: 'Medical & Health', priority: 5 },
  { match_pattern: 'hospital', match_type: 'contains', category: 'Medical & Health', priority: 10 },

  // Groceries
  { match_pattern: 'whole foods', match_type: 'contains', category: 'Groceries', priority: 10 },
  { match_pattern: 'trader joe', match_type: 'contains', category: 'Groceries', priority: 10 },
  { match_pattern: 'costco', match_type: 'contains', category: 'Groceries', priority: 10 },
  { match_pattern: 'safeway', match_type: 'contains', category: 'Groceries', priority: 10 },
  { match_pattern: 'kroger', match_type: 'contains', category: 'Groceries', priority: 10 },
  { match_pattern: 'target', match_type: 'contains', category: 'Shopping', priority: 5 },
  { match_pattern: 'walmart', match_type: 'contains', category: 'Shopping', priority: 5 },
];

async function main() {
  const { data: existing, error: fetchErr } = await supabase
    .from('category_rules')
    .select('match_pattern, match_type');

  if (fetchErr) {
    throw new FatalError(`Failed to fetch existing rules: ${fetchErr.message}`, {
      cause: fetchErr,
    });
  }

  const existingSet = new Set(
    (existing || []).map((r) => `${r.match_pattern}|${r.match_type}`),
  );

  const toInsert = RULES.filter(
    (r) => !existingSet.has(`${r.match_pattern}|${r.match_type}`),
  ).map((r) => ({ ...r, created_by: 'seed' }));

  log.info(
    `${RULES.length} candidate rules; ${toInsert.length} new, ${RULES.length - toInsert.length} already exist.`,
  );

  if (toInsert.length === 0) {
    log.info('Nothing to insert.');
    return;
  }

  if (args.dryRun) {
    log.info('[dry-run] Would insert:');
    for (const r of toInsert) {
      log.info(`  ${r.match_type.padEnd(11)} "${r.match_pattern}" → ${r.category} (priority ${r.priority})`);
    }
    return;
  }

  const { error } = await supabase.from('category_rules').insert(toInsert);
  if (error) {
    throw new FatalError(`Error seeding rules: ${error.message}`, { cause: error });
  }

  log.info(
    `Seeded ${toInsert.length} category rules (${RULES.length - toInsert.length} already existed).`,
  );
}

run(main);
