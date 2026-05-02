"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  TabHeader,
  TabErrorBanner,
  TabEmptyState,
  FilterPills,
  type FilterPillOption,
} from "@/components/tabs";

// ─── Types ──────────────────────────────────────────────────────────────

type EventSource = "sync" | "activity" | "finding";

interface UnifiedEvent {
  id: string;
  source: EventSource;
  timestamp: string;
  title: string;
  detail: string;
  status: "success" | "error" | "warning" | "info" | "running";
  actor: string;
  raw: any;
}

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

interface ActivityEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor: string;
  details: Record<string, any> | null;
  created_at: string;
}

interface IntegrityFinding {
  id: string;
  finding_type: string;
  severity: string;
  title: string;
  description: string;
  suggested_action: string | null;
  auto_fixable: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

const SOURCE_STYLES: Record<EventSource, { bg: string; text: string; label: string }> = {
  sync: { bg: "bg-indigo-50", text: "text-indigo-700", label: "Sync" },
  activity: { bg: "bg-blue-50", text: "text-blue-700", label: "Action" },
  finding: { bg: "bg-amber-50", text: "text-amber-700", label: "Finding" },
};

const STATUS_DOT: Record<string, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  running: "bg-amber-500 animate-pulse",
};

const FINDING_TYPE_LABELS: Record<string, string> = {
  missing_category: "Missing category",
  missing_receipt: "Missing receipt",
  duplicate: "Potential duplicate",
  stale_account: "Stale account",
  deleted_transactions: "Deleted transactions",
  negative_balance: "Negative balance",
  misclassification: "Misclassification",
};

const ACTION_LABELS: Record<string, string> = {
  receipt_parsed: "Receipt parsed",
  receipt_matched: "Receipt matched",
  auto_categorized: "Auto-categorized",
  manual_categorized: "Manually categorized",
  txn_synced: "QB sync completed",
  rule_created: "Rule learned",
  review_approved: "Review approved",
};

// ─── Helpers ────────────────────────────────────────────────────────────

function normalizeSyncRun(run: SyncRun): UnifiedEvent {
  const fetchedTotal = run.entities_fetched
    ? Object.values(run.entities_fetched).reduce((a, b) => a + b, 0)
    : 0;

  const parts: string[] = [];
  if (fetchedTotal > 0) parts.push(`${fetchedTotal} fetched`);
  if (run.entities_new > 0) parts.push(`${run.entities_new} new`);
  if (run.entities_updated > 0) parts.push(`${run.entities_updated} updated`);
  if (run.error_message) parts.push(run.error_message.slice(0, 100));

  return {
    id: `sync-${run.id}`,
    source: "sync",
    timestamp: run.started_at,
    title: `${run.sync_type.replace(/_/g, " ")}${run.since_date ? ` (since ${run.since_date})` : ""}`,
    detail: parts.join(" · ") || "No data",
    status: run.status === "success" ? "success" : run.status === "error" ? "error" : "running",
    actor: run.triggered_by || "cron",
    raw: run,
  };
}

function normalizeActivity(entry: ActivityEntry): UnifiedEvent {
  const d = entry.details || {};
  let detail = "";

  switch (entry.action) {
    case "txn_synced":
      detail = [
        d.fetched && `${d.fetched} fetched`,
        d.inserted && `${d.inserted} new`,
        d.updated && `${d.updated} updated`,
        d.auto_categorized && `${d.auto_categorized} auto-categorized`,
      ].filter(Boolean).join(" · ");
      break;
    case "receipt_parsed":
      detail = [d.vendor, d.amount && `$${d.amount}`, d.category].filter(Boolean).join(" · ");
      break;
    case "auto_categorized":
      detail = [d.vendor, d.category, d.confidence && `${Math.round(d.confidence * 100)}% confidence`].filter(Boolean).join(" · ");
      break;
    case "rule_created":
      detail = [d.vendor_pattern, d.category, d.match_type].filter(Boolean).join(" · ");
      break;
    default:
      detail = Object.entries(d).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ");
  }

  return {
    id: `act-${entry.id}`,
    source: "activity",
    timestamp: entry.created_at,
    title: ACTION_LABELS[entry.action] || entry.action.replace(/_/g, " "),
    detail,
    status: "info",
    actor: entry.actor,
    raw: entry,
  };
}

