# Changelog

> Reverse chronological. Entries are grouped by date span and rolled up from `git log`. Version-bump commits (`chore: bump version [skip ci]`) are omitted — they happen on every push.

## [2026-03-24 → 2026-03-25]

### Added
- Flow Migration subtab under DevControl planlist, with numbered items and automation setup steps (`b1d70ce`, `6d17e20`).
- QuickBooks token refresh script + improvements to local OAuth server (`7682048`).
- Transactional invitation email sent when admin invites a user (`a570160`, `7b54545`).
- Remote-access runbook for Hostinger VPS and Alpuca Mac (`9bedcf4`, `docs/REMOTE-ACCESS.md`).
- Supabase CLI multi-account instructions in `CLAUDE.md` (`81d363e`).

### Fixed
- "Sign In" buttons now trigger Google OAuth directly instead of bouncing through `/signin` (`70b37df`).

## [2026-03-19 → 2026-03-20]

### Added
- Schwab brokerage integration: full OAuth flow via Cloudflare Worker callback router, 36 family accounts populated with metadata, `schwab_api_log` table for full API audit trail, Cloudflare Cron auto-refresh every 3 days (`3e62090`, `26b175f`, `94fcd29`, `cb3bc64`).
- Schwab-replica brokerage UI: pixel-perfect Account Summary, alternating-row shading, group accent borders, Total Value chart with axes + time periods, real data wiring, date range switching (`c1006b5`, `c372f8d`, `c536da6`, `c226902`, `2bbd657`, `09f2f7e`).
- Interactive conflict resolution via email for tax-return extraction (`c670219`).
- OCR for scanned image-only PDFs: Claude CLI variant + Gemini 2.5 Flash variant (`5ab31e6`, `f082c84`).
- Full document-text extraction stored in DB, with indicator + viewer in File Vault (`6c64503`, `81988f6`).
- Upload script for legal migration docs from Google Drive (`a03d67d`).

### Fixed
- Use registered `portsie.com` callback URL for Schwab OAuth (`a2408d6`, `3e62090`).
- Correct OAuth callback redirect URL + improve token storage (`917bf40`).
- R2 file URLs now use the `workers.dev` URL instead of an unconfigured custom domain (`ab0a3ee`).
- Card layout for conflict emails: buttons under each value (`860edec`).

## [2026-03-17 → 2026-03-18]

### Added
- Email-to-statement ingestion pipeline: inbound email via Resend → PDF attachment → Claude extraction → Supabase tables → summary email back to sender (`b125104`, `6147d60`, `bc56661`, `63b0387`, `1bc745a`, `745cf3b`).
- AI-powered session search using Gemini Flash (`e28c365`).
- R2 files Cloudflare Worker deployed; File Vault URL references fixed (`acb860d`).
- Zeni analysis tab with 5 financial features (`c9305c9`).
- Personal dashboard page with user-first-name tab (`562dee7`).
- Document sharing: auth-gated share links with post-auth redirect, inline share in statement dialog, copy-feedback checkmark (`eebb3a0`, `ab583cf`, `c85e26e`, `801e37c`).
- AI summary tooltip on hover over file names (`f40476a`).
- Holder first-name mapping and clickable file icon in detail modal (`a24d81c`).
- 90-day token-history chart on DevControl context page (`8d0e446`).
- Schwab callback router Worker for dynamic OAuth target switching (`0b0677a`).
- Context Window page showing files loaded into Claude's context (`1cae9c7`, `b47a720`).
- "How It Works" section with Components, Nuts & Bolts, AutoActions, Security, and data-flow diagram tabs (`da585ba`, `0d85fe5`, `723dc51`, `a77b206`, `a7691e3`).
- Backups page under DevControl with activity logging (`8934957`).
- Tokens page and restored sessions data on DevControl (`1825736`).

### Changed
- Replaced raw email forward with processing-summary email (`bc56661`).
- Renamed DevControl's "todo" tab to "planlist" (`b0312b7`).
- Renamed "clauded" section to "devcontrol" throughout (`f45cdcc`, `f8fa10d`).
- Moved DevControl into dashboard as section tab with sub-tabs (`d7b8485`).
- Migrated all 1Password references to Bitwarden; removed 1Password from Security page (`3bb26cb`, `2a64411`).
- Replaced wrangler CLI with S3-compatible API for R2 uploads in `process-inbox.mjs` (`100cc77`).
- Added TOC tab as DevControl landing page, retheme sub-tabs to light mode (`a3c6404`).

