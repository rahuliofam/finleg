"use client";

import { useState } from "react";

interface SystemComponent {
  id: string;
  name: string;
  type: "automated" | "human" | "ai" | "integration";
  schedule?: string;
  owner: string;
  description: string;
  inputs: string[];
  outputs: string[];
  learnsWith?: string;
}

const COMPONENTS: SystemComponent[] = [
  {
    id: "qb-sync",
    name: "QuickBooks Sync",
    type: "automated",
    schedule: "Daily 6AM UTC (Mon-Sat) + Weekly full sync Sunday 2AM UTC",
    owner: "System (pg_cron)",
    description:
      "Pulls transactions from QuickBooks Online (Purchases, Deposits, Transfers, Journal Entries) into Supabase. Daily syncs fetch 3 days of data; weekly syncs fetch 35 days to catch stragglers. Uses upsert to avoid duplicates. Detects soft-deleted transactions on weekly runs.",
    inputs: ["QuickBooks Online API", "OAuth tokens (qb_tokens table)"],
    outputs: [
      "qb_transactions (upserted)",
      "sync_runs (logged)",
      "Soft-delete flags on removed transactions",
    ],
  },
  {
    id: "category-rules",
    name: "Rule-Based Categorization",
    type: "automated",
    owner: "System (on sync)",
    description:
      "When new transactions arrive, the system checks the category_rules table for vendor matches. If a rule exists with sufficient confidence, the transaction is auto-categorized without human review. Rules are created from patterns in human-approved categorizations.",
    inputs: ["New qb_transactions", "category_rules table"],
    outputs: [
      "Auto-categorized transactions (review_status = 'auto_categorized')",
    ],
    learnsWith:
      "Every time a human approves a category, the system checks if a rule should be created or updated. High-confidence AI categorizations that humans confirm create rules after just 1 confirmation.",
  },
  {
    id: "ai-categorize",
    name: "AI Categorization",
    type: "ai",
    schedule: "Run manually or via batch job on Hostinger VPS",
    owner: "System (batch script)",
    description:
      "For transactions that rules can't handle, the AI categorizer uses Claude to analyze vendor names, amounts, and patterns. It groups transactions by vendor for efficiency and includes few-shot examples from recent human-approved categorizations for the same vendor.",
    inputs: [
      "Pending qb_transactions",
      "Recent human-approved examples",
      "Category list",
    ],
    outputs: [
      "AI-categorized transactions with confidence scores",
      "category_source = 'ai'",
    ],
    learnsWith:
      "AI accuracy is tracked weekly. When humans override AI categorizations 3+ times for a vendor, the old rule is deactivated and a new one is created from the human's preference.",
  },
  {
    id: "human-review",
    name: "Human Categorization Review",
    type: "human",
    owner: "Family member or bookkeeper",
    description:
      "Humans review transactions on the Categorize tab. They can approve AI suggestions (one click) or override with the correct category. Each approval/override feeds back into the rule learning system, making future categorizations more accurate.",
    inputs: ["Pending or AI-categorized transactions on Categorize tab"],
    outputs: [
      "Approved categorizations",
      "New or updated category_rules",
      "Activity log entries",
    ],
    learnsWith:
      "The most important feedback loop. Every human decision teaches the system. Approve = reinforce the rule. Override = correct the rule. After enough confirmations, the system handles that vendor automatically forever.",
  },
  {
    id: "receipt-ingestion",
    name: "Email Receipt Ingestion",
    type: "automated",
    owner: "System (Resend webhook)",
    description:
      "Receipts forwarded to the Resend inbound email address are automatically parsed and stored. The system extracts vendor, amount, and date, then attempts to match receipts to QB transactions. Unmatched receipts are flagged for human review.",
    inputs: ["Forwarded receipt emails via Resend webhook"],
    outputs: [
      "receipts table entries",
      "Matched receipt_id on qb_transactions",
    ],
  },
  {
    id: "integrity-check",
    name: "Integrity Checker",
    type: "automated",
    schedule: "Weekly Sunday 4AM UTC (after sync completes)",
    owner: "System (pg_cron)",
    description:
      "Scans the data for quality issues: transactions missing categories for 7+ days, purchases over $75 without receipts, potential duplicates (same amount + date + vendor), and stale accounts with no activity for 6+ months. Auto-resolves findings when the underlying issue is fixed.",
    inputs: ["qb_transactions", "receipts", "QB accounts"],
    outputs: [
      "integrity_findings (new issues)",
      "todos (generated from findings)",
      "Auto-resolved old findings",
    ],
  },
  {
    id: "task-management",
    name: "Task Queue",
    type: "human",
    owner: "Family member or bookkeeper",
    description:
      "The Tasks tab shows a prioritized list of things that need human attention: missing receipts to upload, uncategorized transactions to review, data quality issues to resolve. Tasks are auto-generated by integrity checks and AI, but can also be created manually.",
    inputs: [
      "integrity_findings",
      "AI categorization gaps",
      "Manual task creation",
    ],
    outputs: [
      "Resolved tasks",
      "Dismissed low-priority items",
      "Escalation after 7 days unresolved",
    ],
  },
  {
    id: "weekly-digest",
    name: "Weekly Email Digest",
    type: "automated",
    schedule: "Sunday 9AM UTC",
    owner: "System (pg_cron + Resend)",
    description:
      "Sends a summary email every Sunday with: sync stats, auto-categorization rate, pending review count, top uncategorized transactions, integrity alerts, and AI accuracy trends. Designed to give a quick pulse on financial data health without logging in.",
    inputs: [
      "sync_runs",
      "qb_transactions stats",
      "integrity_findings",
      "ai_metrics",
    ],
    outputs: ["Email digest via Resend"],
  },
  {
    id: "qb-writeback",
    name: "QuickBooks Writeback",
    type: "human",
    owner: "Admin (approve) + System (execute)",
    description:
      "When the system detects that QB data could be enriched (e.g., adding private notes, correcting account references), it proposes changes in the writeback queue. An admin reviews and approves proposed changes, then the system pushes them back to QuickBooks via the API.",
    inputs: [
      "qb_writeback_queue entries (proposed)",
      "Admin approval",
    ],
    outputs: [
      "Updated QuickBooks records",
      "Executed writeback entries",
    ],
  },
  {
    id: "investment-bridge",
    name: "Investment Balance Bridge",
    type: "automated",
    schedule: "Monthly (manual trigger)",
    owner: "System (batch script)",
    description:
      "QuickBooks can't track individual securities, cost basis, or lots. Investment data lives in finleg's purpose-built tables (holdings_snapshots, investment_transactions, realized_gain_loss). Monthly, this bridge pushes aggregate account balances to QB as journal entries to keep the balance sheet accurate.",
    inputs: [
      "investment_statement_summaries",
      "investment_transactions (dividends, gains)",
    ],
    outputs: [
      "qb_writeback_queue entries for balance journal entries",
      "Investment income entries for QB",
    ],
  },
  {
    id: "tax-report",
    name: "Tax Reporting",
    type: "automated",
    owner: "System (computed from data)",
    description:
      "Aggregates all financial data into tax-relevant views: deductible expenses by category, charitable donations, medical expenses, realized capital gains/losses (short-term vs long-term), and estimated quarterly obligations. Updated automatically as data flows in.",
    inputs: [
      "qb_transactions (categorized)",
      "realized_gain_loss",
      "investment_transactions",
    ],
    outputs: ["Tax Report tab with year-over-year views"],
  },
];

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  automated: { bg: "bg-blue-50", text: "text-blue-700", label: "Automated" },
  human: { bg: "bg-amber-50", text: "text-amber-700", label: "Human" },
  ai: { bg: "bg-purple-50", text: "text-purple-700", label: "AI-Powered" },
  integration: { bg: "bg-green-50", text: "text-green-700", label: "Integration" },
};

