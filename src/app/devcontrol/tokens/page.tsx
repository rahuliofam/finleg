"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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
  ended_at: string;
  duration_mins: number;
  summary: string;
  token_count: number;
  cost_usd: number;
  tags: string;
}

function formatNumber(n: number) {
  if (!n) return "0";
  return n.toLocaleString();
}

function formatCost(n: number) {
  if (!n) return "$0.00";
  return `$${n.toFixed(2)}`;
}

// Group sessions by project and sum tokens
function groupByProject(sessions: Session[]): { project: string; tokens: number; sessions: number; cost: number }[] {
  const map: Record<string, { tokens: number; sessions: number; cost: number }> = {};
  for (const s of sessions) {
    const p = s.project || "unknown";
    if (!map[p]) map[p] = { tokens: 0, sessions: 0, cost: 0 };
    map[p].tokens += s.token_count || 0;
    map[p].sessions += 1;
    map[p].cost += s.cost_usd || 0;
  }
  return Object.entries(map)
    .map(([project, data]) => ({ project, ...data }))
    .sort((a, b) => b.tokens - a.tokens);
}

// Group sessions by model and sum tokens
function groupByModel(sessions: Session[]): { model: string; tokens: number; sessions: number }[] {
  const map: Record<string, { tokens: number; sessions: number }> = {};
  for (const s of sessions) {
    const m = s.model ? s.model.replace("claude-", "").split("-202")[0] : "unknown";
    if (!map[m]) map[m] = { tokens: 0, sessions: 0 };
    map[m].tokens += s.token_count || 0;
    map[m].sessions += 1;
  }
  return Object.entries(map)
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.tokens - a.tokens);
}

// Group by day for the last 7 days
function groupByDay(sessions: Session[]): { date: string; tokens: number; sessions: number }[] {
  const map: Record<string, { tokens: number; sessions: number }> = {};
  for (const s of sessions) {
    const d = s.started_at ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "unknown";
    if (!map[d]) map[d] = { tokens: 0, sessions: 0 };
    map[d].tokens += s.token_count || 0;
    map[d].sessions += 1;
  }
  return Object.entries(map)
    .map(([date, data]) => ({ date, ...data }))
    .reverse();
}

export default function TokensPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${API_TOKEN}` };

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, sessionsRes] = await Promise.all([
          fetch(`${API_BASE}/stats`, { headers }),
          fetch(`${API_BASE}/sessions?limit=200`, { headers }),
        ]);

        if (statsRes.ok) setStats(await statsRes.json());
        if (sessionsRes.ok) {
          const data = await sessionsRes.json();
          setSessions(data.sessions || data || []);
        }
      } catch (e) {
        console.error("Failed to load token data:", e);
      }
      setLoading(false);
    }
    load();
  }, []);

  const byProject = groupByProject(sessions);
  const byModel = groupByModel(sessions);
  const byDay = groupByDay(sessions);
  const maxDayTokens = Math.max(...byDay.map((d) => d.tokens), 1);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-4">
        <Link
          href="/devcontrol"
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          ← DevControl
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white mb-1">Tokens & Context</h1>
      <p className="text-sm text-slate-400 mb-8">
        {loading ? "Loading..." : "Token usage, costs, and context window analytics"}
      </p>

      {loading ? (
        <div className="rounded-xl border border-slate-700 p-8 text-center text-slate-400">
          Loading...
        </div>
      ) : (
        <div className="space-y-8">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Tokens", value: formatNumber(stats?.total_tokens || 0) },
              { label: "Total Cost", value: formatCost(stats?.total_cost || 0) },
              { label: "Avg Tokens/Session", value: formatNumber(Math.round(stats?.avg_tokens || 0)) },
              { label: "Total Sessions", value: formatNumber(stats?.total_sessions || 0) },
            ].map((s) => (
              <div
                key={s.label}
                className="border border-slate-700 rounded-lg px-4 py-4 text-center bg-slate-900/50"
              >
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-slate-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Daily usage chart */}
          {byDay.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Daily Token Usage</h2>
              <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/50">
                <div className="space-y-2">
                  {byDay.map((day) => (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-16 shrink-0">{day.date}</span>
                      <div className="flex-1 h-6 bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded"
                          style={{ width: `${(day.tokens / maxDayTokens) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 tabular-nums w-20 text-right">
                        {formatNumber(day.tokens)}
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
              <h2 className="text-sm font-semibold text-slate-300 mb-3">By Project</h2>
              <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left px-4 py-2 text-slate-400 font-medium">Project</th>
                      <th className="text-right px-4 py-2 text-slate-400 font-medium">Sessions</th>
                      <th className="text-right px-4 py-2 text-slate-400 font-medium">Tokens</th>
                      <th className="text-right px-4 py-2 text-slate-400 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProject.map((row) => (
                      <tr key={row.project} className="border-b border-slate-800 last:border-0">
                        <td className="px-4 py-2 text-slate-200">{row.project}</td>
                        <td className="px-4 py-2 text-slate-400 text-right tabular-nums">{row.sessions}</td>
                        <td className="px-4 py-2 text-slate-300 text-right tabular-nums">{formatNumber(row.tokens)}</td>
                        <td className="px-4 py-2 text-slate-400 text-right tabular-nums">{formatCost(row.cost)}</td>
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
              <h2 className="text-sm font-semibold text-slate-300 mb-3">By Model</h2>
              <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left px-4 py-2 text-slate-400 font-medium">Model</th>
                      <th className="text-right px-4 py-2 text-slate-400 font-medium">Sessions</th>
                      <th className="text-right px-4 py-2 text-slate-400 font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byModel.map((row) => (
                      <tr key={row.model} className="border-b border-slate-800 last:border-0">
                        <td className="px-4 py-2 text-slate-200 font-mono text-xs">{row.model}</td>
                        <td className="px-4 py-2 text-slate-400 text-right tabular-nums">{row.sessions}</td>
                        <td className="px-4 py-2 text-slate-300 text-right tabular-nums">{formatNumber(row.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {sessions.length === 0 && (
            <div className="rounded-xl border border-slate-700 p-8 text-center text-slate-400">
              No session data available yet. Sessions will appear here once the Claude Sessions worker is populated.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