### Fixed
- Session "ask" button: switched from Gemini to Workers AI (`54047db`).
- Resend attachment download: fetch via API rather than expect inline base64 (`f9659cd`, `ea871f9`).
- Gemini model name + debug diagnostics in inbound webhook (`a34969f`).
- File Vault sort by `statement_date`; show year-month when `statement_date` is null; extract date from filename when both are null; sort institutions dropdown alphabetically (`522797a`, `2f3a223`, `0be2710`, `4d977c0`).
- Dark-mode contrast across DevControl pages (`c158f7c`, `d5cbeed`).
- Show all 69 Bitwarden vault folders in Security tab (`2799734`).
- Seed all 9 bookkeeping tabs + merge defaults to fix missing tab nav (`4f064bb`, `14204ba`).
- Copy-feedback `copiedId` type mismatch (`801e37c`).
- Remove hardcoded secrets from `schwab-manual-auth` script (`287132a`).

## [2026-03-16]

### Added
- Backup & recovery infrastructure: `backup-db-to-r2.sh`, pre-migration dump helper, `docs/BACKUP-RECOVERY.md` (`9c814b7`, `a64d78a`).
- R2 + DB backup sync to RVAULT20 on Alpaca Mac (`c146d7e`).
- QuickBooks automated sync architecture: AI categorization, integrity checks, self-improving workflow, `qb-sync-scheduled` edge function, pg_cron schedules (`487acb3`, `9a8b59c`, `c28ec39`).
- QuickBooks production API integration + test script (`6cb0ea1`).
- QB GL comparison script with R2 upload support (`0c91818`).
- Photo caption operations runbook (`docs/PHOTO-CAPTION-OPERATIONS.md`) for Moondream 2 nightly job on MacBook Air M4 (`05beeed`).
- PlaidPlus universal financial schema (migration `019`) with Robinhood compatibility (`0dde741`).
- Moved `todo.html` to Next.js page at `/todo`; moved to `/clauded/todo` hub (`acf8c3a`, `383a4e6`).

### Changed
- Migrated Cloudflare Workers + D1 from `alpacapps` to finleg account (`0af1688`); updated R2 account refs and added migration cleanup doc (`docs/R2-MIGRATION-CLEANUP.md`, `8e69f30`).
- Prefer pg17 in backup script; support direct DB connection (`a5ddfd8`).
- Added `.gstack/` to gitignore (`fcaea7d`).

## [2026-03-15]

### Added
- **File Vault**: uploaded 1,880 accounting files to R2 + Supabase search index (`document_index`); rewrote File Vault UI with columnar table, sortable headers, metadata filters, active/archived sections, date ranges (`7fb1969`, `a2da188`, `e6da824`).
- Statement ingestion pipeline + Phase 2 tables (brokerage, loan, etc.) (`3d95832`).
- Statements tab under Bookkeeping + `docs/STATEMENT-INGESTION.md` (`577f07d`).
- Family docs uploaded to R2 (legal, taxes, investments, other) (`445b59f`, `0baf8eb`).
- Ledger Notes analysis page under Bookkeeping (`d013db7`).
- QuickBooks General Ledger ingestion script (`397e380`).
- User management with roles, invitations, and access control; simplified roles to admin / family / accountant / collaborator; invitation required for access (`6176eea`, `436b55f`, `469d6bb`, `4c71cb5`).
- DevControl hub (then "clauded") with enhanced changelog + sessions (`f13b724`).
- Releases page rewritten as live changelog from GitHub PRs (`ea11a6a`).
- Uploads summary tab in admin panel (`c641a4d`).
- Legal pages (terms + privacy) and footer links (`c0cf0f5`).
- QuickBooks workflow: receipt ingestion, transaction sync, categorization UI (`fb5a65a`).
- Auto sign-in query param and email sign-in option for automated testing (`36dee6d`, `fd0374f`).
- Gitleaks pre-commit hook (`e00df1e`, `0e8c55e`).
- Security hardening: fixed privilege escalation, data leaks, open endpoints (`5c0d786`).