function normalizeFinding(finding: IntegrityFinding): UnifiedEvent {
  return {
    id: `find-${finding.id}`,
    source: "finding",
    timestamp: finding.created_at,
    title: FINDING_TYPE_LABELS[finding.finding_type] || finding.finding_type.replace(/_/g, " "),
    detail: finding.title + (finding.resolved_at ? " (resolved)" : ""),
    status: finding.resolved_at ? "success" : finding.severity === "critical" ? "error" : "warning",
    actor: "integrity-check",
    raw: finding,
  };
}

function formatTime(d: string): string {
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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatFullDate(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Component ──────────────────────────────────────────────────────────

type FilterSource = "all" | EventSource;

export default function AutoActionsPage() {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterSource>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ sync: 0, activity: 0, finding: 0 });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [syncRes, activityRes, findingRes] = await Promise.all([
        supabase
          .from("sync_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(50),
        supabase
          .from("bookkeeping_activity_log")
          .select("*")
          .in("actor", ["system", "ai"])
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("integrity_findings")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (syncRes.error) throw syncRes.error;
      if (activityRes.error) throw activityRes.error;
      if (findingRes.error) throw findingRes.error;

      const syncEvents = (syncRes.data || []).map(normalizeSyncRun);
      const activityEvents = (activityRes.data || []).map(normalizeActivity);
      const findingEvents = (findingRes.data || []).map(normalizeFinding);

      setCounts({
        sync: syncEvents.length,
        activity: activityEvents.length,
        finding: findingEvents.length,
      });

      const all = [...syncEvents, ...activityEvents, ...findingEvents]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setEvents(all);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = filter === "all" ? events : events.filter((e) => e.source === filter);

  // Summary stats
  const recentSyncs = events.filter((e) => e.source === "sync");
  const lastSuccessSync = recentSyncs.find((e) => e.status === "success");
  const lastErrorSync = recentSyncs.find((e) => e.status === "error");
  const unresolvedFindings = events.filter((e) => e.source === "finding" && e.status !== "success").length;
  const totalAutoActions = events.filter((e) => e.source === "activity").length;

  const filterOptions: FilterPillOption<FilterSource>[] = [
    { key: "all", label: `All (${events.length})` },
    { key: "sync", label: `Syncs (${counts.sync})` },
    { key: "activity", label: `Actions (${counts.activity})` },
    { key: "finding", label: `Findings (${counts.finding})` },
  ];

  return (
    <div className="max-w-4xl">
      <TabHeader
        title="AutoActions"
        description="Unified log of all automated system activity — syncs, AI actions, and integrity findings."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-indigo-700">{counts.sync}</div>
          <div className="text-xs text-slate-500 mt-0.5">Sync Runs</div>
          {lastSuccessSync && (
            <div className="text-[10px] text-green-600 mt-1">
              Last: {formatTime(lastSuccessSync.timestamp)}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-blue-700">{totalAutoActions}</div>
          <div className="text-xs text-slate-500 mt-0.5">Auto Actions</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className={`text-2xl font-bold ${unresolvedFindings > 0 ? "text-amber-600" : "text-green-700"}`}>
            {unresolvedFindings}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Open Findings</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className={`text-2xl font-bold ${lastErrorSync ? "text-red-600" : "text-green-700"}`}>
            {lastErrorSync ? "Error" : "Healthy"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">System Status</div>
          {lastErrorSync && (
            <div className="text-[10px] text-red-500 mt-1">
              {formatTime(lastErrorSync.timestamp)}
            </div>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
          Filter:
        </span>
        <FilterPills
          options={filterOptions}
          value={filter}
          onChange={setFilter}
          variant="slate"
          showCounts={false}
        />
        <button
          onClick={fetchAll}
          className="ml-auto text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
        >
          Refresh
        </button>
      </div>

      <TabErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Event list — uses rounded-lg (unlike the xl default) to match the list container below */}
      {loading ? (
        <div className="rounded-lg border border-slate-200 p-8 text-center text-slate-500">
          Loading automated actions...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">No automated actions recorded yet</p>
          <p className="text-sm">
            Actions will appear here once QB syncs run, AI categorizes transactions,
            or integrity checks detect issues.
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
          {filtered.map((event) => {
            const sourceStyle = SOURCE_STYLES[event.source];
            const isExpanded = expandedId === event.id;

            return (
              <div key={event.id} className="bg-white">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                >
                  {/* Status dot */}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[event.status]}`} />

                  {/* Source badge */}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${sourceStyle.bg} ${sourceStyle.text} flex-shrink-0`}>
                    {sourceStyle.label}
                  </span>

                  {/* Title & detail */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-900">{event.title}</span>
                    {event.detail && (
                      <span className="text-xs text-slate-500 ml-2 hidden sm:inline">
                        {event.detail.length > 80 ? event.detail.slice(0, 80) + "..." : event.detail}
                      </span>
                    )}
                  </div>

                  {/* Actor */}
                  <span className="text-[10px] text-slate-400 flex-shrink-0 hidden md:inline">
                    {event.actor}
                  </span>

                  {/* Time */}
                  <span className="text-xs text-slate-400 flex-shrink-0 w-16 text-right">
                    {formatTime(event.timestamp)}
                  </span>

                  {/* Expand arrow */}
                  <span className="text-slate-400 text-xs flex-shrink-0">
                    {isExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="font-semibold text-slate-500">Timestamp:</span>{" "}
                        <span className="text-slate-700">{formatFullDate(event.timestamp)}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Actor:</span>{" "}
                        <span className="text-slate-700">{event.actor}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Source:</span>{" "}
                        <span className="text-slate-700">{event.source}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Status:</span>{" "}
                        <span className="text-slate-700">{event.status}</span>
                      </div>
                    </div>
                    {event.detail && (
                      <div className="mt-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-500">Details: </span>
                        {event.detail}
                      </div>
                    )}
                    {/* Raw data preview for sync runs */}
                    {event.source === "sync" && event.raw.entities_fetched && (
                      <div className="mt-2 p-2 bg-white rounded border border-slate-200">
                        <div className="text-[10px] font-semibold text-slate-500 mb-1">Entities Fetched</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(event.raw.entities_fetched).map(([type, count]) => (
                            <span key={type} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] font-medium">
                              {type}: {String(count)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Duration for sync runs */}
                    {event.source === "sync" && event.raw.completed_at && (
                      <div className="mt-1 text-xs text-slate-500">
                        Duration: {Math.round((new Date(event.raw.completed_at).getTime() - new Date(event.raw.started_at).getTime()) / 1000)}s
                      </div>
                    )}
                    {/* Suggested action for findings */}
                    {event.source === "finding" && event.raw.suggested_action && (
                      <div className="mt-2 p-2 bg-amber-50 rounded border border-amber-200 text-xs text-amber-800">
                        <span className="font-semibold">Suggested action: </span>
                        {event.raw.suggested_action}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Data Sources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
          <div>
            <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold mr-1">Sync</span>
            <code className="bg-slate-100 px-1 rounded">sync_runs</code> &mdash; QB sync execution logs
          </div>
          <div>
            <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold mr-1">Action</span>
            <code className="bg-slate-100 px-1 rounded">bookkeeping_activity_log</code> &mdash; AI &amp; system actions
          </div>
          <div>
            <span className="inline-block px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold mr-1">Finding</span>
            <code className="bg-slate-100 px-1 rounded">integrity_findings</code> &mdash; data quality issues
          </div>
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          This view shows only automated (system &amp; AI) actions. Human actions are visible on the Bookkeeping &rarr; Activity tab.
        </p>
      </div>
    </div>
  );
}
