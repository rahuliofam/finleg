"use client";

import { useState, useEffect } from "react";

const API_BASE = "https://claude-sessions.finleg.workers.dev";
const API_TOKEN = "alpaca-sessions-2026";

interface Stats {
  total_sessions: number;
  total_tokens: number;
  total_cost: number;
  total_minutes: number;
  avg_tokens: number;
  avg_duration: number;
}

interface Session {
  id: string;
  project: string;
  model: string;
  started_at: string;
  token_count: number;
  cost_usd: number;
}

function fmt(n: number) {
  if (!n) return "0";
  return n.toLocaleString();
}

function fmtCost(n: number) {
  if (!n) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function groupBy<K extends string>(sessions: Session[], keyFn: (s: Session) => K) {
  const map: Record<string, { tokens: number; sessions: number; cost: number }> = {};
  for (const s of sessions) {
    const k = keyFn(s);
    if (!map[k]) map[k] = { tokens: 0, sessions: 0, cost: 0 };
    map[k].tokens += s.token_count || 0;
    map[k].sessions += 1;
    map[k].cost += s.cost_usd || 0;
  }
  return Object.entries(map)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.tokens - a.tokens);
}

function groupByDay(sessions: Session[]) {
  const map: Record<string, { tokens: number; sessions: number }> = {};
  for (const s of sessions) {
    const d = s.started_at
      ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "unknown";
    if (!map[d]) map[d] = { tokens: 0, sessions: 0 };
    map[d].tokens += s.token_count || 0;
    map[d].sessions += 1;
  }
  return Object.entries(map)
    .map(([date, data]) => ({ date, ...data }))
    .reverse();
}

export function TokensTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const headers = { Authorization: `Bearer ${API_TOKEN}` };
    Promise.all([
      fetch(`${API_BASE}/stats`, { headers }).then((r) => r.ok ? r.json() : null),
      fetch(`${API_BASE}/sessions?limit=200`, { headers }).then((r) => r.ok ? r.json() : null),
    ]).then(([s, d]) => {
      if (s) setStats(s);
      if (d) setSessions(d.sessions || d || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const byProject = groupBy(sessions, (s) => s.project || "unknown");
  const byModel = groupBy(sessions, (s) =>
    s.model ? s.model.replace("claude-", "").split("-202")[0] : "unknown"
  );
  const byDay = groupByDay(sessions);
  const maxDayTokens = Math.max(...byDay.map((d) => d.tokens), 1);

  if (loading) {
    return <div className="text-center py-12 text-slate-400">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Tokens & Cost</h1>
        <p className="text-sm text-slate-500">Token usage, costs, and session analytics</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Tokens", value: fmt(stats?.total_tokens || 0), color: "text-emerald-700" },
          { label: "Total Cost", value: fmtCost(stats?.total_cost || 0), color: "text-amber-700" },
          { label: "Avg / Session", value: fmt(Math.round(stats?.avg_tokens || 0)), color: "text-blue-700" },
          { label: "Sessions", value: fmt(stats?.total_sessions || 0), color: "text-purple-700" },
        ].map((s) => (
          <div key={s.label} className="border border-slate-200 rounded-xl px-4 py-4 text-center bg-white">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Daily usage chart */}
      {byDay.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Daily Token Usage</h2>
          <div className="border border-slate-200 rounded-xl p-4 bg-white">
            <div className="space-y-2">
              {byDay.map((day) => (
                <div key={day.date} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 shrink-0">{day.date}</span>
                  <div className="flex-1 h-7 bg-slate-100 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-lg"
                      style={{ width: `${(day.tokens / maxDayTokens) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-600 tabular-nums w-20 text-right font-medium">
                    {fmt(day.tokens)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* By project */}
      {byProject.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">By Project</h2>
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Project</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Sessions</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Tokens</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byProject.map((row) => (
                  <tr key={row.key} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-800 font-medium">{row.key}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-right tabular-nums">{row.sessions}</td>
                    <td className="px-4 py-2.5 text-slate-700 text-right tabular-nums">{fmt(row.tokens)}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-right tabular-nums">{fmtCost(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By model */}
      {byModel.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">By Model</h2>
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Model</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Sessions</th>
                  <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((row) => (
                  <tr key={row.key} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-800 font-mono text-xs">{row.key}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-right tabular-nums">{row.sessions}</td>
                    <td className="px-4 py-2.5 text-slate-700 text-right tabular-nums">{fmt(row.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