### Changed
- Moved releases page from `/intranet/admin` to `/clauded/releases` (`b7a8d89`).
- R2 file key + source file name added to all statement summary tables (`d6073c3`).
- Doc extraction rewritten to use Claude CLI headless mode (`f97387b`); timeout error handling per document (`f9da65f`).
- All scripts converted to dotenv + `process.env`; hardcoded Supabase service-role key removed from source (`cc37352`, `40906f6`).

### Fixed
- `extractDate` parsing account numbers as years (`e030dec`).
- Account expand showing statements in wrong position (`fd9cdc4`).
- Ledger Notes showed double-entry totals instead of actual spending (`39f3479`).
- Redirect authenticated users from landing page to dashboard (`beb3458`).
- Deploy after version bump so version number is correct (`76cac97`).
- Unreadable file detail modal contrast (`260b352`).

## [2026-03-14]

Project inception. Forked from `alpacapps-infra` template and rapidly specialized for Finleg.

### Added
- Initial commit from template (`2c2ff11`).
- `CNAME` for `finleg.net` custom domain (`efbcfff`).
- Inbound email webhook to forward `@finleg.net` to Gmail (`6280e65`, `2922df1`).
- Updates page + `sync-updates` skill for template feature adoption (`3444787`).
- Auto update checker with manifest, admin banner, and infra page prompt (`7eb40f0`).
- Modern Finleg homepage with branding, Google auth, slogan; Playfair Display wordmark + Finleg logo (`ab4a3bd`, `711ff70`).
- GitHub Actions workflow to build and deploy Next.js to Pages (`2a4981b`).
- **Open Brain**: semantic AI memory with Slack capture and MCP server (`c4a3770`).
- **Claude sessions viewer** at `finleg.net/sessions`; session cards + transcript/copy/share; AuthGuard on sensitive views; new-tab detail view (`86ef67d`, `5d65bb8`, `daef222`, `c903fad`, `9f198b2`).
- **File Vault** page with Google auth for family access; split into Photos / General Files / Financial & Legal tabs; user dropdown filter; Google Drive account integration (Tesloop, Rahulioson) (`099ff20`, `9b67d74`, `318b29e`, `78e77d4`).
- Admin tab pages: Users, Releases, Brand (`a4dbcd5`).
- Intranet header with Finleg logo, dynamic version, green theme (`1753613`).
- Open Graph + Twitter Card meta tags; OG image enlargements (`8ef79c2`, `14adf99`, `a1f3d65`).
- `local.env` added to gitignore to protect credentials (`f3039d0`).

### Changed
- **Removed i18n system**; flattened routes to drop `/en/` prefix (`330f652`).
- Unified navbar: dark green (`#0f3d1e`) everywhere, white wordmark + green-tinted text, stacked logo, auth status (email + Sign Out) visible, Dashboard positioned left of Sessions (`1a390e7`, `794824e`, `ba4fe77`, `2647476`, `c69a395`, `0a44b6c`).
- Centered homepage layout; various hero-alignment and sizing adjustments (`ba4fe77`, `5055924`, `f72714f`, `18030f8`, `7f433a9`, `7899509`, `49792ec`).
- Simplified homepage: removed features/CTA sections, boosted logo visibility; updated tagline to "Not for public consumption"; wordmark visibility via `mix-blend-screen` (`d2c9a98`, `eace924`, `c4a3770`).
- Excluded `supabase/` from `tsconfig` to fix build (`63a32b9`).

### Fixed
- Sessions auth: OAuth redirect returns to original page; guard removed from public sessions page; guard restored where sensitive data is shown (`3fab5fb`, `c400b55`, `104c0e7`).
- No-op `css:build` npm script added so bump-version CI works against both template (vanilla) and finleg (Next.js) setups (`266d183`).

## Initial Setup

- Project created from [`alpacapps-infra`](https://github.com/rsonnad/alpacapps-infra) template on 2026-03-14.
- Core services configured via `/setup-alpacapps-infra`.
