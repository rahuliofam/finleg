# scripts/

Operational scripts for the finleg project: batch ingest jobs, external API
sync, backups, maintenance utilities, and dev tooling. Most `.mjs` batch jobs
are designed to run on the Hostinger VPS via Claude CLI headless mode per
[CLAUDE.md](../CLAUDE.md). Backups that need R2 or RVAULT20 access run on
Hostinger (DB dump) and on the Alpaca Mac (RVAULT20 mirror).

All `.mjs` scripts are runnable directly via `node scripts/<name>.mjs` — no
build step. Migrated scripts share a small utility library under
[`lib/`](./lib/) (see [Shared utilities](#shared-utilities-scriptslib)).

For cross-cutting context:

- [CLAUDE.md](../CLAUDE.md) — Hostinger VPS, Claude CLI headless mode, Supabase CLI multi-account
- [docs/INTEGRATIONS.md](../docs/INTEGRATIONS.md) — external APIs (Anthropic, Gemini, QuickBooks, Schwab, R2, Resend)
- [docs/DEPLOY.md](../docs/DEPLOY.md) — CI version-bump flow that wraps `bump-version.sh`
- [docs/BACKUP-RECOVERY.md](../docs/BACKUP-RECOVERY.md) — backup strategy, cron schedules, restore procedures
- [docs/STATEMENT-INGESTION.md](../docs/STATEMENT-INGESTION.md) — end-to-end statement ingestion pipeline

## Table of contents

- [Common env vars](#common-env-vars)
- [Common flags](#common-flags)
- [Shared utilities (`scripts/lib/`)](#shared-utilities-scriptslib)
- [Shell ops — deploy, migrations, backups](#shell-ops--deploy-migrations-backups)
- [Batch processing — documents, statements, OCR](#batch-processing--documents-statements-ocr)
- [External sync — QuickBooks, Schwab](#external-sync--quickbooks-schwab)
- [Maintenance — indexing, seeding, verification](#maintenance--indexing-seeding-verification)
- [Other](#other)
- [Known cron schedules](#known-cron-schedules)
- [How to add a new script](#how-to-add-a-new-script)

## Common env vars

Most `.mjs` scripts read `.env` (or `local.env` for QuickBooks) via `dotenv`.
The shell scripts additionally fall back to `~/.env-finleg` when run on a VPS.
Migrated scripts use `loadEnv` / `loadSupabaseEnv` from `scripts/lib/env.mjs`,
which fail-fast with one consolidated error listing every missing required var.

| Var | Used by |
|---|---|
| `SUPABASE_URL` | all Supabase clients (defaults to `https://gjdvzzxsrzuorguwkaih.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | every script that writes to Supabase |
| `SUPABASE_DB_URL` | `backup-db-to-r2.sh`, `bump-version.sh`, `run-migration.sh` (psql / pg_dump) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | anything touching Cloudflare R2 |
| `GEMINI_API_KEY` | `ocr-gemini-flash.mjs`, `process-tax-returns.mjs` |
| `RESEND_API_KEY` | `process-inbox.mjs`, `process-tax-returns.mjs` (email notifications) |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REALM_ID`, `QUICKBOOKS_REFRESH_TOKEN` | all `qb-*` + `test-quickbooks.mjs` |
| `QUICKBOOKS_ENVIRONMENT` | QB scripts; `production` (default) or `sandbox` |
| `BW_SESSION` | `schwab-manual-auth.mjs` (Bitwarden-sourced secrets) |
| `SCRIPT_LOG_FILE` | any script using `createLogger` — optional file output for log lines |

## Common flags

Migrated scripts follow a shared convention via `scripts/lib/cli.mjs`:

- `--dry-run` — parse/compute but don't write to Supabase or remote services
- `--limit N` — cap batch size
- `--verbose` / `-v` — enable debug logs
- `--help` / `-h` — print usage and exit 0

Filter flags vary per script (`--account-type`, `--institution`, `--bucket`,
`--entity`, `--year`, etc.) — see `--help` output or the per-script entries below.

## Shared utilities (`scripts/lib/`)

All migrated scripts import from `scripts/lib/index.mjs`. Unmigrated scripts
still work — the lib is opt-in.

| Module | Exports | Purpose |
| --- | --- | --- |
| `env.mjs` | `loadEnv`, `loadSupabaseEnv` | Load `.env` + `local.env`, validate required vars, fail fast with one consolidated error message. |
| `supabase.mjs` | `createSupabaseClient`, `fetchAllPages`, `batchInsert` | Authenticated service-role client; pagination helper; batched insert with error context. |
| `logger.mjs` | `createLogger`, `logger`, `LEVELS` | Levels (debug/info/warn/error), optional timestamps, optional file output, TTY-aware progress reporter. |
| `retry.mjs` | `retry` | Exponential-backoff wrapper with jitter; never retries `FatalError` / `ValidationError`. |
| `cli.mjs` | `parseArgs`, `getFlag` | Tiny arg parser supporting the conventions above; auto-handles `--help`, `--verbose`, `--dry-run`. |
| `errors.mjs` | `FatalError`, `RetriableError`, `ValidationError`, `ScriptError`, `asRetriable` | Signal-carrying errors for handling/skipping/retrying. |
| `runner.mjs` | `run` | Wraps `main()` with uniform exit codes, SIGINT/SIGTERM handling, and clean messages for `FatalError` / `ValidationError`. |
| `index.mjs` | all of the above | Barrel re-export — one import line. |

Currently migrated: `process-inbox.mjs`, `process-tax-returns.mjs`,
`ingest-statements.mjs`, `ai-categorize-batch.mjs`, `ocr-gemini-flash.mjs`,
`extract-doc-text.mjs`, `compute-ai-metrics.mjs`,
`sync-investment-balances-to-qb.mjs`. Migration of the remaining scripts is
mechanical and can happen incrementally.

---

## Shell ops — deploy, migrations, backups

### `bump-version.sh`
Record a release event in Supabase, rewrite version strings in every `*.html`
file, and write `version.json`. Idempotent per push SHA.

- **Invocation:** CI only — GitHub Action `.github/workflows/bump-version-on-push.yml` runs on every push to `main`. Never bump locally (see [CLAUDE.md](../CLAUDE.md) Mandatory Behaviors #3).
- **Env:** `SUPABASE_DB_URL` required; `AAP_MODEL_CODE`, `RELEASE_*`, `AAP_MACHINE_NAME` optional.
- **External:** Supabase Postgres (via `psql`).
- **Also updates:** `feature_requests.deployed_version` for merged review branches; legacy `site_config.version`.

### `push-main.sh`
Pull `--rebase` from `origin/main`, then push. The CI workflow bumps the version afterward.

- **Invocation:** manual, from `main` only.
- **Env:** none beyond git config.

### `run-migration.sh`
Pre-migration backup + apply migration with rollback artifacts.

- **Invocation:** manual. Examples:
  `./scripts/run-migration.sh supabase/migrations/016_new_feature.sql` ·
  `./scripts/run-migration.sh --dump-only document_index qb_general_ledger` ·
  `./scripts/run-migration.sh --dry-run supabase/migrations/016_new_feature.sql`
- **Env:** `SUPABASE_DB_URL` (from `~/.env-finleg`, `.env`, or `local.env`).
- **External:** Supabase Postgres (`psql` + `pg_dump`).
- **Output:** `backups/pre-migration-*.sql.gz` (auto-gitignored). Auto-detects tables from DDL/DML patterns; falls back to a full `public` schema dump.

### `backup-db-to-r2.sh`
Dump Supabase Postgres to a gzipped SQL file and upload to the
`finleg-backups` R2 bucket. Prunes to the last 12 dumps.

- **Invocation:** weekly cron on Hostinger VPS — `0 3 * * 0 /root/finleg/scripts/backup-db-to-r2.sh >> /var/log/finleg-backup.log 2>&1` (Sunday 3am UTC). Supports `--tables` (critical tables only) and `--dry-run`.
- **Env:** `SUPABASE_DB_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET` (default `finleg-backups`); optionally `SUPABASE_SERVICE_ROLE_KEY` for posting to `backup_logs`.
- **External:** Supabase Postgres, Cloudflare R2 (via `aws s3` + S3 endpoint), Supabase REST (`backup_logs`).
- **Prereqs on Hostinger:** `pg_dump` (prefers `/usr/lib/postgresql/17/bin/pg_dump`), `aws` CLI.
- **Typical runtime:** minutes (full dump size depends on DB).

### `backup-finleg-to-rvault.sh`
Mirror all R2 buckets plus the latest DB dump to RVAULT20 via `aws s3 sync`.

- **Invocation:** weekly cron on Alpaca Mac — `0 5 * * 0 /Users/alpaca/scripts/backup-finleg-to-rvault.sh >> /Users/alpaca/logs/finleg-backup.log 2>&1` (Sunday 5am local, after the Hostinger dump). Supports `--dry-run`.
- **Env:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (from `~/.env-finleg`); optionally `SUPABASE_SERVICE_ROLE_KEY`.
- **External:** Cloudflare R2, local `/Volumes/RVAULT20/BackupsRS/finleg/`, Supabase REST (`backup_logs`).
- **Buckets synced:** `financial-statements`, `bookkeeping-docs`, `legal-docs`, `finleg-backups`.

---

## Batch processing — documents, statements, OCR

All of these are designed for the Hostinger VPS unless marked otherwise. They
query `document_index` / `statement_inbox`, download from R2, invoke an AI
model, and write structured results back to Supabase.

### `process-inbox.mjs` *(harness-migrated)*
Poll `statement_inbox` for pending items, upload to R2, parse with Claude CLI
(`sonnet`), insert structured rows into statement tables, and email a summary
via Resend.

- **Invocation:** Hostinger cron. Examples: `node scripts/process-inbox.mjs` (all pending), `--dry-run`, `--limit 5`, `--id <uuid>`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`, `RESEND_API_KEY`.
- **External:** Supabase, R2, Claude CLI (`claude --print --model sonnet`), Resend (to `rahchak@gmail.com` from `agent@finleg.net`).
- **Typical runtime:** iterates per-item; each PDF is a separate Claude CLI call.

### `process-tax-returns.mjs` *(harness-migrated)*
Extract tax-return data with Gemini Flash 2.5 (primary) and Claude Sonnet
(verification), compare results, write to typed tables + EAV, and email
conflicts.

- **Invocation:** Hostinger batch. Modes: `--inbox` (poll `statement_inbox`), `--dir "/path"`, `--file "/path.pdf"`. Flags: `--dry-run`, `--gemini-only`, `--limit N`, `--reprocess --entity "Rahul" --year 2023`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`.
- **External:** Supabase, Gemini API, Claude CLI, Resend.

### `ingest-statements.mjs` *(harness-migrated)*
Parse statement PDFs from R2 (credit-card, checking, brokerage, IRA, crypto,
HELOC, auto-loan, mortgage, closed) via Claude CLI and insert into typed
statement tables.

- **Invocation:** manual or Hostinger cron. Examples:
  `node scripts/ingest-statements.mjs` ·
  `--account-type credit-card` ·
  `--dry-run --sample` (1 PDF per account) ·
  `--institution amex` ·
  `--concurrency 3`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.
- **External:** Supabase, R2 (via `aws` / `wrangler` — see script), Claude CLI.
- **See:** [docs/STATEMENT-INGESTION.md](../docs/STATEMENT-INGESTION.md).

### `extract-doc-metadata.mjs`
Extract rich metadata (document_type, parties, dates, institution, tags) from
documents missing `ai_metadata`, via Claude CLI headless.

- **Invocation:** Hostinger. `node scripts/extract-doc-metadata.mjs [--dry-run] [--limit=N] [--category=legal]`. Categories processed: `legal`, `tax-personal`, `investment`, `other`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`.
- **External:** Supabase, R2 (S3 client), Claude CLI (`--model sonnet`, `--allowedTools Read` for PDFs/images).
- **Concurrency:** 2 parallel Claude calls; 2s pause between batches.

### `extract-doc-text.mjs` *(harness-migrated)*
Pull plain text out of PDF/DOCX/TXT/MD/CSV/HTML files in R2 and store in
`document_index.extracted_text`. No AI — uses `pdf-parse` and `mammoth`.

- **Invocation:** `node scripts/extract-doc-text.mjs [--dry-run] [--limit=N] [--bucket=legal-docs] [--force]`. Runs locally or on VPS.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`.
- **Parallel:** 5 concurrent downloads.

### `ocr-gemini-flash.mjs` *(harness-migrated)*
OCR scanned PDFs (where `extracted_text IS NULL`) via Google Gemini 2.5 Flash.
Runs locally — ~5s/doc, ~$0.0004/page.

- **Invocation:** `node scripts/ocr-gemini-flash.mjs [--dry-run] [--limit=N] [--bucket=legal-docs]`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`, `GEMINI_API_KEY`.
- **Notes:** sequential (PARALLEL=1) with 7s gap between calls to respect Gemini free-tier 10 RPM; has retry-on-429 with backoff.

### `ocr-scanned-pdfs.mjs`
OCR alternative using Claude CLI headless vision. Must run on Hostinger
(nested CLI doesn't work locally).

- **Invocation:** `node scripts/ocr-scanned-pdfs.mjs [--dry-run] [--limit=N] [--bucket=legal-docs] [--model=sonnet]`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`.
- **External:** Supabase, R2, Claude CLI.
- **Notes:** sequential (PARALLEL=1); each call has a 3-minute timeout. Sorts by `file_size` ascending for faster initial feedback.

### `ai-categorize-batch.mjs` *(harness-migrated)*
Fetch uncategorized `qb_transactions`, group by vendor, few-shot the most
recent human-approved categorizations, send to Claude CLI, and update rows
with `category_source='ai'` and a confidence score.

- **Invocation:** Hostinger. `node scripts/ai-categorize-batch.mjs [--dry-run] [--limit N]` (default 50).
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.
- **External:** Supabase, Claude CLI.
- **Also writes:** `bookkeeping_activity_log` with action `auto_categorized`.

---

## External sync — QuickBooks, Schwab

### `qb-oauth-server.mjs`
One-shot local HTTP server on port 3000 that walks the QuickBooks OAuth 2.0
authorization-code flow, fetches CompanyInfo, and upserts tokens into
`qb_tokens` (also writing the refresh token to `local.env`).

- **Invocation:** manual, `node scripts/qb-oauth-server.mjs`. Opens browser to Intuit consent screen.
- **Env:** `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENVIRONMENT` (default `sandbox`), `SUPABASE_SERVICE_ROLE_KEY`.
- **Redirect URI:** `http://localhost:3000/callback` (must match the app's registered URI in the Intuit dev portal).

### `qb-refresh-token.mjs`
Use the current QB refresh token to rotate access + refresh tokens; write both
to `local.env` and `qb_tokens`. QB refresh tokens expire after 100 days of
non-use, so this keeps the chain alive.

- **Invocation:** scheduled weekly (cron or scheduled task) and ad-hoc. `node scripts/qb-refresh-token.mjs`.
- **Env:** `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REALM_ID`, `QUICKBOOKS_REFRESH_TOKEN` (or pulled from `qb_tokens`), `SUPABASE_SERVICE_ROLE_KEY`.
- **External:** Intuit OAuth, Intuit CompanyInfo API (verification), Supabase.

### `qb-gl-compare.mjs`
Fetch the QuickBooks General Ledger via API for a fixed date range
(`2025-01-01` .. `2026-03-15` in the current script), compare against
`qb_general_ledger` (the CSV-derived table), and print account/row diffs.
Optionally uploads the raw API response to R2.

- **Invocation:** manual. `node scripts/qb-gl-compare.mjs [--upload] [--test]`. `--test` uploads under a `test/` prefix.
- **Env:** reads `local.env`; needs `QUICKBOOKS_*`, `SUPABASE_*`, and (for `--upload`) `R2_*`.
- **Output:** `qb-general-ledger-api.json` at repo root.

### `test-quickbooks.mjs`
Smoke test for the QuickBooks OAuth + API path: refreshes tokens, calls
`CompanyInfo`, lists the chart of accounts, and fetches a 2024–2025 General
Ledger report.

- **Invocation:** manual. Either pass `QUICKBOOKS_ACCESS_TOKEN=...` (from OAuth Playground) or rely on `QUICKBOOKS_REFRESH_TOKEN` in `local.env`.
- **Env:** `QUICKBOOKS_*`.
- **Output:** writes full GL to `qb-general-ledger-api.json`.

### `ingest-qb-ledger.mjs`
Parse a QuickBooks General Ledger CSV export and load into
`qb_general_ledger` (clears and re-inserts the whole table in 500-row batches).

- **Invocation:** manual, `node scripts/ingest-qb-ledger.mjs "/path/to/ledger.csv"`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.
- **Notes:** ⚠️ destructive — deletes all existing rows before inserting.

### `sync-investment-balances-to-qb.mjs` *(harness-migrated)*
Monthly batch: push aggregate investment balances from
`investment_statement_summaries` into the `qb_writeback_queue` as `JournalEntry`
proposals, and queue `Deposit` proposals for dividend/interest/capital-gain
transactions from the last 30 days. Entries are `proposed` and require admin
approval before the `qb-writeback` edge function executes them.

- **Invocation:** monthly. `node scripts/sync-investment-balances-to-qb.mjs [--dry-run] [--verbose]`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY` (QB OAuth not used directly — edge function handles writeback).
- **External:** Supabase only.

### `schwab-manual-auth.mjs`
Manual Schwab OAuth flow using the Portsie callback URL. Prints an authorize
URL on first run, accepts the code as an argument on second run, exchanges for
tokens, encrypts with AES-256-GCM (key from Bitwarden), and upserts into
`oauth_tokens`. Then hits the `schwab-oauth` Cloudflare Worker's `/schwab/status`
endpoint to verify.

- **Invocation:** manual, two-step. `bw unlock` first; then `node scripts/schwab-manual-auth.mjs` (prints URL), then `node scripts/schwab-manual-auth.mjs <code>`.
- **Env:** `BW_SESSION`, `SUPABASE_SERVICE_ROLE_KEY`. All Schwab credentials (App Key/Secret, Encryption Key, Callback URL, auth + token URLs) and worker auth token are pulled live from Bitwarden.
- **External:** Bitwarden CLI, Schwab OAuth, Supabase (`institutions`, `oauth_tokens`), `schwab-oauth.finleg.workers.dev`.

---

## Maintenance — indexing, seeding, verification

### `upload-to-r2.sh`
Shell version of the initial accounting-files migration. Walks a source
directory, applies a big case-statement of routing rules (account prefix →
bucket + R2 path + account metadata), and uploads each file via `wrangler r2
object put` with custom metadata headers.

- **Invocation:** manual, one-off. `./scripts/upload-to-r2.sh [--dry-run]`.
- **Prereqs:** `wrangler` logged in; hardcoded `SRC` path pointing to the local Sonnad accounting folder.
- **Status:** superseded by `upload-r2-index.mjs` for parallel uploads + Supabase indexing in the same run.

### `upload-r2-index.mjs`
Node version of the above: uploads accounting files from the local Sonnad
folder to R2 (parallel=10) and inserts corresponding `document_index` rows in
Supabase.

- **Invocation:** manual. `node scripts/upload-r2-index.mjs [--dry-run] [--skip-existing]`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.
- **Prereqs:** hardcoded `SRC`; `wrangler` logged in.

### `upload-family-docs.mjs`
Upload the "LegalandFinancialFamilyDocs" folder to R2 (`legal-docs`,
`bookkeeping-docs`) and index in Supabase. Hard-blocks a short list of
sensitive filenames (e.g., SSN/password files). Categories: `legal`,
`tax-personal`, `investment`, `other`.

- **Invocation:** manual. `node scripts/upload-family-docs.mjs [--dry-run] [--skip-existing]`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.
- **Prereqs:** hardcoded `SRC`; `wrangler` logged in.

### `upload-legal-docs.mjs`
Upload the "GoogleDriveFinLeg Migration Docs" folder to `legal-docs` and index.

- **Invocation:** manual. `node scripts/upload-legal-docs.mjs [--dry-run] [--skip-existing]`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.

### `fix-missing-index.mjs`
Repair utility: for files already in R2, insert any missing `document_index`
rows in Supabase (skips rows whose `r2_key` already exists). Pulls all existing
keys first, then walks the local source tree and upserts the diff in batches
of 50.

- **Invocation:** manual, one-off. `node scripts/fix-missing-index.mjs`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.
- **Prereqs:** hardcoded `SRC`.

### `verify-index.mjs`
Quick sanity check — prints `document_index` row counts grouped by bucket,
category, account_type, institution, and year.

- **Invocation:** manual. `node scripts/verify-index.mjs`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.

### `seed-category-rules.mjs`
Insert a curated list of vendor-pattern → category rules into `category_rules`.
Idempotent — skips `(match_pattern, match_type)` pairs that already exist.

- **Invocation:** manual. `node scripts/seed-category-rules.mjs`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.

### `compute-ai-metrics.mjs` *(harness-migrated)*
Compute weekly AI-categorization accuracy by comparing AI-assigned categories
to human corrections and upsert a row into `ai_metrics`.

- **Invocation:** weekly. `node scripts/compute-ai-metrics.mjs` (last 7 days) or `--period YYYY-MM-DD YYYY-MM-DD`. Supports `--dry-run` and `--verbose`.
- **Env:** `SUPABASE_SERVICE_ROLE_KEY`.

---

## Other

### `cloudflared/`
Config for the Cloudflare Tunnel that routes `cam.alpacaplayhouse.com` to
local `ptz-proxy` (port 8901) and `go2rtc` (port 1984) on the Alpaca Mac.

- `config.yml` — deployed to `~/.cloudflared/config.yml` after running `cloudflared tunnel create alpaca-cam`.
- `com.cloudflare.tunnel.plist` — launchd agent for `cloudflared tunnel run alpaca-cam` with `KeepAlive` / `RunAtLoad`.

---

## Known cron schedules

Schedules are enforced outside this repo (Hostinger cron, launchd, GitHub
Actions, or the Claude Code scheduled-tasks MCP).

| Script | Where | Schedule | Notes |
|---|---|---|---|
| `backup-db-to-r2.sh` | Hostinger VPS | `0 3 * * 0` (Sunday 3am UTC) | Wired |
| `backup-finleg-to-rvault.sh` | Alpaca Mac | `0 5 * * 0` (Sunday 5am local) | Wired |
| `bump-version.sh` | GitHub Actions | push to `main` (not cron) | Wired |
| `process-inbox.mjs` | Hostinger | intended as cron per header; cadence TBD | Not currently wired |
| `qb-refresh-token.mjs` | suggested weekly (any host) | not currently wired to a scheduler | Manual today |
| `compute-ai-metrics.mjs` | suggested weekly | not currently wired to a scheduler | Manual today |
| `sync-investment-balances-to-qb.mjs` | suggested monthly | not currently wired to a scheduler | Manual today |
| `ai-categorize-batch.mjs` | header says "intended for cron"; cadence TBD | not currently wired | Manual today |

Everything else is on-demand.

---

## How to add a new script

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

### Conventions observed across the directory

1. **Batch AI jobs → Hostinger VPS + Claude CLI headless.** Per [CLAUDE.md](../CLAUDE.md) "Batch Processing": long-running or AI-powered scripts should use `claude --print` (not the Anthropic SDK) and run on the VPS. Hostinger prereqs: Node 22+, `@anthropic-ai/claude-code`, `wrangler`. SSH via `sshpass -f ~/.ssh/alpacapps-hostinger.pass`.
2. **Header block.** Top-of-file JSDoc with Purpose, Usage examples, Env vars, Prereqs. Match the style in `extract-doc-metadata.mjs` or `process-inbox.mjs`.
3. **Shebang + module style.** `.mjs` with `#!/usr/bin/env node` and ESM imports; shell scripts use `#!/bin/bash` with `set -euo pipefail`.
4. **Env loading.** Migrated `.mjs`: use `loadEnv` / `loadSupabaseEnv` from `scripts/lib/env.mjs` so missing vars are reported in one consolidated error. Legacy: `import { config } from 'dotenv'; config();` is fine. Shell: fall back across `~/.env-finleg`, `.env`, and `local.env` (see `run-migration.sh`).
5. **Supabase client.** Migrated: `createSupabaseClient({ env })`. Legacy: `SUPABASE_URL` defaults to the finleg project ref; require `SUPABASE_SERVICE_ROLE_KEY` and exit non-zero if missing.
6. **Flags.** Support `--dry-run` on any script that mutates state. Support `--limit N` on anything that iterates. Use `parseArgs` from `scripts/lib/cli.mjs` to get `--help` / `--verbose` / `--dry-run` for free.
7. **R2 access.** Use the S3 client for reads (`@aws-sdk/client-s3` with R2 endpoint) and `wrangler r2 object put` for writes — see `upload-family-docs.mjs` for the wrangler pattern.
8. **Activity logging.** Mutating batch jobs should insert into `bookkeeping_activity_log` with `actor: 'ai'` or `'system'` and a `details` JSON blob (see `ai-categorize-batch.mjs`).
9. **Error signalling (migrated scripts).** Throw `FatalError` to abort the batch (bad config, unrecoverable DB error). Throw `ValidationError` when one record is bad but the batch should keep going — `retry()` will not retry it. Throw `RetriableError` (or any other `Error`) to retry via `retry()`.
10. **Logging.** Use `log.info` / `log.warn` / `log.error` from `createLogger`, not `console.*`, so output is consistent and can be captured via `SCRIPT_LOG_FILE`.
11. **Don't bump versions locally.** Let CI handle it — see [CLAUDE.md](../CLAUDE.md) Mandatory Behaviors #3.
12. **New cron jobs → document them.** Add the crontab line to [docs/BACKUP-RECOVERY.md](../docs/BACKUP-RECOVERY.md) (backups) or to the [Known cron schedules](#known-cron-schedules) table above so the schedule is discoverable.
