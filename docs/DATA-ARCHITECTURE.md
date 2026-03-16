# Data Architecture

> Where all finleg data lives, where it comes from, and how it flows.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                               │
├──────────────┬──────────────────┬───────────────┬──────────────────-┤
│  Local Files │  QuickBooks API  │  QuickBooks   │  User Auth       │
│  (1,880 docs)│  (Production)    │  CSV (Legacy) │  (Google OAuth)  │
└──────┬───────┴────────┬─────────┴───────┬───────┴─────────┬────────┘
       │                │                 │                 │
       ▼                ▼                 ▼                 ▼
┌──────────────┐ ┌──────────────┐  ┌──────────────┐ ┌──────────────┐
│ Cloudflare R2│ │ QB API (prod)│  │   Supabase   │ │ Supabase Auth│
│ (file store) │ │ OAuth 2.0    │  │  (database)  │ │ (sessions)   │
└──────┬───────┘ └──────┬───────┘  └──────┬───────┘ └──────┬───────┘
       │                │                 │                 │
       └────────┬───────┴─────────────────┘                 │
                ▼                                           ▼
       ┌─────────────────────────────────────────────────────────────┐
       │              Next.js App (GitHub Pages)                     │
       │  File Vault │ Bookkeeping │ Accounts │ Admin │ Claude Dev  │
       └─────────────────────────────────────────────────────────────┘
```

---

## 1. Cloudflare R2 — File Storage

**Account:** Rah Hui Lio Son Fami (ID: `1417f040cdffb8ba923a28be80d095b6`)
**1Password:** DevOps-finleg → "Cloudflare R2 — Finleg Object Storage"

### Buckets

| Bucket | Files | Size | Purpose |
|---|---|---|---|
| `financial-statements` | 1,337 | ~500MB | Bank, brokerage, credit card, loan statements |
| `bookkeeping-docs` | 543 | ~247MB | Taxes, insurance, property receipts, credit reports, reference files |
| `legal-docs` | 0 | — | Future: contracts, legal documents |
| `alpacapps` | varies | — | Pre-existing bucket (Alpaca Playhouse assets) |

### Folder Structure

```
financial-statements/
├── credit-cards/
│   ├── amex-blue-preferred-24006/     (Rahul)
│   ├── amex-blue-business-11003/      (Rahul)
│   ├── apple-card-2202/               (Rahul)
│   ├── chase-amazon-cc-4206/          (Rahul)
│   ├── chase-visa-cc-7191/            (Subhash)
│   ├── boa-cc-6420/                   (Subhash)
│   └── robinhood-gold-card-3892/      (Rahul)
├── bank-accounts/
│   ├── schwab-checking-3711/          (Rahul)
│   ├── us-bank-checking-7444/         (Rahul)
│   ├── cash-app/                      (Rahul)
│   ├── venmo/                         (Rahul)
│   └── paypal/                        (Rahul)
├── brokerage/
│   ├── schwab-brokerage-0566/         (Rahul)
│   ├── schwab-brokerage-2028/         (Subhash)
│   ├── schwab-trading-2192/           (Rahul)
│   ├── schwab-ira-3902/               (Rahul)
│   ├── schwab-trust-0044/             (Trust)
│   ├── coinbase/                      (Rahul)
│   ├── robinhood-ira-8249-2310/       (Rahul)
│   └── robinhood-consolidated-ira/    (Rahul)
├── loans/
│   ├── pnc-mortgage/
│   ├── us-bank-equity-9078/
│   ├── us-bank-overdraft-3784/
│   ├── auto-loans/
│   ├── sba-4469264009-physical-business/
│   └── sba-9663307809-covid-injury/
└── closed-accounts/                   (Wells Fargo, 5th/3rd, Amex Green, etc.)