function ComponentCard({
  component,
  isExpanded,
  onToggle,
}: {
  component: SystemComponent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const style = TYPE_STYLES[component.type];
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
          >
            {style.label}
          </span>
          <span className="font-semibold text-slate-900">{component.name}</span>
        </div>
        <div className="flex items-center gap-3">
          {component.schedule && (
            <span className="text-xs text-slate-400 hidden sm:inline">
              {component.schedule}
            </span>
          )}
          <span className="text-slate-400 text-lg">{isExpanded ? "\u2212" : "+"}</span>
        </div>
      </button>
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-slate-100">
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            {component.description}
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Inputs
              </h4>
              <ul className="space-y-1">
                {component.inputs.map((input) => (
                  <li key={input} className="text-sm text-slate-600 flex items-start gap-1.5">
                    <span className="text-green-500 mt-0.5">&#8594;</span> {input}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Outputs
              </h4>
              <ul className="space-y-1">
                {component.outputs.map((output) => (
                  <li key={output} className="text-sm text-slate-600 flex items-start gap-1.5">
                    <span className="text-blue-500 mt-0.5">&#8592;</span> {output}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
            <span>
              <strong>Owner:</strong> {component.owner}
            </span>
          </div>
          {component.learnsWith && (
            <div className="mt-3 p-3 bg-purple-50 rounded-lg">
              <h4 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">
                How It Learns
              </h4>
              <p className="text-sm text-purple-800">{component.learnsWith}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComponentsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["qb-sync"]));

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(COMPONENTS.map((c) => c.id)));
  const collapseAll = () => setExpanded(new Set());

  const automatedCount = COMPONENTS.filter((c) => c.type === "automated").length;
  const humanCount = COMPONENTS.filter((c) => c.type === "human").length;
  const aiCount = COMPONENTS.filter((c) => c.type === "ai").length;

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">System Components</h1>
        <p className="mt-2 text-slate-600">
          How finleg&apos;s automated bookkeeping system works, who does what, and how it
          gets smarter over time.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{automatedCount}</div>
          <div className="text-xs text-blue-600 font-medium">Automated</div>
        </div>
        <div className="bg-amber-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-amber-700">{humanCount}</div>
          <div className="text-xs text-amber-600 font-medium">Human-in-the-Loop</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-purple-700">{aiCount}</div>
          <div className="text-xs text-purple-600 font-medium">AI-Powered</div>
        </div>
      </div>

      {/* Self-improvement flywheel */}
      <div className="mb-8 p-5 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg">
        <h2 className="text-lg font-bold text-green-900 mb-3">
          The Self-Improvement Flywheel
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-green-800">
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            QB Sync
          </span>
          <span className="text-green-400">&#8594;</span>
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            Rules Auto-Categorize
          </span>
          <span className="text-green-400">&#8594;</span>
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            AI Categorizes Rest
          </span>
          <span className="text-green-400">&#8594;</span>
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            Human Reviews
          </span>
          <span className="text-green-400">&#8594;</span>
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            New Rules Created
          </span>
          <span className="text-green-400">&#8594;</span>
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            More Auto-Categorized
          </span>
          <span className="text-green-400">&#8594;</span>
          <span className="bg-white px-3 py-1.5 rounded-full border border-green-200 font-medium">
            Less Human Time
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-xs text-green-700 font-medium">Target: Auto-Categorized</div>
            <div className="text-lg font-bold text-green-900">95%+</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-green-700 font-medium">Target: AI Accuracy</div>
            <div className="text-lg font-bold text-green-900">90%+</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-green-700 font-medium">Target: Todos/Week</div>
            <div className="text-lg font-bold text-green-900">&lt;5</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-green-700 font-medium">Target: Human Time</div>
            <div className="text-lg font-bold text-green-900">80% reduction</div>
          </div>
        </div>
      </div>

      {/* Who Does What */}
      <div className="mb-8 p-5 bg-slate-50 border border-slate-200 rounded-lg">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Who Does What</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-28 shrink-0 text-sm font-semibold text-blue-700">System</div>
            <div className="text-sm text-slate-600">
              Syncs QB data daily, applies category rules, runs integrity checks weekly,
              sends email digests, detects deleted transactions, auto-resolves fixed issues.
              Runs 24/7 without intervention.
            </div>
          </div>
          <div className="border-t border-slate-200" />
          <div className="flex gap-3">
            <div className="w-28 shrink-0 text-sm font-semibold text-purple-700">AI (Claude)</div>
            <div className="text-sm text-slate-600">
              Categorizes transactions that rules can&apos;t handle. Learns from few-shot examples
              of recent human decisions. Provides confidence scores so humans can prioritize
              low-confidence reviews. Accuracy tracked weekly.
            </div>
          </div>
          <div className="border-t border-slate-200" />
          <div className="flex gap-3">
            <div className="w-28 shrink-0 text-sm font-semibold text-amber-700">Family / Owner</div>
            <div className="text-sm text-slate-600">
              Reviews the Categorize tab to approve or correct AI categorizations. Resolves
              tasks on the Tasks tab (upload missing receipts, fix flagged issues). Approves
              QB writeback proposals. Checks the weekly email digest for anything urgent.
              The less you do each week, the better the system is working.
            </div>
          </div>
          <div className="border-t border-slate-200" />
          <div className="flex gap-3">
            <div className="w-28 shrink-0 text-sm font-semibold text-green-700">Bookkeeper</div>
            <div className="text-sm text-slate-600">
              Handles escalated tasks that go unresolved for 7+ days. Reviews the Bookkeeper
              Queue for items flagged by the system. Assists with complex categorizations
              and month-end reconciliation.
            </div>
          </div>
        </div>
      </div>

      {/* Component list */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">All Components</h2>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
          >
            Collapse All
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {COMPONENTS.map((component) => (
          <ComponentCard
            key={component.id}
            component={component}
            isExpanded={expanded.has(component.id)}
            onToggle={() => toggle(component.id)}
          />
        ))}
      </div>

      {/* Data flow diagram */}
      <div className="mt-8 p-5 bg-slate-50 border border-slate-200 rounded-lg">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Weekly Timeline</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">Mon-Sat 6AM</span>
            <span className="text-blue-600 font-medium">Daily Sync</span>
            <span className="text-slate-500">&#8212; Pulls 3 days of QB transactions</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">Sun 2AM</span>
            <span className="text-blue-600 font-medium">Weekly Full Sync</span>
            <span className="text-slate-500">&#8212; Pulls 35 days, detects deletions</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">Sun 4AM</span>
            <span className="text-blue-600 font-medium">Integrity Check</span>
            <span className="text-slate-500">&#8212; Scans for data quality issues, generates tasks</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">Sun 9AM</span>
            <span className="text-blue-600 font-medium">Email Digest</span>
            <span className="text-slate-500">&#8212; Summary email with action items</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">Anytime</span>
            <span className="text-amber-600 font-medium">Human Review</span>
            <span className="text-slate-500">&#8212; Categorize tab, Tasks tab, email quick actions</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">On demand</span>
            <span className="text-purple-600 font-medium">AI Batch</span>
            <span className="text-slate-500">&#8212; Categorize pending transactions via Claude</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-slate-400 w-24 shrink-0">Monthly</span>
            <span className="text-green-600 font-medium">Investment Bridge</span>
            <span className="text-slate-500">&#8212; Push investment balances to QB balance sheet</span>
          </div>
        </div>
      </div>

      {/* Where to go */}
      <div className="mt-8 p-5 bg-amber-50 border border-amber-200 rounded-lg">
        <h2 className="text-lg font-bold text-amber-900 mb-3">Where to Go</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <a href="/intranet/bookkeeping/categorize" className="flex items-center gap-2 text-amber-800 hover:text-amber-950 font-medium">
            <span>&#8594;</span> Categorize &mdash; Review & approve transactions
          </a>
          <a href="/intranet/bookkeeping/tasks" className="flex items-center gap-2 text-amber-800 hover:text-amber-950 font-medium">
            <span>&#8594;</span> Tasks &mdash; Action items needing attention
          </a>
          <a href="/intranet/bookkeeping/dashboard" className="flex items-center gap-2 text-amber-800 hover:text-amber-950 font-medium">
            <span>&#8594;</span> Dashboard &mdash; KPIs and system health
          </a>
          <a href="/intranet/bookkeeping/activity" className="flex items-center gap-2 text-amber-800 hover:text-amber-950 font-medium">
            <span>&#8594;</span> Activity &mdash; Sync history & manual sync
          </a>
          <a href="/intranet/bookkeeping/tax-report" className="flex items-center gap-2 text-amber-800 hover:text-amber-950 font-medium">
            <span>&#8594;</span> Tax Report &mdash; Deductions & capital gains
          </a>
          <a href="/intranet/bookkeeping/ledger-notes" className="flex items-center gap-2 text-amber-800 hover:text-amber-950 font-medium">
            <span>&#8594;</span> Ledger Notes &mdash; Data quality findings
          </a>
        </div>
      </div>
    </div>
  );
}
