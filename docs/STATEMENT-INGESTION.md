# Statement Data Ingestion Plan

> **Goal:** Parse checking and credit card PDF statements from Cloudflare R2, extract transaction-level data, store in Supabase tables so statements can be recreated from the database.

---

## Phase 1: Checking + Credit Card Statements

### Scope

| Account Type | Count | Institutions |
|---|---|---|
| **Credit Cards** | 254 statements | Amex (Blue Preferred, Blue Business), Apple Card, Chase Amazon CC, Chase Visa CC (Subhash), BofA CC (Subhash), Robinhood Gold Card |
| **Checking** | 126 statements | Schwab Checking (Rahul), US Bank Checking (Rahul) |
| **Total** | ~380 PDFs to parse | |

**Excluded from Phase 1:** Brokerage (138), Payment/Venmo/PayPal/CashApp (137), IRA (80), HELOC (69), Mortgage (56), Trust (54), Auto Loan (36), SBA Loan (86), Crypto (8), Credit Line (19), Closed accounts (274 — many overlap with above).

---

## Step 1: Analyze PDF Formats

Before creating tables, you need to understand the actual data in each statement type. Statements vary significantly by institution.

### How to Analyze

1. **Download 1 sample PDF per account** from R2 using `wrangler r2 object get`:
   ```bash
   # Example: get one Amex statement
   wrangler r2 object get financial-statements/credit-cards/amex-blue-preferred-24006/2025-01-statement.pdf --file /tmp/sample-amex.pdf

   # Example: get one US Bank checking statement
   wrangler r2 object get financial-statements/bank-accounts/us-bank-checking-7444/2025-01-statement.pdf --file /tmp/sample-usbank.pdf
   ```

2. **Read each PDF** and document the fields present:
   - Statement date / period (start date, end date)
   - Account summary (previous balance, payments, credits, new charges, new balance, minimum due, due date)
   - Transaction rows: date, posting date, description, amount, category, reference number
   - Interest charges, fees, rewards (credit cards)
   - Running balance (checking accounts)

3. **Note differences across institutions** — each bank formats statements differently:
   - Amex: transactions grouped by card member, has reference numbers
   - Chase: transactions have posting date + transaction date
   - Apple Card: shows Daily Cash rewards per transaction
   - Schwab: shows running balance per transaction
   - US Bank: groups debits and credits separately

### Accounts to Sample (one PDF each)

| R2 Path | Institution | Type |
|---|---|---|
| `credit-cards/amex-blue-preferred-24006/` | Amex | Credit Card |
| `credit-cards/amex-blue-business-11003/` | Amex | Credit Card |
| `credit-cards/apple-card-2202/` | Apple | Credit Card |
| `credit-cards/chase-amazon-cc-4206/` | Chase | Credit Card |
| `credit-cards/chase-visa-cc-7191/` | Chase (Subhash) | Credit Card |
| `credit-cards/boa-cc-6420/` | BofA (Subhash) | Credit Card |
| `credit-cards/robinhood-gold-card-3892/` | Robinhood | Credit Card |
| `bank-accounts/schwab-checking-3711/` | Schwab | Checking |
| `bank-accounts/us-bank-checking-7444/` | US Bank | Checking |

---

## Step 2: Create Supabase Tables

After analyzing, create these tables. The schemas below are a starting point — adjust column types and add/remove fields based on what the actual PDFs contain.

### Table: `cc_statement_summaries`

One row per credit card statement. Captures the summary box at the top of each statement.

