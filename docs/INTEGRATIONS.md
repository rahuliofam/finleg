# External Services & Integrations

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Each section is added by the setup wizard when a service is configured.

## API Cost Accounting (REQUIRED)

**Every feature that makes external API calls MUST log usage for cost tracking.**

When building or modifying any feature that calls a paid API, instrument it to log each API call with its cost data.

## Configured Services

<!-- Services are added below by the setup wizard -->

### QuickBooks Online (Intuit)

**Production API integration for general ledger replication and transaction sync.**

- **Intuit App:** "ClaudeCoded" under workspace "ClaudeQuick"
- **Intuit Developer Portal:** https://developer.intuit.com/app-create?id=9341456609040039
- **Production Realm ID:** `123146509258379`
- **Sandbox Company ID:** `9341456611570780`
- **API Base (prod):** `https://quickbooks.api.intuit.com`
- **API Base (sandbox):** `https://sandbox-quickbooks.api.intuit.com`

**Credentials:**

| Credential | Location |
|---|---|
| Production Client ID + Secret | 1Password → Family Tax → "QuickBooks Dev - ClaudeCoded" → Production section |
| Sandbox Client ID + Secret | 1Password → Family Tax → "QuickBooks Dev - ClaudeCoded" → Environment section |
| Refresh Token (production) | `local.env` → `QUICKBOOKS_REFRESH_TOKEN` (auto-rotated on each use) |
| Realm ID | `local.env` → `QUICKBOOKS_REALM_ID` |

> **Important:** The 1Password production Client Secret contains a lowercase `l` (not capital `I`) at position 9: `HoxaRk9w1l1...`

**OAuth Flow:**

1. **Initial auth:** Use the [OAuth Playground](https://developer.intuit.com/app/developer/playground) to get access + refresh tokens
2. **Ongoing:** Scripts use refresh token → fresh access token (access tokens expire in 1 hour)
3. **Token rotation:** Each refresh returns a new refresh token — scripts auto-save to `local.env`
4. **Refresh token expiry:** 100 days unused. Re-authorize via OAuth Playground if expired.

**Redirect URIs:** `http://localhost:3000/callback` (Development tab only). Production tab not yet configured.

**Scripts:**

| Script | Purpose |
|---|---|
| `scripts/test-quickbooks.mjs` | Test API: CompanyInfo + Chart of Accounts + General Ledger report |
| `scripts/qb-oauth-server.mjs` | Local OAuth callback server (port 3000) for browser-based OAuth |
| `scripts/ingest-qb-ledger.mjs` | Import QB General Ledger CSV → Supabase `qb_general_ledger` |

**Edge Functions:**

| Function | Purpose | Method |
|---|---|---|
| `supabase/functions/qb-sync/index.ts` | Sync purchases/deposits/transfers → `qb_transactions` | POST |

Edge function secrets: `SUPABASE_SERVICE_ROLE_KEY`, `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENVIRONMENT`

**Database Tables:**

| Table | Purpose |
|---|---|
| `qb_tokens` | OAuth tokens per realm_id (used by edge functions for auto-refresh) |
| `qb_general_ledger` | CSV-imported GL data (9,288 rows as of 2026-03-15) |
| `qb_transactions` | API-synced transactions (purchases, deposits, transfers) |
| `category_rules` | Vendor pattern matching for auto-categorization |
| `receipts` | Email-ingested receipt attachments |
| `bookkeeping_activity_log` | Audit trail for sync/categorization |

**Env vars** (in `local.env`, gitignored):
```env
QUICKBOOKS_CLIENT_ID=...          # From Intuit portal
QUICKBOOKS_CLIENT_SECRET=...      # From Intuit portal (note: lowercase l, not I)
QUICKBOOKS_ENVIRONMENT=production  # or "sandbox"
QUICKBOOKS_REALM_ID=...           # Company ID
QUICKBOOKS_REFRESH_TOKEN=...      # Auto-rotated; initial from OAuth Playground
```

### Email (Resend)
- API key stored as Supabase secret: `RESEND_API_KEY`
- Free tier: 3,000 emails/month

### SMS (Telnyx)
- Config in `telnyx_config` table
- Edge functions: `send-sms`, `telnyx-webhook` (deploy with `--no-verify-jwt`)
- Cost: ~$0.004/message

### Payments (Square)
- Config in `square_config` table
- Edge function: `process-square-payment`
- Cost: 2.9% + 30c

### Payments + ACH (Stripe)
- Config in `stripe_config` table
- ACH: 0.8% capped at $5; Cards: 2.9% + 30c

### E-Signatures (SignWell)
- Config in `signwell_config` table
- Edge function: `signwell-webhook` (deploy with `--no-verify-jwt`)
- Free tier: 3-25 docs/month

### AI Features (Google Gemini)
- Free tier: 1,000 requests/day, 15 RPM

### Object Storage (Cloudflare R2)
- Free tier: 10 GB storage, 10M reads/mo, 1M writes/mo, zero egress

## Supabase Project

- **Project ID:** `gjdvzzxsrzuorguwkaih`
- **URL:** `https://gjdvzzxsrzuorguwkaih.supabase.co`
- **Dashboard:** https://supabase.com/dashboard/project/gjdvzzxsrzuorguwkaih
- **Anon Key:** Hardcoded in `shared/supabase.js` (public, safe to expose)
- **Service Role Key:** `local.env` / `.env` → `SUPABASE_SERVICE_ROLE_KEY`
- **DB Password:** `local.env` / `.env` → `SUPABASE_DB_PASSWORD`
- **DB Host:** `aws-1-us-east-2.pooler.supabase.com:6543`
- **DB User:** `postgres.gjdvzzxsrzuorguwkaih`

<!-- Only the services you selected during setup will be active -->
