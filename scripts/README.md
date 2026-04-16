# scripts/

Batch scripts for finleg: document ingestion, Supabase sync, QuickBooks/Schwab
integration, OCR, AI categorization, and maintenance chores.

All `.mjs` scripts are runnable directly via `node scripts/<name>.mjs` — no
build step. They use ESM imports and share a small utility library under
[`lib/`](./lib/).

> **Where to run:** Long-running or AI-heavy batch scripts should run on the
> Hostinger VPS (see `CLAUDE.md` → Batch Processing). Local runs are fine for
> one-offs and dry-runs. OAuth helpers (`qb-oauth-server`, `schwab-manual-auth`)
> must run locally because they open a browser.

## Table of contents

- [Script catalog](#script-catalog)
- [Shared utilities (`scripts/lib/`)](#shared-utilities-scriptslib)
- [Common flags](#common-flags)
- [Environment variables](#environment-variables)
- [Scheduling](#scheduling)
- [Writing a new script](#writing-a-new-script)

## Script catalog

### Document ingestion & extraction

| Script | Purpose | Runs | Key flags |
| --- | --- | --- | --- |
| `process-inbox.mjs` | Poll `statement_inbox` → upload to R2 → parse with Claude → insert statement tables. Emails a summary on success. | Hostinger cron | `--dry-run`, `--limit N`, `--id UUID` |
| `process-tax-returns.mjs` | Extract tax return PDFs with Gemini Flash + Claude verification; inserts typed tables; emails conflicts. | Hostinger, on demand | `--inbox`, `--dir PATH`, `--file PATH`, `--dry-run`, `--gemini-only`, `--reprocess`, `--entity NAME`, `--year YYYY` |
| `ingest-statements.mjs` | Backfill: find indexed statement PDFs in R2, parse with Claude, insert into summary + transaction tables. | Hostinger, on demand | `--account-type`, `--institution`, `--concurrency N`, `--sample`, `--dry-run` |
| `extract-doc-text.mjs` | Extract plain text from PDF/DOCX/MD/TXT docs via `pdf-parse` / `mammoth`; stores in `document_index.extracted_text`. | local or Hostinger | `--bucket`, `--force`, `--limit N`, `--dry-run` |
| `extract-doc-metadata.mjs` | Send docs to Claude CLI, extract structured metadata (`document_type`, `parties`, `tags`…), store in `ai_metadata`. | Hostinger | `--category=legal`, `--limit=N`, `--dry-run` |
| `ocr-gemini-flash.mjs` | OCR scanned PDFs via Gemini 2.5 Flash (~$0.0004/page). | local | `--bucket`, `--limit N`, `--dry-run` |
| `ocr-scanned-pdfs.mjs` | OCR scanned PDFs via Claude CLI (vision). | Hostinger only (nested CLI) | `--bucket=`, `--limit=N`, `--dry-run` |

### Indexing & uploads

| Script | Purpose | Runs | Key flags |
| --- | --- | --- | --- |
| `upload-r2-index.mjs` | Bulk upload local accounting folder to R2 and index in `document_index`. | local | `--dry-run`, `--skip-existing` |
| `upload-family-docs.mjs` | Upload the LegalAndFinancialFamilyDocs folder to R2 (multi-bucket routing). | local | `--dry-run`, `--skip-existing` |
| `upload-legal-docs.mjs` | Upload legal migration docs to `legal-docs` bucket. | local | `--dry-run`, `--skip-existing` |
| `fix-missing-index.mjs` | Insert `document_index` rows for R2 files that are present but un-indexed. | local, one-off | none |
| `verify-index.mjs` | Print counts of `document_index` by bucket/category/account/institution/year. | anywhere | none |

### AI categorization

| Script | Purpose | Runs | Key flags |
| --- | --- | --- | --- |
| `ai-categorize-batch.mjs` | Auto-categorize pending QB transactions with Claude CLI + few-shot examples. | Hostinger cron | `--dry-run`, `--limit N` |
| `compute-ai-metrics.mjs` | Compute accuracy / confidence / rule churn metrics into `ai_metrics` table. | Hostinger cron (weekly) | `--period YYYY-MM-DD YYYY-MM-DD` |
| `seed-category-rules.mjs` | Seed `category_rules` with common vendor patterns. Safe to re-run. | on demand | none |

### QuickBooks

| Script | Purpose | Runs | Key flags |
| --- | --- | --- | --- |
| `qb-oauth-server.mjs` | Local OAuth helper — opens browser, completes QB auth, stores tokens in `qb_tokens`. | local | none |
| `qb-refresh-token.mjs` | Refresh QB access/refresh tokens (run weekly so 100-day refresh token doesn't expire). | scheduled (weekly) | none |
| `qb-gl-compare.mjs` | Pull QB General Ledger via API, compare against CSV export, optionally upload to R2. | local | `--upload`, `--test` |
| `ingest-qb-ledger.mjs` | Load a GL CSV export into `qb_general_ledger`. | local, on demand | positional CSV path |
| `sync-investment-balances-to-qb.mjs` | Monthly: push investment summary balances into QB as journal entries. | scheduled (monthly) | `--dry-run` |
| `test-quickbooks.mjs` | Smoke test QB OAuth + API calls. | local | none |

### Schwab

| Script | Purpose | Runs | Key flags |
| --- | --- | --- | --- |
| `schwab-manual-auth.mjs` | Manual Schwab OAuth via portsie callback; stores encrypted tokens in Supabase. | local | positional `<code>` after visiting auth URL |

### Shell helpers (not `.mjs` — not affected by this refactor)

| Script | Purpose |
| --- | --- |
| `backup-db-to-r2.sh` | Backup Supabase DB dump to R2. |
| `backup-finleg-to-rvault.sh` | Backup to rvault. |
| `bump-version.sh` | Writes `version.json`; run only by CI. |
| `push-main.sh` | Convenience `git push` wrapper. |
| `run-migration.sh` | Apply a SQL migration file to Supabase. |
| `upload-to-r2.sh` | Upload a single file to R2 via wrangler. |

## Shared utilities (`scripts/lib/`)

All migrated scripts import from `scripts/lib/index.mjs`.

| Module | Exports | Purpose |
| --- | --- | --- |
| `env.mjs` | `loadEnv`, `loadSupabaseEnv` | Load `.env` + `local.env`, validate required vars, fail fast with one consolidated error message. |
| `supabase.mjs` | `createSupabaseClient`, `fetchAllPages`, `batchInsert` | Authenticated service-role client; pagination helper; batched insert with error context. |
| `logger.mjs` | `createLogger`, `logger`, `LEVELS` | Levels (debug/info/warn/error), optional timestamps, optional file output, TTY-aware progress reporter. |
| `retry.mjs` | `retry` | Exponential-backoff wrapper with jitter; never retries `FatalError`/`ValidationError`. |
| `cli.mjs` | `parseArgs`, `getFlag` | Tiny arg parser supporting the conventions already used across the scripts; auto-handles `--help`, `--verbose`, `--dry-run`. |
| `errors.mjs` | `FatalError`, `RetriableError`, `ValidationError`, `ScriptError`, `asRetriable` | Signal-carrying errors for handling/skipping/retrying. |
| `runner.mjs` | `run` | Wraps `main()` with uniform exit codes, SIGINT/SIGTERM handling, and clean messages for `FatalError`/`ValidationError`. |
| `index.mjs` | all of the above | Barrel re-export — one import line. |

## Common flags

Migrated scripts follow a shared convention:

- `--dry-run` — parse/compute but don't write to Supabase or remote services
- `--limit N` — cap batch size
- `--verbose` / `-v` — enable debug logs
- `--help` / `-h` — print usage and exit 0

Filter flags vary per script (`--account-type`, `--institution`, `--bucket`,
`--entity`, `--year`, etc.) — see `--help` output for each script.

## Environment variables

Scripts read from `.env` and `local.env` at the repo root. Missing required
vars produce one consolidated error at startup.

| Variable | Used by | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | all Supabase scripts | Defaults to the finleg project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **all Supabase scripts** | Service-role key (bypasses RLS). Never ship to the browser. |
| `GEMINI_API_KEY` | `process-tax-returns`, `ocr-gemini-flash` | Google AI Studio. |
| `RESEND_API_KEY` | `process-inbox`, `process-tax-returns` | Email notifications (optional — scripts skip email if unset). |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | any R2 script | Cloudflare R2 S3 API credentials. |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REALM_ID`, `QUICKBOOKS_REFRESH_TOKEN` | QB scripts | Tokens live in `local.env`; refreshed weekly by `qb-refresh-token`. |
| `QUICKBOOKS_ENVIRONMENT` | QB scripts | `production` (default) or `sandbox`. |
| `SCRIPT_LOG_FILE` | any script using `createLogger` | Optional: also append log lines to this file. |

## Scheduling

Schedules are enforced outside this repo (Hostinger cron, launchd, or the
Claude Code scheduled-tasks MCP). Canonical schedule:

| Script | Frequency | Notes |
| --- | --- | --- |
| `process-inbox.mjs` | every 5 min | Consumes `statement_inbox`. |
| `ai-categorize-batch.mjs` | hourly | Categorizes new QB transactions. |
| `compute-ai-metrics.mjs` | weekly (Sun) | Upserts into `ai_metrics`. |
| `qb-refresh-token.mjs` | weekly | Keeps 100-day refresh token alive. |
| `sync-investment-balances-to-qb.mjs` | monthly | Journal entry for month-end balances. |
| `backup-db-to-r2.sh`, `backup-finleg-to-rvault.sh` | daily | See `docs/REMOTE-ACCESS.md`. |

Everything else is on-demand.

## Writing a new script

Use the shared utilities so the script looks like every other one:

```js
#!/usr/bin/env node
/**
 * One-line description for the catalog.
 *
 * Usage: node scripts/your-script.mjs [--dry-run] [--limit N]
 */

import {
  loadSupabaseEnv,
  createSupabaseClient,
  createLogger,
  parseArgs,
  retry,
  run,
  FatalError,
  ValidationError,
} from './lib/index.mjs';

const env = loadSupabaseEnv(['EXTRA_REQUIRED_VAR']);
const supabase = createSupabaseClient({ env });

const args = parseArgs(process.argv.slice(2), {
  booleans: ['force'],
  numbers: { limit: 100 },
  strings: ['institution'],
  help: `Your script description.

Usage: node scripts/your-script.mjs [options]

Options:
  --dry-run      parse but don't write
  --limit N      max items (default 100)
  --institution  filter by institution
  --verbose      show debug logs
  --help         this text
`,
});

const log = createLogger({ verbose: args.verbose });

async function main() {
  log.info(`Starting (mode=${args.dryRun ? 'dry-run' : 'live'})`);

  const { data, error } = await supabase.from('some_table').select('id').limit(args.limit);
  if (error) throw new FatalError(`Query failed: ${error.message}`, { cause: error });

  for (const row of data) {
    await retry(() => doWork(row), {
      maxAttempts: 3,
      onRetry: (err, attempt) => log.warn(`retry ${attempt}: ${err.message}`),
    });
  }
}

run(main);
```

Rules of thumb:

- **Throw `FatalError`** to abort the batch (bad config, unrecoverable DB error).
- **Throw `ValidationError`** when one record is bad but the batch should keep
  going — `retry()` will not retry it.
- **Throw `RetriableError`** (or any other `Error`) to retry via `retry()`.
- **Use `log.info` / `log.warn` / `log.error`** — not `console.*` — so output
  is consistent and can be captured via `SCRIPT_LOG_FILE`.
- **Never hardcode credentials.** Add required vars to `loadEnv({ required: [...] })`.
- **Never bump versions, never push.** CI handles versioning (see `CLAUDE.md`).
- **For Claude-powered AI work, use `claude --print` (the CLI), not the SDK.**
  See `CLAUDE.md` → Batch Processing.
