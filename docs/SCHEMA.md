# Database Schema Reference

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Updated by the setup wizard and as tables are added/modified.

## Core Tables

### QuickBooks Integration (migration 015)
```
qb_tokens              - OAuth credentials (realm_id, access/refresh tokens, expiry)
qb_general_ledger      - CSV-imported GL data (~9,288 rows; populated by ingest-qb-ledger.mjs)
qb_transactions        - Synced QB transactions (unique on qb_id + qb_type)
  - is_deleted          - Soft-delete flag for transactions removed from QB
  - matched_statement_txn_id - Cross-source match to statement transactions
receipts               - Email-ingested receipts + AI parsing + QB matching
category_rules         - Vendor → category mapping (learning system)
bookkeeping_activity_log - Audit trail for all bookkeeping actions
```

### Automated Sync & Tasks (migration 016)
```
sync_runs              - Tracks every QB sync execution (type, status, counts)
integrity_findings     - Dynamic data quality issues (auto-generated)
todos                  - Human task queue (from integrity checks, AI, manual)
qb_writeback_queue     - Proposed changes to push back to QB (needs approval)
ai_metrics             - Weekly AI categorization accuracy tracking
```

### Document Index
```
document_index         - R2 file search index (1,880 financial documents)
```

### Statement Data (migrations 009-010)
```
cc_statement_summaries / cc_transactions          - Credit card data
checking_statement_summaries / checking_transactions - Bank data
investment_statement_summaries / holdings_snapshots  - Brokerage data
investment_transactions / realized_gain_loss         - Trades & gains
loan_statement_summaries / loan_transactions         - Loan data
```

### Auth & Config
```
app_users              - User profiles & roles
user_invitations       - Pre-authorized signups
page_display_config    - UI tab visibility
releases               - Deployment tracking
context_snapshots      - Daily context window token usage (devcontrol dashboard)
```

### Open Brain (migration 002)
```
thoughts               - Semantic memory (content, 768-dim embedding, metadata JSONB)
                         Requires pgvector extension; match_thoughts() for similarity search.
```

### Schwab Integration (migrations 021, 026, 027)
```
schwab_tokens          - OAuth tokens, auto-refreshed via Cloudflare Cron every 3 days
schwab_accounts        - 36 family brokerage/IRA/trust accounts with metadata
schwab_api_log         - Full audit trail of API calls
```

### PlaidPlus (migrations 019, 020)
```
plaidplus_*            - Universal financial schema for Robinhood + future Plaid integration.
                         See 019_plaidplus_schema.sql for table list.
```

### Document Extras (migrations 023–025)
```
document_shares        - Auth-gated share links with post-auth redirect
statement_inbox        - Inbound email queue for statement ingestion (from resend-inbound-webhook)
document_extracted_text - Full extracted text (OCR + direct) indexed for search
tax_conflict_resolutions - Interactive conflict resolution via email (process-tax-returns.mjs)
```

### Ops (migrations 017, 017b, 018)
```
backup_logs            - Backup run history (populated by backup-db-to-r2.sh)
pg_cron jobs           - Scheduled QB sync, integrity checks, email digest (see 017b)
page_display_config    - Seeded with 9 bookkeeping tabs in migration 018
```

## Service Config Tables

These are created when optional services are enabled:

```
telnyx_config    - SMS configuration (single row, id=1)
resend_config    - Email configuration
square_config    - Payment processing configuration
signwell_config  - E-signature configuration
```

## Common Patterns

- All tables use UUID primary keys
- All tables have `created_at` and `updated_at` timestamps
- RLS is enabled on all tables
- `is_archived` flag for soft deletes (filter client-side)