```sql
CREATE TABLE cc_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Statement identity (link back to source)
  document_id UUID REFERENCES document_index(id),
  institution TEXT NOT NULL,          -- 'amex', 'chase', 'apple', etc.
  account_name TEXT NOT NULL,         -- human-readable
  account_number TEXT,                -- last 4 or masked
  account_holder TEXT,                -- 'Rahul', 'Subhash'

  -- Statement period
  statement_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,

  -- Summary amounts
  previous_balance NUMERIC(12,2),
  payments_credits NUMERIC(12,2),
  new_charges NUMERIC(12,2),
  fees NUMERIC(12,2),
  interest_charged NUMERIC(12,2),
  new_balance NUMERIC(12,2),
  minimum_due NUMERIC(12,2),
  payment_due_date DATE,
  credit_limit NUMERIC(12,2),
  available_credit NUMERIC(12,2),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE cc_statement_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON cc_statement_summaries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service write" ON cc_statement_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### Table: `cc_transactions`

One row per credit card transaction line item.

```sql
CREATE TABLE cc_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to statement
  summary_id UUID REFERENCES cc_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  -- Source tagging (denormalized for easy querying)
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,
  statement_date DATE NOT NULL,

  -- Transaction data
  transaction_date DATE NOT NULL,
  posting_date DATE,               -- some institutions show this
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,   -- positive = charge, negative = credit/payment
  reference_number TEXT,           -- Amex has this
  category TEXT,                   -- if institution categorizes (e.g., Apple Card)

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cc_txn_summary ON cc_transactions(summary_id);
CREATE INDEX idx_cc_txn_institution ON cc_transactions(institution);
CREATE INDEX idx_cc_txn_date ON cc_transactions(transaction_date);
CREATE INDEX idx_cc_txn_stmt_date ON cc_transactions(statement_date);

ALTER TABLE cc_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON cc_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service write" ON cc_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### Table: `checking_statement_summaries`

One row per bank statement.

```sql
CREATE TABLE checking_statement_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Statement identity
  document_id UUID REFERENCES document_index(id),
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,

  -- Statement period
  statement_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,

  -- Summary amounts
  beginning_balance NUMERIC(12,2),
  total_deposits NUMERIC(12,2),
  total_withdrawals NUMERIC(12,2),
  fees NUMERIC(12,2),
  interest_earned NUMERIC(12,2),
  ending_balance NUMERIC(12,2),

  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE checking_statement_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON checking_statement_summaries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service write" ON checking_statement_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### Table: `checking_transactions`

One row per checking account transaction.

```sql
CREATE TABLE checking_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to statement
  summary_id UUID REFERENCES checking_statement_summaries(id) ON DELETE CASCADE,
  document_id UUID REFERENCES document_index(id),

  -- Source tagging (denormalized)
  institution TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,
  statement_date DATE NOT NULL,

  -- Transaction data
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,   -- positive = deposit, negative = withdrawal
  running_balance NUMERIC(12,2),   -- if shown on statement
  check_number TEXT,               -- for check transactions
  transaction_type TEXT,           -- 'deposit', 'withdrawal', 'transfer', 'fee', 'interest', 'check'

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chk_txn_summary ON checking_transactions(summary_id);
CREATE INDEX idx_chk_txn_institution ON checking_transactions(institution);
CREATE INDEX idx_chk_txn_date ON checking_transactions(transaction_date);
CREATE INDEX idx_chk_txn_stmt_date ON checking_transactions(statement_date);

ALTER TABLE checking_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON checking_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service write" ON checking_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

## Step 3: Build the Ingestion Script

### Architecture

```
R2 (PDFs) → Download to /tmp → Claude API (PDF parsing) → Supabase insert
```

### Script: `scripts/ingest-statements.mjs`

The script should:

1. **Query `document_index`** for all statements matching the target account types:
   ```sql
   SELECT * FROM document_index
   WHERE category = 'statement'
     AND account_type IN ('credit-card', 'checking')
   ORDER BY institution, account_name, year, month
   ```

2. **For each statement PDF:**
   a. Download from R2 to `/tmp` using `wrangler r2 object get`
   b. Send PDF to **Claude API** (claude-sonnet-4-6 or claude-opus-4-6) with a structured extraction prompt
   c. Parse the JSON response
   d. Insert summary row + transaction rows into Supabase
   e. Log progress, skip already-ingested statements

