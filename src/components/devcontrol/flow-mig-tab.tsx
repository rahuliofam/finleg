"use client";

export function FlowMigTab() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Flow Migration</h1>
        <p className="text-sm text-slate-500">
          Bookkeeper tasks to automate — migration from manual human workflows to AI-driven flows
        </p>
      </div>

      <div className="border border-amber-200 bg-amber-50 rounded-xl p-4">
        <p className="text-sm font-semibold text-amber-800">
          Goal: Eliminate the need for a human bookkeeper by automating every remaining manual task.
        </p>
      </div>

      {/* --- HIGH FREQUENCY --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3">High-Frequency Manual Work</h2>
        <div className="space-y-4">

          <FlowCard
            num={1}
            id="tx-categorize"
            title="Transaction Categorization"
            status="partial"
            description="Human reviews and categorizes transactions that AI couldn't auto-categorize with high confidence."
            current="Owner/bookkeeper picks category from dropdown, adds notes, bulk-approves batches."
            target="Raise AI confidence threshold so 95%+ auto-approve. Route only true edge cases to owner via weekly digest quick-actions."
            steps={[
              "Add an AI categorization pass in qb-sync: after rule matching fails and QB has no category, call Claude with vendor name + amount + date + recent similar transactions to predict a category with confidence score.",
              "Store AI predictions with category_source: 'ai' and the model's confidence (0.0–1.0) in qb_transactions.",
              "Auto-approve when AI confidence >= 0.90 AND a matching category_rule exists with 2+ prior hit_count. Set review_status: 'auto_categorized'.",
              "For AI confidence 0.70–0.90: include in weekly digest with one-click quick-action links (already wired via quick-action edge function).",
              "Below 0.70: leave as 'pending' for manual review — but these should be <5% of transactions.",
              "Track accuracy in ai_metrics table. If human overrides exceed 10% in a week, lower the auto-approve threshold temporarily.",
            ]}
          />

          <FlowCard
            num={2}
            id="receipt-match"
            title="Receipt-to-Transaction Matching"
            status="partial"
            description="Receipts emailed to agent@finleg.net are parsed by Claude but ambiguous matches still need human review."
            current="Human finds match candidates by amount (+-$1) and date (+-10 days), then links them."
            target="Auto-match when exactly one candidate exists. Surface ambiguous matches in digest for one-click confirm."
            steps={[
              "resend-inbound-webhook already auto-matches receipts with score >= 0.5. Raise auto-approve threshold: if exactly 1 candidate AND match score >= 0.8, auto-link with review_status: 'auto_categorized' (already done).",
              "Add vendor name fuzzy matching to the scoring function — currently only uses amount (0.6 weight) + date proximity (0.2) + vendor similarity (0.2). Improve vendor similarity with Levenshtein distance or normalized containment check.",
              "When multiple candidates exist (score 0.5–0.8): include top 2 candidates in weekly digest email with quick-action links for each. User clicks the correct one.",
              "When zero candidates exist: hold receipt in 'unmatched' status and re-check against new QB transactions on next daily sync. Auto-match if a new transaction appears within 10 days.",
              "Add a 'no-match expected' category for receipts that won't have a QB transaction (e.g., cash purchases). Owner can dismiss via digest quick-action.",
            ]}
          />

          <FlowCard
            num={3}
            id="integrity-resolve"
            title="Integrity Finding Resolution"
            status="manual"
            description="Weekly integrity check generates findings (uncategorized >7d, missing receipts >$75, duplicates, stale accounts)."
            current="Human reviews each finding in Ledger Notes tab and marks as resolved."
            target="Auto-resolve informational findings. Auto-dismiss duplicates below threshold. Only surface critical findings."
            steps={[
              "qb-integrity-check already auto-resolves findings that no longer appear on re-check. Extend this: auto-resolve 'info' severity findings after 14 days if no action taken.",
              "For 'missing_receipt' findings: check if a receipt arrived in the receipts table since the finding was created. If yes, auto-resolve with note 'receipt matched'.",
              "For 'duplicate' findings: if both transactions have identical vendor + amount + date but different QB IDs, auto-flag the newer one. If amounts differ by <$1, auto-dismiss as 'rounding difference'.",
              "For 'stale_account' findings: auto-dismiss after first appearance. Only re-surface if the account has a non-zero balance.",
              "For 'missing_category' findings: these are now handled by Flow #1 (AI categorization). Auto-resolve any missing_category finding where the linked transaction has since been categorized.",
              "Reduce todos created: only create todos for 'critical' severity. 'Warning' goes to digest only. 'Info' auto-resolves silently.",
            ]}
          />

          <FlowCard
            num={4}
            id="bulk-approve"
            title="Bulk Approval of Auto-Categorized"
            status="partial"
            description="Auto-categorized transactions still need human approval before they're finalized."
            current="Human clicks 'Approve All' button periodically in the Categorize tab."
            target="Auto-approve when AI confidence >= 0.95 and category rule has 3+ confirmations. No human touch needed."
            steps={[
              "Add a new edge function: qb-auto-approve, triggered by pg_cron daily at 7AM UTC (2AM ET).",
              "Query: SELECT * FROM qb_transactions WHERE review_status = 'auto_categorized' AND category_confidence >= 0.95 AND category_source = 'rule' AND created_at < now() - interval '24 hours'.",
              "For each matching transaction: set review_status: 'approved', reviewed_by: 'system', reviewed_at: now().",
              "Also auto-approve transactions where category_source = 'ai' AND confidence >= 0.95 AND the same vendor+category combination has been human-approved 3+ times (check bookkeeping_activity_log).",
              "Log all auto-approvals to bookkeeping_activity_log with actor: 'system', action: 'auto_approved'.",
              "Include auto-approval count in weekly digest summary: 'X transactions auto-approved this week'.",
              "Add pg_cron schedule in a new migration: cron.schedule('qb-auto-approve', '0 7 * * *', ...).",
            ]}
          />
        </div>
      </div>

      {/* --- MEDIUM FREQUENCY --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3">Medium-Frequency Tasks</h2>
        <div className="space-y-4">

          <FlowCard
            num={5}
            id="bookkeeper-queue"
            title="Bookkeeper Queue Processing"
            status="manual"
            description="Transactions flagged as too complex get sent to a 'bookkeeper' queue for expert review."
            current="Bookkeeper reviews flagged items, picks category, optionally sends back to owner."
            target="AI handles complex categorization with chain-of-thought reasoning. Escalate to owner only if AI + rules both uncertain."
            steps={[
              "Create a new edge function: qb-bookkeeper-ai, triggered weekly after integrity check (Sunday 5AM UTC).",
              "Query all transactions with review_status = 'bookkeeper'. For each, build a rich prompt with: vendor name, amount, date, memo/description, QB account name, and the last 5 transactions from the same vendor.",
              "Use Claude (sonnet) with chain-of-thought: 'You are a bookkeeper. Categorize this transaction. Think step-by-step about what category fits. Return JSON: {category, confidence, reasoning}'.",
              "If AI confidence >= 0.85: auto-categorize with category_source: 'ai_bookkeeper', move to 'auto_categorized' status.",
              "If AI confidence 0.60–0.85: include in digest with AI's reasoning shown, plus quick-action to approve or override.",
              "If AI confidence < 0.60: leave in bookkeeper queue but add AI's best guess as a suggestion (store in a notes field). Include in digest as 'needs manual review'.",
              "After 3 successful AI categorizations for the same vendor pattern: auto-create a category_rule with created_by: 'ai', priority: 50.",
            ]}
          />

          <FlowCard
            num={6}
            id="receipt-parse-errors"
            title="Receipt Parsing Error Recovery"
            status="manual"
            description="OCR/AI sometimes fails to extract vendor, amount, or date from receipt images."
            current="Human manually enters parsed data when AI extraction fails."
            target="Multi-model fallback (retry with different prompt/model). Flag truly unreadable receipts for owner with pre-filled best-guess."
            steps={[
              "In resend-inbound-webhook, add retry logic: if Claude haiku fails to parse (missing vendor OR amount), retry with Claude sonnet using a more detailed prompt that includes 'This receipt was difficult to parse. Look carefully for...'.",
              "If sonnet also fails: try Gemini 2.5 Flash (already available in the function for statement classification). Different models handle different receipt formats better.",
              "If all 3 models fail to extract amount: flag receipt as 'parse_failed' in receipts table. Include in weekly digest with the receipt image thumbnail and best-guess fields pre-filled.",
              "Add a quick-action endpoint for receipt correction: owner clicks 'Fix' in digest, lands on a pre-filled form where they only need to correct the wrong field(s).",
              "Track parse failure rate per model in a new receipts_ai_metrics table. If failure rate exceeds 15% in a week, alert in digest.",
              "For blurry/dark images: add image preprocessing (contrast enhancement, rotation detection) before sending to AI. Use sharp or jimp on Hostinger if needed.",
            ]}
          />

          <FlowCard
            num={7}
            id="rule-maintenance"
            title="Category Rule Maintenance"
            status="manual"
            description="Learned vendor-to-category rules can become stale or get overridden repeatedly."
            current="No active maintenance — rules accumulate. Overridden rules stay active until 3+ overrides deactivate them."
            target="Periodic rule audit: auto-deactivate rules with <50% acceptance rate. Surface rule conflicts in digest."
            steps={[
              "Add a rule audit step to qb-integrity-check (runs weekly). Query all active rules and compute acceptance_rate = hit_count / (hit_count + override_count).",
              "Auto-deactivate rules where: acceptance_rate < 0.50 AND hit_count >= 5 (enough data to be meaningful). Set is_active: false, add note: 'auto-deactivated: low acceptance rate'.",
              "Detect rule conflicts: two active rules that match the same vendor pattern but assign different categories. Include conflicts in weekly digest for owner decision.",
              "For rules with 0 hits in 90 days: mark as 'stale' (new column) but keep active. Include stale rule count in digest. Auto-deactivate after 180 days of no hits.",
              "When human overrides a rule-applied category: increment an override_count column (add via migration). This feeds the acceptance rate calculation.",
              "Add rule stats to the Activity tab: total rules, active, stale, recently deactivated, top 10 by hit count.",
            ]}
          />

          <FlowCard
            num={8}
            id="sync-failures"
            title="QuickBooks Sync Failure Handling"
            status="partial"
            description="QB OAuth tokens expire, API errors occur, rate limits hit."
            current="Token refresh script exists (scripts/qb-refresh-token.mjs) but failures still need manual intervention."
            target="Auto-retry with exponential backoff. Auto-refresh tokens proactively. Alert owner only after 3 consecutive failures."
            steps={[
              "qb-sync already refreshes tokens when expired. Add proactive refresh: if token expires within 24 hours, refresh it at the start of daily sync (before it fails).",
              "Add retry logic to qb-sync: on QB API error (429, 500, 503), wait 30s and retry up to 3 times with exponential backoff (30s, 60s, 120s).",
              "Track consecutive failures in sync_runs table (add consecutive_failures column). On 3rd consecutive failure: send alert email via Resend to ADMIN_EMAIL.",
              "For OAuth token refresh failures: the existing qb-refresh-token.mjs script can be called from qb-sync as a fallback. If refresh fails, send immediate alert (token needs manual re-auth).",
              "Add a sync health indicator to the Dashboard tab: green (last sync <24h ago + success), amber (last sync 24-48h ago OR last sync failed), red (last sync >48h ago OR 3+ consecutive failures).",
              "For rate limit errors (429): parse the Retry-After header and schedule a retry via pg_cron one-time job.",
            ]}
          />
        </div>
      </div>

      {/* --- LOW FREQUENCY / PERIODIC --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3">Low-Frequency / Periodic</h2>
        <div className="space-y-4">

          <FlowCard
            num={9}
            id="tax-report"
            title="Tax Report Generation"
            status="manual"
            description="Annual tax deduction summaries, capital gains/losses reports."
            current="Human filters by year, reviews deductible categories, exports data."
            target="Auto-generate annual tax summary on Jan 1. Pre-classify deductions using IRS category rules. Export-ready PDF."
            steps={[
              "Create a new edge function: generate-tax-report, triggered by pg_cron annually on Jan 5 (0 6 5 1 *) — 5 days after year-end to allow for late transactions.",
              "Query qb_transactions for the prior year, grouped by our_category. Map each category to IRS Schedule C / Schedule A line items using a tax_category_mapping table.",
              "For capital gains/losses: query the brokerage tables (Schwab holdings) for realized gains in the tax year. Separate short-term (<1yr) vs long-term.",
              "Generate a structured JSON report with: total income, total expenses by category, deductible subtotals, capital gains summary, and any flagged items (large unusual expenses).",
              "Use Claude to generate a plain-English summary: 'Your 2025 tax year: $X income, $Y deductions, $Z capital gains. Notable: [unusual items]'.",
              "Store report in document_index with doc_type: 'tax_report'. Send email to owner with PDF attachment and summary.",
              "Add a 'Generate Report' button to the Tax Report tab for on-demand generation (calls the same edge function with a year parameter).",
            ]}
          />

          <FlowCard
            num={10}
            id="statement-org"
            title="Statement Organization"
            status="partial"
            description="Bank/brokerage statements uploaded and organized by institution, account, period."
            current="Human uploads statements, fills in metadata (institution, account, period)."
            target="Auto-extract metadata from statement PDFs. Auto-file into correct institution/account/period."
            steps={[
              "resend-inbound-webhook already classifies PDFs as statements using Gemini 2.5 Flash and extracts: institution, account_type, account_name, account_number, statement_date, period_start, period_end.",
              "Extend the statement flow: after classification, auto-insert into the statements table (not just statement_inbox) with all extracted metadata.",
              "Add deduplication: before inserting, check if a statement with the same institution + account_number + period_start already exists. If yes, skip or flag as duplicate.",
              "For statements that fail metadata extraction: queue in statement_inbox with status 'needs_review'. Include in weekly digest with 'Review Statement' quick-action link.",
              "Add auto-filing by institution: create folder-like organization in Supabase Storage (statements/{institution}/{account_number}/{year}/{filename}).",
              "Send confirmation email after processing: 'Statement received: [Institution] [Account] for [Period]. Filed automatically.'",
            ]}
          />

          <FlowCard
            num={11}
            id="brokerage-recon"
            title="Brokerage Reconciliation"
            status="partial"
            description="Schwab holdings synced automatically but discrepancies need manual review."
            current="Human monitors unrealized gains/losses, checks for sync drift."
            target="Auto-flag material discrepancies (>1% drift). Weekly reconciliation report in digest."
            steps={[
              "Add a reconciliation step to schwab-sync: after syncing holdings, compare current values against the previous sync's snapshot.",
              "Flag discrepancies: if any holding's value changed by more than 10% in a single sync (likely a data error, not market movement), flag for review.",
              "For position count changes: if a holding appears or disappears, log as 'position_added' or 'position_removed' in bookkeeping_activity_log.",
              "Add a reconciliation summary to the weekly digest: total portfolio value, weekly change %, top 3 movers, any flagged discrepancies.",
              "For dividend/distribution detection: if a cash balance increases without a corresponding transfer, flag as potential dividend for tax tracking.",
              "Store weekly portfolio snapshots in a new brokerage_snapshots table for trend analysis on the Brokerage tab.",
            ]}
          />

          <FlowCard
            num={12}
            id="digest-tuning"
            title="Weekly Digest Optimization"
            status="partial"
            description="Weekly email digest with pending items and quick-action links."
            current="Fixed template with top 5 pending items."
            target="Adaptive digest: only send when action needed. Prioritize by dollar amount and age. Include auto-resolution summary."
            steps={[
              "Add conditional sending to send-weekly-digest: if pending_count = 0 AND no critical findings AND no sync failures, skip sending. Log 'digest suppressed: no action needed'.",
              "Prioritize pending items by: (1) dollar amount descending, (2) age descending. Show top 10 instead of 5, with the highest-value items first.",
              "Add an 'Auto-Resolved This Week' section: count of integrity findings auto-resolved, transactions auto-approved, receipts auto-matched. This shows the automation is working.",
              "Add a 'Rule Learning' section: new rules created this week, rules deactivated, current rule coverage % (transactions matched by rules / total transactions).",
              "Include sync health: last successful sync timestamp, any failures this week, token expiration warning if <7 days remaining.",
              "Make digest frequency adaptive: if pending_count > 20 or any critical finding, send a mid-week digest on Wednesday (add a second pg_cron job that checks thresholds before sending).",
            ]}
          />
        </div>
      </div>

      <p className="text-xs text-slate-400">Flow Migration Plan — 2026-03-25</p>
    </div>
  );
}


/* ── helper ── */

type FlowStatus = "manual" | "partial" | "automated";

function FlowCard({
  num,
  id,
  title,
  status,
  description,
  current,
  target,
  steps,
}: {
  num: number;
  id: string;
  title: string;
  status: FlowStatus;
  description: string;
  current: string;
  target: string;
  steps: string[];
}) {
  const badge: Record<FlowStatus, { label: string; cls: string }> = {
    manual: { label: "Manual", cls: "bg-red-100 text-red-700" },
    partial: { label: "Partially Automated", cls: "bg-amber-100 text-amber-700" },
    automated: { label: "Automated", cls: "bg-green-100 text-green-700" },
  };

  const b = badge[status];

  return (
    <div id={id} className="border border-slate-200 rounded-xl p-5 bg-white">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-base font-semibold text-slate-800">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-bold mr-2">{num}</span>
          {title}
        </h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${b.cls}`}>{b.label}</span>
      </div>
      <p className="text-sm text-slate-600 mb-3">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current (Manual)</p>
          <p className="text-sm text-slate-700">{current}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Target (Automated)</p>
          <p className="text-sm text-slate-700">{target}</p>
        </div>
      </div>
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">How to Automate</p>
        <ol className="list-decimal pl-5 space-y-1.5">
          {steps.map((step, i) => (
            <li key={i} className="text-sm text-slate-700 leading-relaxed">{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