bookkeeping-docs/
├── taxes/                             (2020-2025 returns, property taxes)
├── insurance/                         (health, auto, umbrella, dental)
├── property/
│   ├── alpaca-playhouse/              (utility bills, vendors, receipts)
│   └── wa-sharingwood/                (WA house expenses)
├── credit-reports/                    (Rahul's credit reports)
├── quickbooks/                        (QuickBooks backup files)
├── ai-analysis/                       (AI-generated financial analysis)
└── reference-spreadsheets/            (master tracking files, P&L, capital projects)
```

### Source

All R2 files originate from:
`/Users/rahulio/Documents/CodingProjects/noncode/Finleg/AI Financial/Current Sonnad Accounting Files - Amanda 2022+`

**Upload script:** `scripts/upload-r2-index.mjs` — parallel upload (10 concurrent) + Supabase indexing

---

## 2. Supabase — Database

**Project:** SonFamFin
**Ref:** `gjdvzzxsrzuorguwkaih`
**URL:** https://gjdvzzxsrzuorguwkaih.supabase.co
**Region:** West US (Oregon)

### Tables

#### `document_index` — R2 File Search Index
- **Migration:** `007_document_index.sql`
- **Records:** 1,880
- **Purpose:** Full-text search and metadata filtering for File Vault
- **Key columns:** bucket, r2_key, filename, file_type, file_size, category, account_type, institution, account_name, account_number, account_holder, year, month, statement_date, is_closed, property, convertible, original_path
- **Search:** tsvector FTS on filename + account_name + institution + original_path
- **Indexed by:** category, account_type, institution, account_holder, year, file_type, is_closed
- **Source:** `scripts/upload-r2-index.mjs` populates from local files → R2

#### `qb_general_ledger` — QuickBooks Ledger Data
- **Purpose:** Transaction-level accounting data from QuickBooks
- **Key columns:** account, distribution_account, transaction_date, transaction_type, num, name, memo_description, split, amount, balance
- **Source:** CSV export from QuickBooks via `scripts/ingest-qb-ledger.mjs`
- **Displayed in:** Ledger Notes tab (`/intranet/bookkeeping/ledger-notes`)

#### `app_users` — User Profiles & Roles
- **Migration:** `005_app_users_and_invitations.sql`, `006_simplify_roles.sql`
- **Key columns:** auth_user_id, email, display_name, role (admin/family/accountant/collaborator)
- **Source:** Created on user sign-up, linked to Supabase Auth

#### `user_invitations` — Pre-authorized Sign-ups
- **Key columns:** email, role, invited_by, status (pending/accepted/revoked/expired), expires_at (7 days)
- **Source:** Admin creates invitations in the UI

#### `releases` — Deployment Version Tracking
- **Migration:** `003_users_and_releases.sql`
- **Key columns:** version, release_number, sha, actor, source, commits (JSONB)
- **Source:** CI pipeline (`bump-version.sh`) inserts on every push to main

#### `page_display_config` — Intranet Tab Visibility
- **Migration:** `001_page_display_config.sql`
- **Key columns:** section, tab_key, tab_label, is_visible, sort_order
- **Source:** Admin UI toggle

#### `thoughts` — AI Semantic Memory (Open Brain)
- **Migration:** `002_open_brain.sql`
- **Key columns:** content (text), embedding (vector[768]), metadata (JSONB)
- **Requires:** pgvector extension
- **Function:** `match_thoughts()` for cosine similarity search
- **Source:** `ingest-thought` edge function, Google Gemini embeddings

### Key Functions

| Function | Purpose | Access |
|---|---|---|
| `is_admin()` | Check if current user is admin | Internal |
| `list_auth_users()` | List all auth users with metadata | Admin only |
| `list_app_users()` | List app_users with auth details | Admin only |
| `update_user_role()` | Change user role | Admin only |
| `match_thoughts()` | Semantic vector search | Service role |

---

## 3. Cloudflare D1 — Session Archive

**Database:** `claude-sessions`
**Worker:** https://claude-sessions.finleg.workers.dev
**Config:** `/cloudflare/claude-sessions/wrangler.jsonc`

| Column | Type | Purpose |
|---|---|---|
| id | TEXT PK | Session ID |
| session_json | TEXT | Full JSONL transcript |
| tokens | INTEGER | Total token usage |
| model | TEXT | Claude model used |
| duration_minutes | INTEGER | Session length |
| project | TEXT | Project path |
| started_at, ended_at | DATETIME | Timestamps |

**Source:** Claude Code session hook (`save-session.sh`) posts to Worker API
**Displayed in:** `/sessions` page

---

## 4. QuickBooks Online API (Production)

**Company:** Sonnad Financial (Realm ID: `123146509258379`)
**App:** "ClaudeCoded" — Intuit Developer Portal
**Status:** Production approved, API verified 2026-03-16

### Architecture

```
┌──────────────────┐     OAuth 2.0      ┌──────────────────────────┐
│  Local Scripts    │ ◄──refresh token──► │  Intuit OAuth Server     │
│  (test-qb.mjs)   │     exchange        │  oauth.platform.intuit   │
└────────┬─────────┘                     └──────────────────────────┘
         │ access token
         ▼
┌──────────────────────────────────────────────────────────────────┐
│              QuickBooks API (quickbooks.api.intuit.com)          │
│  CompanyInfo │ Accounts │ GeneralLedger │ Purchases │ Deposits  │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Supabase Database                            │
│  qb_tokens │ qb_general_ledger │ qb_transactions │ category_rules│
└──────────────────────────────────────────────────────────────────┘
```

### Authentication

1. **Get initial tokens:** [OAuth Playground](https://developer.intuit.com/app/developer/playground) → authorize → get refresh token
2. **Save refresh token:** `local.env` → `QUICKBOOKS_REFRESH_TOKEN`
3. **Scripts auto-refresh:** Exchange refresh token → new access token (1hr) + rotated refresh token
4. **Token expiry:** Refresh tokens last 100 days. Re-authorize via Playground if expired.

### Credentials

| Secret | Location |
|---|---|
| Client ID (prod) | 1Password → Family Tax → "QuickBooks Dev - ClaudeCoded" → Production |
| Client Secret (prod) | Same (note: lowercase `l` at position 9: `HoxaRk9w1l1...`) |
| Refresh Token | `local.env` → auto-rotated on each use |
| Realm ID | `123146509258379` |

### API Endpoints Used

| Endpoint | Purpose | Script |
|---|---|---|
| `GET /v3/company/{realm}/companyinfo/{realm}` | Company info | `test-quickbooks.mjs` |
| `GET /v3/company/{realm}/query?query=SELECT * FROM Account` | Chart of Accounts (196 accounts) | `test-quickbooks.mjs` |
| `GET /v3/company/{realm}/reports/GeneralLedger` | Full GL report | `test-quickbooks.mjs` |
| `GET /v3/company/{realm}/query?query=SELECT * FROM Purchase` | Expenses | `qb-sync` edge fn |
| `GET /v3/company/{realm}/query?query=SELECT * FROM Deposit` | Deposits | `qb-sync` edge fn |
| `GET /v3/company/{realm}/query?query=SELECT * FROM Transfer` | Transfers | `qb-sync` edge fn |

### Data Verified (2026-03-16)

| Metric | API | Supabase (CSV) | Notes |
|---|---|---|---|
| Transaction rows | 13,058 | 9,229 | Different date ranges |
| Accounts | 139 | 121 | API covers more |
| Date range | 2024-01-01 → 2025-12-31 | 2025-01-01 → 2026-03-11 | API adjustable |

### How to Use

```bash
# Test API connectivity + fetch GL (saves to qb-general-ledger-api.json)
node scripts/test-quickbooks.mjs

# If refresh token expired, get new one from:
# https://developer.intuit.com/app/developer/playground
# Then update QUICKBOOKS_REFRESH_TOKEN in local.env

# Sync transactions via edge function (after tokens stored in qb_tokens)
curl -X POST https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/qb-sync
```

---

## 5. External APIs

| API | Base URL | Purpose | Auth |
|---|---|---|---|
| QuickBooks API | `https://quickbooks.api.intuit.com` | GL, transactions, accounts | OAuth 2.0 Bearer |
| File Vault API | `https://files.alpacaplayhouse.com` | File search, preview, thumbnails from RVAULT20 drive | Bearer token |
| Claude Sessions | `https://claude-sessions.finleg.workers.dev` | Session archive CRUD | Bearer token |
| Supabase REST | `https://gjdvzzxsrzuorguwkaih.supabase.co/rest/v1/` | Database queries | Anon key + user JWT |
| Supabase Auth | `https://gjdvzzxsrzuorguwkaih.supabase.co/auth/v1/` | Google OAuth, sessions | Anon key |
| Google Gemini | Google AI API | 768-dim embeddings for Open Brain | API key (edge function secret) |

---

## 6. Data Ingestion Scripts

| Script | Input | Output | Purpose |
|---|---|---|---|
| `upload-r2-index.mjs` | Local accounting files (1,880) | R2 objects + `document_index` rows | Organize & upload financial docs |
| `ingest-qb-ledger.mjs` | QuickBooks CSV export | `qb_general_ledger` table | Import accounting transactions |
| `fix-missing-index.mjs` | Supabase gaps | `document_index` rows | Repair missing index entries |
| `verify-index.mjs` | `document_index` table | Console output | Validate metadata breakdown |
| `bump-version.sh` | Git history | `version.json` + `releases` table | CI version tracking |

---

## 7. Deployment

**Platform:** GitHub Pages (static export)
**URL:** https://rahuliofam.github.io/finleg/ (also https://finleg.net)
**CI:** Two GitHub Actions workflows:
1. `deploy.yml` — Build Next.js → static `out/` → deploy to Pages
2. `bump-version-on-push.yml` — Auto-increment version + insert `releases` row

**GitHub Secrets:**
- `SUPABASE_DB_URL` — Direct DB connection for version bumping

---

## 8. Data Counts (as of 2026-03-15)

| Dimension | Breakdown |
|---|---|
| **By Bucket** | financial-statements: 1,337 / bookkeeping-docs: 543 |
| **By Category** | statements: 1,337 / tax: 253 / property: 185 / credit-report: 46 / insurance: 40 / reference: 10 / backup: 9 |
| **By Account Type** | closed: 274 / credit-card: 254 / tax: 253 / property: 185 / brokerage: 138 / payment: 137 / checking: 126 / sba-loan: 86 / ira: 80 / heloc: 69 / mortgage: 56 / credit-report: 46 / auto-loan: 36 / credit-line: 19 / summary: 10 / accounting-software: 9 / crypto: 8 / trust: 54 |
| **By Institution** | various: 581 / charles-schwab: 299 / irs: 253 / us-bank: 150 / chase: 137 / sba: 86 / amex: 66 / paypal: 61 / robinhood: 43 / venmo: 38 / cash-app: 38 / apple: 36 / pnc: 56 / internal: 10 / quickbooks: 9 / bank-of-america: 9 / coinbase: 8 |
| **By Year** | 2025: 339 / 2023: 345 / 2024: 344 / 2021: 338 / 2022: 290 / 2026: 44 / 2020: 41 / 2019: 7 |

---

## 9. Future: Statement Data Tables

Files flagged with `convertible=true` (10 reference spreadsheets) are candidates for Supabase table ingestion. Additionally, bank/brokerage/loan PDF statements will be parsed into transaction tables with line-item data, tagged with source statement metadata (institution, account number, date).