3. **Claude API prompt structure:**
   ```
   Extract all data from this bank/credit card statement as JSON.
   Return exactly this structure:
   {
     "summary": {
       "statement_date": "YYYY-MM-DD",
       "period_start": "YYYY-MM-DD",
       "period_end": "YYYY-MM-DD",
       "previous_balance": 1234.56,
       ... (all summary fields)
     },
     "transactions": [
       {
         "transaction_date": "YYYY-MM-DD",
         "posting_date": "YYYY-MM-DD" or null,
         "description": "MERCHANT NAME",
         "amount": -45.67,
         "reference_number": "123456" or null,
         "category": "Dining" or null
       },
       ...
     ]
   }
   Positive amounts = charges/withdrawals. Negative = credits/deposits.
   Include EVERY transaction. Do not summarize or skip any.
   ```

4. **Rate limiting:** Process sequentially or with low concurrency (2-3) to stay within Claude API limits.

5. **Idempotency:** Before inserting, check if `document_id` already exists in summary table. Skip if already ingested.

### Dependencies

```bash
npm install @anthropic-ai/sdk   # Claude API for PDF extraction
# Already have: @supabase/supabase-js
# Already have: wrangler (for R2 access)
```

### Environment Variables Needed

```bash
ANTHROPIC_API_KEY=sk-ant-...      # Claude API key for PDF parsing
# Supabase service key already in upload-r2-index.mjs (can reuse)
```

---

## Step 4: Run Ingestion

```bash
# Dry run first — download + parse 1 PDF per account, log results without inserting
node scripts/ingest-statements.mjs --dry-run --sample

# Full run for credit cards only
node scripts/ingest-statements.mjs --account-type credit-card

# Full run for checking only
node scripts/ingest-statements.mjs --account-type checking

# Full run for both
node scripts/ingest-statements.mjs
```

**Expected runtime:** ~380 PDFs x ~10-15 seconds per PDF (Claude API) = ~1-1.5 hours

**Expected cost:** ~380 PDFs x ~5K tokens output each = ~2M tokens. At Sonnet pricing (~$3/M input, $15/M output with PDF pages): roughly $15-30 total.

---

## Step 5: Update Statements Tab UI

After data is ingested, rewrite `_statements.tsx` to show actual transaction data:

1. **Account list view** (current accordion) — but now shows real transaction counts and date ranges
2. **Statement detail view** — click a statement to see:
   - Summary card (previous balance, charges, payments, new balance)
   - Full transaction table with date, description, amount, running balance
   - Sortable and searchable
3. **Cross-account search** — search transactions across all accounts by description, amount range, or date

---

## Step 6: Future Phases

| Phase | Account Types | Est. Statements |
|---|---|---|
| Phase 1 (this doc) | Credit Cards + Checking | ~380 |
| Phase 2 | Brokerage + IRA + Trust | ~272 |
| Phase 3 | Payment (Venmo, PayPal, Cash App) | ~137 |
| Phase 4 | Loans (Mortgage, HELOC, Auto, SBA) | ~247 |
| Phase 5 | Closed Accounts | ~274 |

Each phase will need its own table schema since brokerage statements have different fields (holdings, dividends, gains/losses) vs loan statements (principal, interest, escrow).

---

## Checklist

- [ ] Download 1 sample PDF per account from R2
- [ ] Read each PDF and document all fields present
- [ ] Finalize table schemas based on actual PDF content
- [ ] Run SQL migration to create tables
- [ ] Write `scripts/ingest-statements.mjs`
- [ ] Dry-run with `--sample` flag
- [ ] Full ingestion run (~1-1.5 hours)
- [ ] Verify data: spot-check 5 statements against original PDFs
- [ ] Rewrite `_statements.tsx` to display transaction data
- [ ] Add cross-account transaction search
