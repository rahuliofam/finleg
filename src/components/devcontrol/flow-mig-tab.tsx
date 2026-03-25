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
        <div className="space-y-3">

          <FlowCard
            id="tx-categorize"
            title="Transaction Categorization"
            status="partial"
            description="Human reviews and categorizes transactions that AI couldn't auto-categorize with high confidence."
            current="Owner/bookkeeper picks category from dropdown, adds notes, bulk-approves batches."
            target="Raise AI confidence threshold so 95%+ auto-approve. Route only true edge cases to owner via weekly digest quick-actions."
          />

          <FlowCard
            id="receipt-match"
            title="Receipt-to-Transaction Matching"
            status="manual"
            description="Receipts emailed to agent@finleg.net must be manually matched to QuickBooks transactions."
            current="Human finds match candidates by amount (+-$1) and date (+-10 days), then links them."
            target="Auto-match when exactly one candidate exists. Surface ambiguous matches in digest for one-click confirm."
          />

          <FlowCard
            id="integrity-resolve"
            title="Integrity Finding Resolution"
            status="manual"
            description="Weekly integrity check generates findings (uncategorized >7d, missing receipts >$75, duplicates, stale accounts)."
            current="Human reviews each finding in Ledger Notes tab and marks as resolved."
            target="Auto-resolve informational findings. Auto-dismiss duplicates below threshold. Only surface critical findings."
          />

          <FlowCard
            id="bulk-approve"
            title="Bulk Approval of Auto-Categorized"
            status="partial"
            description="Auto-categorized transactions still need human approval before they're finalized."
            current="Human clicks 'Approve All' button periodically in the Categorize tab."
            target="Auto-approve when AI confidence >= 0.95 and category rule has 3+ confirmations. No human touch needed."
          />
        </div>
      </div>

      {/* --- MEDIUM FREQUENCY --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3">Medium-Frequency Tasks</h2>
        <div className="space-y-3">

          <FlowCard
            id="bookkeeper-queue"
            title="Bookkeeper Queue Processing"
            status="manual"
            description="Transactions flagged as too complex get sent to a 'bookkeeper' queue for expert review."
            current="Bookkeeper reviews flagged items, picks category, optionally sends back to owner."
            target="AI handles complex categorization with chain-of-thought reasoning. Escalate to owner only if AI + rules both uncertain."
          />

          <FlowCard
            id="receipt-parse-errors"
            title="Receipt Parsing Error Recovery"
            status="manual"
            description="OCR/AI sometimes fails to extract vendor, amount, or date from receipt images."
            current="Human manually enters parsed data when AI extraction fails."
            target="Multi-model fallback (retry with different prompt/model). Flag truly unreadable receipts for owner with pre-filled best-guess."
          />

          <FlowCard
            id="rule-maintenance"
            title="Category Rule Maintenance"
            status="manual"
            description="Learned vendor-to-category rules can become stale or get overridden repeatedly."
            current="No active maintenance — rules accumulate. Overridden rules stay active until 3+ overrides deactivate them."
            target="Periodic rule audit: auto-deactivate rules with <50% acceptance rate. Surface rule conflicts in digest."
          />

          <FlowCard
            id="sync-failures"
            title="QuickBooks Sync Failure Handling"
            status="partial"
            description="QB OAuth tokens expire, API errors occur, rate limits hit."
            current="Token refresh script exists but failures still need manual intervention. Sync errors create todos."
            target="Auto-retry with exponential backoff. Auto-refresh tokens proactively. Alert owner only after 3 consecutive failures."
          />
        </div>
      </div>

      {/* --- LOW FREQUENCY / PERIODIC --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3">Low-Frequency / Periodic</h2>
        <div className="space-y-3">

          <FlowCard
            id="tax-report"
            title="Tax Report Generation"
            status="manual"
            description="Annual tax deduction summaries, capital gains/losses reports."
            current="Human filters by year, reviews deductible categories, exports data."
            target="Auto-generate annual tax summary on Jan 1. Pre-classify deductions using IRS category rules. Export-ready PDF."
          />

          <FlowCard
            id="statement-org"
            title="Statement Organization"
            status="manual"
            description="Bank/brokerage statements uploaded and organized by institution, account, period."
            current="Human uploads statements, fills in metadata (institution, account, period)."
            target="Auto-extract metadata from statement PDFs. Auto-file into correct institution/account/period."
          />

          <FlowCard
            id="brokerage-recon"
            title="Brokerage Reconciliation"
            status="partial"
            description="Schwab holdings synced automatically but discrepancies need manual review."
            current="Human monitors unrealized gains/losses, checks for sync drift."
            target="Auto-flag material discrepancies (>1% drift). Weekly reconciliation report in digest."
          />

          <FlowCard
            id="digest-tuning"
            title="Weekly Digest Optimization"
            status="partial"
            description="Weekly email digest with pending items and quick-action links."
            current="Fixed template with top 5 pending items."
            target="Adaptive digest: only send when action needed. Prioritize by dollar amount and age. Include auto-resolution summary."
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
  id,
  title,
  status,
  description,
  current,
  target,
}: {
  id: string;
  title: string;
  status: FlowStatus;
  description: string;
  current: string;
  target: string;
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
        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>
      </div>
      <p className="text-sm text-slate-600 mb-3">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Current (Manual)</p>
          <p className="text-sm text-slate-700">{current}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Target (Automated)</p>
          <p className="text-sm text-slate-700">{target}</p>
        </div>
      </div>
    </div>
  );
}
