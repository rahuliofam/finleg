"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface ActivityEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor: string;
  details: Record<string, any> | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  receipt_parsed: { label: "Receipt parsed", color: "text-blue-600 bg-blue-50", icon: "📄" },
  receipt_matched: { label: "Receipt matched", color: "text-green-600 bg-green-50", icon: "🔗" },
  auto_categorized: { label: "Auto-categorized", color: "text-purple-600 bg-purple-50", icon: "🤖" },
  manual_categorized: { label: "Manually categorized", color: "text-amber-600 bg-amber-50", icon: "✏️" },
  txn_synced: { label: "QB sync", color: "text-indigo-600 bg-indigo-50", icon: "🔄" },
  rule_created: { label: "Rule learned", color: "text-teal-600 bg-teal-50", icon: "📚" },
  review_approved: { label: "Approved", color: "text-green-600 bg-green-50", icon: "✅" },
};

const ACTOR_LABELS: Record<string, string> = {
  ai: "AI Agent",
  owner: "You",
  bookkeeper: "Bookkeeper",
  system: "System",
};

interface SyncRun {
  id: string;
  sync_type: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  since_date: string | null;
  entities_fetched: Record<string, number> | null;
  entities_new: number;
  entities_updated: number;
  error_message: string | null;
  triggered_by: string | null;
}

export default function ActivityTab() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [stats, setStats] = useState<{
    total_receipts: number;
    matched_receipts: number;
    auto_categorized: number;
    pending_review: number;
    rules_count: number;
  } | null>(null);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("bookkeeping_activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setEntries(data || []);
    }
    setLoading(false);
  }, []);

  const fetchStats = useCallback(async () => {
    const [receipts, matched, autoCat, pending, rules] = await Promise.all([
      supabase.from("receipts").select("id", { count: "exact", head: true }),
      supabase.from("receipts").select("id", { count: "exact", head: true }).eq("status", "matched"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "auto_categorized"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
      supabase.from("category_rules").select("id", { count: "exact", head: true }).eq("is_active", true),
    ]);

    setStats({
      total_receipts: receipts.count || 0,
      matched_receipts: matched.count || 0,
      auto_categorized: autoCat.count || 0,
      pending_review: pending.count || 0,
      rules_count: rules.count || 0,
    });
  }, []);

  const fetchSyncRuns = useCallback(async () => {
    const { data } = await supabase
      .from("sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);
    setSyncRuns(data || []);
  }, []);

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("qb-sync", {
        body: {
          syncType: "manual",
          triggeredBy: `admin:${session?.user?.email || "unknown"}`,
        },
      });
      if (res.error) throw res.error;
      // Refresh data after sync
      await Promise.all([fetchActivity(), fetchStats(), fetchSyncRuns()]);
    } catch (err: any) {
      setError(`Sync failed: ${err.message || String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchActivity();
    fetchStats();
    fetchSyncRuns();
  }, [fetchActivity, fetchStats, fetchSyncRuns]);

  const formatTime = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  function formatDetails(action: string, details: Record<string, any> | null): string {
    if (!details) return "";

    switch (action) {
      case "receipt_parsed":
        return [
          details.vendor && `Vendor: ${details.vendor}`,
          details.amount && `Amount: $${details.amount}`,
          details.category && `Category: ${details.category}`,
        ]
          .filter(Boolean)
          .join(" · ");

      case "receipt_matched":
        return [
          details.amount && `$${details.amount}`,
          details.vendor,
          details.confidence && `${Math.round(details.confidence * 100)}% match`,
        ]
          .filter(Boolean)
          .join(" · ");

      case "txn_synced":
        return [
          details.fetched && `${details.fetched} fetched`,
          details.inserted && `${details.inserted} new`,
          details.updated && `${details.updated} updated`,
          details.auto_categorized && `${details.auto_categorized} auto-categorized`,
        ]
          .filter(Boolean)
          .join(" · ");

      case "manual_categorized":
        return [
          details.category,
          details.note && `Note: ${details.note}`,
        ]
          .filter(Boolean)
          .join(" · ");

      default:
        return JSON.stringify(details).slice(0, 100);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Activity Feed</h1>
          <p className="text-sm text-slate-500 mt-1">
            Everything the AI agent and humans have done
          </p>
        </div>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {syncing ? (
            <>
              <span className="animate-spin">⟳</span>
              Syncing...
            </>
          ) : (
            <>🔄 Sync Now</>
          )}
        </button>
      </div>

      {/* Recent Sync Runs */}
      {syncRuns.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700">Recent Syncs</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {syncRuns.slice(0, 5).map((run) => (
              <div key={run.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                  run.status === "success" ? "bg-green-500" :
                  run.status === "error" ? "bg-red-500" :
                  "bg-amber-500 animate-pulse"
                }`} />
                <span className="text-slate-600 capitalize">{run.sync_type.replace("_", " ")}</span>
                {run.entities_fetched && (
                  <span className="text-slate-400">
                    {Object.values(run.entities_fetched).reduce((a, b) => a + b, 0)} fetched
                  </span>
                )}
                {run.error_message && (
                  <span className="text-red-500 truncate max-w-xs" title={run.error_message}>
                    {run.error_message.slice(0, 60)}
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-400">{formatTime(run.started_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="Receipts" value={stats.total_receipts} />
          <StatCard label="Matched" value={stats.matched_receipts} accent="green" />
          <StatCard label="Auto-Categorized" value={stats.auto_categorized} accent="purple" />
          <StatCard label="Pending Review" value={stats.pending_review} accent="amber" />
          <StatCard label="Rules Learned" value={stats.rules_count} accent="teal" />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading activity...
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">No activity yet</p>
          <p className="text-sm">
            Activity will appear here once receipts are processed or transactions are synced.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => {
            const actionInfo = ACTION_LABELS[entry.action] || {
              label: entry.action,
              color: "text-slate-600 bg-slate-50",
              icon: "📋",
            };

            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-b-0"
              >
                <span className="text-lg flex-shrink-0 mt-0.5">{actionInfo.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${actionInfo.color}`}>
                      {actionInfo.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      by {ACTOR_LABELS[entry.actor] || entry.actor}
                    </span>
                  </div>
                  {entry.details && (
                    <p className="text-sm text-slate-600 mt-0.5 truncate">
                      {formatDetails(entry.action, entry.details)}
                    </p>
                  )}
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0 mt-1">
                  {formatTime(entry.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "green" | "purple" | "amber" | "teal";
}) {
  const accentColors = {
    green: "text-green-700",
    purple: "text-purple-700",
    amber: "text-amber-700",
    teal: "text-teal-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className={`text-2xl font-bold ${accent ? accentColors[accent] : "text-slate-900"}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
