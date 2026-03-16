"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface IntegrityFinding {
  id: string;
  finding_type: string;
  severity: "critical" | "warning" | "info";
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  description: string | null;
  suggested_action: string | null;
  auto_fixable: boolean;
  resolved_at: string | null;
  created_at: string;
}

interface FindingGroup {
  title: string;
  severity: "critical" | "warning" | "info";
  items: { id: string; text: string; action: string | null }[];
}

const FINDING_TYPE_LABELS: Record<string, { title: string; severity: "critical" | "warning" | "info" }> = {
  missing_category: { title: "Uncategorized Transactions", severity: "warning" },
  missing_receipt: { title: "Missing Receipts", severity: "info" },
  duplicate: { title: "Potential Duplicates", severity: "critical" },
  stale_account: { title: "Stale Accounts (No Activity 6+ Months)", severity: "info" },
  deleted_transactions: { title: "Deleted from QuickBooks", severity: "warning" },
  negative_balance: { title: "Negative Account Balances", severity: "critical" },
  misclassification: { title: "Possible Misclassifications", severity: "warning" },
};

export default function LedgerNotesTab() {
  const [stats, setStats] = useState<{
    totalRows: number;
    totalAccounts: number;
  } | null>(null);
  const [findings, setFindings] = useState<FindingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLiveFindings, setHasLiveFindings] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Fetch stats
    const { count: txnCount } = await supabase
      .from("qb_general_ledger")
      .select("*", { count: "exact", head: true });

    setStats({
      totalRows: txnCount || 0,
      totalAccounts: 0, // Will be computed below
    });

    // Fetch distinct accounts
    const { data: accounts } = await supabase
      .from("qb_transactions")
      .select("qb_account_name")
      .eq("is_deleted", false);

    if (accounts) {
      const uniqueAccounts = new Set(accounts.map((a) => a.qb_account_name).filter(Boolean));
      setStats((prev) => prev ? { ...prev, totalAccounts: uniqueAccounts.size } : prev);
    }

    // Fetch live integrity findings
    const { data: liveFindings } = await supabase
      .from("integrity_findings")
      .select("*")
      .is("resolved_at", null)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false });

    if (liveFindings && liveFindings.length > 0) {
      setHasLiveFindings(true);

      // Group by finding_type
      const grouped = new Map<string, IntegrityFinding[]>();
      for (const f of liveFindings) {
        if (!grouped.has(f.finding_type)) grouped.set(f.finding_type, []);
        grouped.get(f.finding_type)!.push(f);
      }

      const groups: FindingGroup[] = [];
      for (const [type, items] of grouped) {
        const meta = FINDING_TYPE_LABELS[type] || { title: type, severity: "info" as const };
        groups.push({
          title: meta.title,
          severity: meta.severity,
          items: items.map((f) => ({
            id: f.id,
            text: f.description || f.title,
            action: f.suggested_action,
          })),
        });
      }

      // Sort: critical first, then warning, then info
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      groups.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
      setFindings(groups);
    } else {
      setHasLiveFindings(false);
      setFindings([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resolveFinding = async (findingId: string) => {
    await supabase
      .from("integrity_findings")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: "owner",
        updated_at: new Date().toISOString(),
      })
      .eq("id", findingId);

    fetchData();
  };

  const severityStyles = {
    critical: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };

  const severityLabels = {
    critical: "Needs Attention",
    warning: "Review",
    info: "Informational",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ledger Notes</h1>
          <p className="text-sm text-slate-500 mt-1">
            QuickBooks data quality analysis
          </p>
        </div>
        {hasLiveFindings && (
          <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
            Live data
          </span>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">
            {loading ? "..." : stats?.totalRows.toLocaleString()}
          </div>
          <div className="text-sm text-slate-500">Ledger Rows</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">
            {loading ? "..." : stats?.totalAccounts || "—"}
          </div>
          <div className="text-sm text-slate-500">Active Accounts</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">
            {loading ? "..." : findings.reduce((sum, g) => sum + g.items.length, 0)}
          </div>
          <div className="text-sm text-slate-500">Open Findings</div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading findings...
        </div>
      ) : findings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">No open findings</p>
          <p className="text-sm">
            Run the integrity check to scan for data quality issues.
            Findings will appear here automatically after the weekly check runs.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Findings & Anomalies
          </h2>
          {findings.map((group) => (
            <div
              key={group.title}
              className={`rounded-xl border p-5 ${severityStyles[group.severity]}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <h3 className="font-semibold">{group.title}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    group.severity === "critical"
                      ? "bg-red-200 text-red-900"
                      : group.severity === "warning"
                        ? "bg-amber-200 text-amber-900"
                        : "bg-blue-200 text-blue-900"
                  }`}
                >
                  {severityLabels[group.severity]}
                </span>
                <span className="text-xs opacity-60">{group.items.length} items</span>
              </div>
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li key={item.id} className="text-sm leading-relaxed flex items-start gap-2">
                    <span className="flex-1">{item.text}</span>
                    <button
                      onClick={() => resolveFinding(item.id)}
                      className="flex-shrink-0 text-xs px-2 py-1 rounded bg-white/50 hover:bg-white/80 transition-colors"
                      title="Mark as resolved"
                    >
                      Resolve
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 p-5 bg-slate-50">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Data Source
        </h2>
        <p className="text-sm text-slate-600">
          Findings are generated automatically by the weekly integrity check
          against QB transaction data. Manual findings can also be added.
          Resolved findings are hidden from this view.
        </p>
      </div>
    </div>
  );
}
