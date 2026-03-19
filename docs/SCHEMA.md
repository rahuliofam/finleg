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
context_snapshots      - Daily context window token usage (devcontrol dashboard)
```

### Tax Returns (migration 024)
```
tax_entities                        - People, trusts, estates that file returns
tax_entity_relationships            - Links between entities (trustee, beneficiary, spouse, dependent)
tax_returns                         - One row per filed return (envelope with summary numbers)
tax_return_documents                - Links returns to source PDF files

-- Form 1040 (Individual)
tax_form_1040                       - Full Form 1040 line items (income, deductions, tax, payments)
tax_form_1040_dependents            - Dependents listed on Form 1040
tax_schedule_1                      - Schedule 1: Additional Income & Adjustments
tax_schedule_2                      - Schedule 2: Additional Taxes (AMT, SE, NIIT)
tax_schedule_c                      - Schedule C: Business Profit/Loss (one per business)
tax_schedule_c_other_expenses       - Schedule C Part V: Itemized other expenses
tax_schedule_d                      - Schedule D: Capital Gains and Losses
tax_form_8949_transactions          - Form 8949: Individual capital asset sale transactions
tax_schedule_e_rental_properties    - Schedule E Part I: Rental property income/expenses
tax_schedule_e_partnerships         - Schedule E Part II: K-1 income from partnerships/S corps
tax_schedule_e_estates_trusts       - Schedule E Part III: K-1 income from trusts/estates
tax_schedule_e_summary              - Schedule E summary totals
tax_schedule_se                     - Schedule SE: Self-Employment Tax
tax_form_4562                       - Form 4562: Depreciation summary per business/property
tax_form_4562_assets                - Form 4562: Individual depreciable assets
tax_form_8962                       - Form 8962: Premium Tax Credit (ACA)
tax_form_8962_monthly               - Form 8962: Monthly PTC breakdown

-- Form 1041 (Trusts/Estates)
tax_form_1041                       - Full Form 1041 line items
tax_form_1041_schedule_b            - Schedule B: Income Distribution Deduction
tax_form_1041_schedule_g            - Schedule G: Tax Computation & Payments
tax_form_1041_schedule_i            - Schedule I: Alternative Minimum Tax
tax_form_1041_schedule_j            - Schedule J: Accumulation Distribution

-- Cross-form
tax_form_8995                       - Form 8995: QBI Deduction (summary)
tax_form_8995_businesses            - Form 8995: Per-business QBI detail
tax_schedule_k1                     - Schedule K-1: Beneficiary/partner income shares
tax_return_line_items               - Catch-all for any form line not in a typed table
tax_property_depreciation_schedules - Property-level depreciation master records
tax_property_depreciation_components - Cost segregation components per property

-- AI Analysis Views
tax_income_summary_by_year          - Cross-year income/tax comparison per entity
tax_rental_property_summary         - Rental property P&L across years
tax_business_income_summary         - Schedule C business performance across years
tax_capital_gains_summary           - Capital gains/losses across years
```

### Tax Field Registry (migration 025)

Extensibility layer that makes the tax schema handle ANY form type without new DDL.
New forms (706, 709, state returns, etc.) are added by inserting rows into the registry.

```
tax_form_registry                   - Catalog of all known forms (one row per form-version)
  - form_code                        - IRS form number: '1040', '706', 'CA_540'
  - form_category                    - individual, trust, estate, gift, partnership, scorp, state, etc.
  - tax_year_start/end               - Version window (field_key stable across versions)
  - has_typed_table                  - Whether migration 024 has a dedicated typed table
  - typed_table_name                 - e.g. 'tax_form_1040' (NULL for EAV-only forms)

tax_field_registry                  - Every field on every form, with LLM metadata
  - field_key                        - Stable identifier: 'adjusted_gross_income'
  - label                            - Exact IRS text: 'Adjusted gross income (AGI)'
  - description                      - Extended context for LLM interpretation
  - irs_line_number / irs_form_part  - Form location: '11', 'Income'
  - data_type / unit                 - numeric/usd, text, boolean, enum, date
  - typed_table_column               - Maps to column in typed table (NULL for EAV-only)
  - computation_rule                 - Human-readable formula
  - mef_xpath                        - IRS MeF XML path (for future e-file integration)
  - is_computed / is_summary         - Behavioral flags for AI

tax_return_line_items               - (UPGRADED) Now has field_registry_id FK
  - field_registry_id                - Links to tax_field_registry for metadata

-- Seeded form definitions:
-- Typed (migration 024):  1040, 1041, Schedule 1/2/C/D/E/SE, Forms 4562/8949/8962/8995, K-1
-- EAV-only (new):         Form 706 (estate), 709 (gift), Schedule A, CA-540, 1065, 1120S

-- AI Views
tax_form_field_catalog              - Browse all registered forms and fields (LLM discovery)
tax_all_fields                      - Unified view merging typed tables + EAV (single query surface)
```

#### Query patterns for AI

```sql
-- Discover what fields exist for a form
SELECT field_key, label, irs_line_number FROM tax_form_field_catalog WHERE form_code = '706';

-- Get all data for a return (typed + EAV unified)
SELECT form_code, field_key, label, value_numeric FROM tax_all_fields WHERE entity_name = 'Rahul Sonnad' AND tax_year = 2023;

-- Compare AGI across years
SELECT entity_name, tax_year, value_numeric FROM tax_all_fields WHERE field_key = 'adjusted_gross_income' ORDER BY entity_name, tax_year;
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
