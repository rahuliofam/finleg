# Database Schema Reference

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Updated by the setup wizard and as tables are added/modified.

## Core Tables

### QuickBooks Integration (migration 015)
```
qb_tokens              - OAuth credentials (realm_id, access/refresh tokens, expiry)
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
