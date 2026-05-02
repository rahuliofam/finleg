"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const CONTEXT_WINDOW = 200_000;

interface Snapshot {
  snapshot_date: string;
  always_loaded_tokens: number;
  total_tokens: number;
}

function TokenHistoryChart({ snapshots, currentAlways }: { snapshots: Snapshot[]; currentAlways: number }) {
  if (snapshots.length === 0 && currentAlways === 0) return null;

  // Combine historical + today's live value
  const today = new Date().toISOString().split("T")[0];
  const points = [...snapshots.filter((s) => s.snapshot_date !== today)];
  if (currentAlways > 0) {
    points.push({ snapshot_date: today, always_loaded_tokens: currentAlways, total_tokens: 0 });
  }
  if (points.length < 2) {
    return (
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Always-Loaded Tokens — Last 90 Days</h3>
        <p className="text-xs text-slate-400">Not enough data yet. Check back tomorrow.</p>
      </div>
    );
  }

  points.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  const values = points.map((p) => p.always_loaded_tokens);
  const minVal = Math.min(...values) * 0.9;
  const maxVal = Math.max(...values) * 1.1;
  const range = maxVal - minVal || 1;

  const W = 700;
  const H = 180;
  const PAD = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const yScale = (v: number) => PAD.top + plotH - ((v - minVal) / range) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p.always_loaded_tokens).toFixed(1)}`).join(" ");
  const area = `${line} L${xScale(points.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${PAD.left},${(PAD.top + plotH).toFixed(1)} Z`;

  // Y-axis ticks
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount }, (_, i) => minVal + (range * i) / (tickCount - 1));

  // X-axis labels (show ~5 dates)
  const labelInterval = Math.max(1, Math.floor(points.length / 5));
  const xLabels = points.filter((_, i) => i % labelInterval === 0 || i === points.length - 1);

  const latest = values[values.length - 1];
  const earliest = values[0];
  const delta = latest - earliest;
  const deltaPct = earliest > 0 ? ((delta / earliest) * 100).toFixed(1) : "0";

  return (
    <div className="border border-slate-200 rounded-xl p-5 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Always-Loaded Tokens — Last 90 Days</h3>
          <p className="text-xs text-slate-400 mt-0.5">{points.length} data points</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-slate-900 tabular-nums">{formatTokens(latest)}</div>
          <div className={`text-xs font-medium tabular-nums ${delta > 0 ? "text-red-500" : delta < 0 ? "text-emerald-500" : "text-slate-400"}`}>
            {delta > 0 ? "+" : ""}{formatTokens(delta)} ({delta > 0 ? "+" : ""}{deltaPct}%)
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
        {/* Grid lines */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yScale(v)} y2={yScale(v)} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={PAD.left - 6} y={yScale(v) + 3} textAnchor="end" className="fill-slate-400" fontSize={9}>
              {formatTokens(Math.round(v))}
            </text>
          </g>
        ))}
        {/* Area fill */}
        <path d={area} fill="url(#areaGrad)" />
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Line */}
        <path d={line} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" />
        {/* Data points */}
        {points.map((p, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(p.always_loaded_tokens)} r={points.length > 30 ? 1.5 : 3} fill="#6366f1" />
        ))}
        {/* X labels */}
        {xLabels.map((p) => {
          const i = points.indexOf(p);
          const d = new Date(p.snapshot_date + "T00:00:00");
          const label = `${d.getMonth() + 1}/${d.getDate()}`;
          return (
            <text key={p.snapshot_date} x={xScale(i)} y={H - 5} textAnchor="middle" className="fill-slate-400" fontSize={9}>
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function charsToTokens(chars: number): number {
  return Math.round(chars / 4);
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

interface ContextItem {
  name: string;
  path: string;
  category: "instructions" | "memory" | "docs" | "system";
  description: string;
  chars: number;
  tokens: number;
}

const CONTEXT_FILES: { name: string; path: string; category: ContextItem["category"]; description: string; githubPath?: string }[] = [
  { name: "Global CLAUDE.md", path: "~/.claude/CLAUDE.md", category: "instructions", description: "User's private global instructions for all projects" },
  { name: "Project CLAUDE.md", path: "./CLAUDE.md", category: "instructions", description: "Project-specific directives, mandatory behaviors, code guards", githubPath: "CLAUDE.md" },
  { name: "MEMORY.md", path: "~/.claude/projects/.../memory/MEMORY.md", category: "memory", description: "Memory index — pointers to all saved memories" },
  { name: "feedback_always_give_urls.md", path: "memory/", category: "memory", description: "Always provide test URLs after changes" },
  { name: "feedback_deep_links.md", path: "memory/", category: "memory", description: "Always provide deepest possible direct URLs" },
  { name: "feedback_hostinger_batch_jobs.md", path: "memory/", category: "memory", description: "Use Hostinger VPS + Claude CLI for batch jobs" },
  { name: "feedback_ssh_for_remote_volumes.md", path: "memory/", category: "memory", description: "SSH into Alpaca Mac for remote volumes" },
  { name: "reference_alpaca_mac.md", path: "memory/", category: "memory", description: "SSH access, RVAULT20, Google Takeout location" },
  { name: "reference_test_account.md", path: "memory/", category: "memory", description: "Test account credentials for browser testing" },
  { name: "SCHEMA.md", path: "docs/SCHEMA.md", category: "docs", description: "Database schema — loaded for queries, table modifications", githubPath: "docs/SCHEMA.md" },
  { name: "PATTERNS.md", path: "docs/PATTERNS.md", category: "docs", description: "UI code, Tailwind styling, code review patterns", githubPath: "docs/PATTERNS.md" },
  { name: "KEY-FILES.md", path: "docs/KEY-FILES.md", category: "docs", description: "Project structure and file locations", githubPath: "docs/KEY-FILES.md" },
  { name: "DEPLOY.md", path: "docs/DEPLOY.md", category: "docs", description: "Deployment, pushing, version management", githubPath: "docs/DEPLOY.md" },
  { name: "INTEGRATIONS.md", path: "docs/INTEGRATIONS.md", category: "docs", description: "External APIs, vendor setup, pricing", githubPath: "docs/INTEGRATIONS.md" },
  { name: "CHANGELOG.md", path: "docs/CHANGELOG.md", category: "docs", description: "Recent changes, migration context", githubPath: "docs/CHANGELOG.md" },
  { name: "DATA-ARCHITECTURE.md", path: "docs/DATA-ARCHITECTURE.md", category: "docs", description: "Data architecture documentation", githubPath: "docs/DATA-ARCHITECTURE.md" },
  { name: "System prompt", path: "(built-in)", category: "system", description: "Claude's base system prompt, tool definitions, environment info" },
];

const SYSTEM_PROMPT_ESTIMATE = 8000;

const CATEGORY_LABELS: Record<string, { label: string; bg: string; text: string; bar: string }> = {
  instructions: { label: "Instructions", bg: "bg-blue-50", text: "text-blue-700", bar: "bg-blue-400" },
  memory: { label: "Memory", bg: "bg-purple-50", text: "text-purple-700", bar: "bg-purple-400" },
  docs: { label: "On-Demand Docs", bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-400" },
  system: { label: "System", bg: "bg-slate-100", text: "text-slate-600", bar: "bg-slate-400" },
};

/**
 * Renders context-window usage for Claude dev sessions. Side effect: on mount
 * upserts today's row into `context_snapshots` (keyed by snapshot_date) so the
 * 90-day trend chart gains a data point per day the page is opened.
 */
export function ContextTab() {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  // Fetch last 90 days of snapshots
  useEffect(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    supabase
      .from("context_snapshots")
      .select("snapshot_date, always_loaded_tokens, total_tokens")
      .gte("snapshot_date", cutoff.toISOString().split("T")[0])
      .order("snapshot_date")
      .then(({ data }) => {
        if (data) setSnapshots(data);
      });
  }, []);

  useEffect(() => {
    async function loadSizes() {
      const fetchPromises = CONTEXT_FILES.map(async (file) => {
        if (file.category === "system") {
          return { ...file, chars: SYSTEM_PROMPT_ESTIMATE * 4, tokens: SYSTEM_PROMPT_ESTIMATE };
        }
        if (file.githubPath) {
          try {
            const res = await fetch(`https://raw.githubusercontent.com/rahulio96/finleg/main/${file.githubPath}`);
            if (res.ok) {
              const text = await res.text();
              return { ...file, chars: text.length, tokens: charsToTokens(text.length) };
            }
          } catch {}
        }
        const estimates: Record<string, number> = {
          "Global CLAUDE.md": 1048, "MEMORY.md": 600,
          "feedback_always_give_urls.md": 200, "feedback_deep_links.md": 250,
          "feedback_hostinger_batch_jobs.md": 300, "feedback_ssh_for_remote_volumes.md": 200,
          "reference_alpaca_mac.md": 400, "reference_test_account.md": 150,
        };
        const chars = estimates[file.name] || 200;
        return { ...file, chars, tokens: charsToTokens(chars) };
      });
      const loaded = await Promise.all(fetchPromises);
      setItems(loaded);
      setLoading(false);

      // Record today's snapshot
      const always = loaded.filter((i) => i.category !== "docs").reduce((s, i) => s + i.tokens, 0);
      const total = loaded.reduce((s, i) => s + i.tokens, 0);
      const breakdown = loaded.reduce<Record<string, number>>((acc, i) => {
        acc[i.category] = (acc[i.category] || 0) + i.tokens;
        return acc;
      }, {});
      supabase.from("context_snapshots").upsert(
        { snapshot_date: new Date().toISOString().split("T")[0], always_loaded_tokens: always, total_tokens: total, breakdown },
        { onConflict: "snapshot_date" }
      );
    }
    loadSizes();
  }, []);

  const alwaysLoaded = items.filter((i) => i.category !== "docs");
  const onDemand = items.filter((i) => i.category === "docs");
  const alwaysTokens = alwaysLoaded.reduce((sum, i) => sum + i.tokens, 0);
  const onDemandTokens = onDemand.reduce((sum, i) => sum + i.tokens, 0);
  const totalTokens = alwaysTokens + onDemandTokens;
  const alwaysPct = ((alwaysTokens / CONTEXT_WINDOW) * 100).toFixed(1);
  const totalPct = ((totalTokens / CONTEXT_WINDOW) * 100).toFixed(1);

  const categoryTotals = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + i.tokens;
    return acc;
  }, {});

  if (loading) {
    return <div className="text-center py-12 text-slate-400">Loading file sizes...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Context Window</h1>
        <p className="text-sm text-slate-500">
          {formatTokens(alwaysTokens)} tokens loaded on startup ({alwaysPct}% of {formatTokens(CONTEXT_WINDOW)} window)
        </p>
      </div>

      {/* 90-day token history chart */}
      <TokenHistoryChart snapshots={snapshots} currentAlways={alwaysTokens} />

      {/* Context window usage bar */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
          <span>Context Window Usage</span>
          <span>{formatTokens(CONTEXT_WINDOW)} total capacity</span>
        </div>
        <div className="h-8 bg-slate-100 rounded-lg overflow-hidden flex">
          {Object.entries(categoryTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, tokens]) => (
              <div
                key={cat}
                className={`${CATEGORY_LABELS[cat]?.bar || "bg-slate-300"} h-full`}
                style={{ width: `${(tokens / CONTEXT_WINDOW) * 100}%` }}
                title={`${CATEGORY_LABELS[cat]?.label}: ${formatTokens(tokens)} tokens`}
              />
            ))}
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          {Object.entries(categoryTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, tokens]) => (
              <div key={cat} className="flex items-center gap-1.5 text-xs text-slate-600">
                <div className={`w-2.5 h-2.5 rounded-sm ${CATEGORY_LABELS[cat]?.bar}`} />
                <span className="font-medium">{CATEGORY_LABELS[cat]?.label}</span>
                <span className="text-slate-400">
                  {formatTokens(tokens)} ({((tokens / CONTEXT_WINDOW) * 100).toFixed(1)}%)
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Always Loaded", value: formatTokens(alwaysTokens), sub: `${alwaysPct}%`, color: "text-emerald-700" },
          { label: "On-Demand Docs", value: formatTokens(onDemandTokens), sub: "loaded as needed", color: "text-amber-700" },
          { label: "Total if All Loaded", value: formatTokens(totalTokens), sub: `${totalPct}%`, color: "text-blue-700" },
          { label: "Remaining for Chat", value: formatTokens(CONTEXT_WINDOW - alwaysTokens), sub: `${(100 - parseFloat(alwaysPct)).toFixed(1)}%`, color: "text-purple-700" },
        ].map((s) => (
          <div key={s.label} className="border border-slate-200 rounded-xl px-4 py-4 text-center bg-white">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Always loaded files */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Always Loaded at Startup</h2>
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium">File</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium hidden sm:table-cell">Description</th>
                <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Tokens</th>
                <th className="text-right px-4 py-2.5 text-slate-500 font-medium">% of Window</th>
              </tr>
            </thead>
            <tbody>
              {alwaysLoaded.sort((a, b) => b.tokens - a.tokens).map((item) => (
                <tr key={item.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${CATEGORY_LABELS[item.category]?.bar}`} />
                      <span className="text-slate-800 font-mono text-xs">{item.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs hidden sm:table-cell">{item.description}</td>
                  <td className="px-4 py-2.5 text-slate-700 text-right tabular-nums font-medium">{formatTokens(item.tokens)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-slate-500 tabular-nums text-xs">{((item.tokens / CONTEXT_WINDOW) * 100).toFixed(2)}%</span>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-4 py-2.5 text-slate-800 font-semibold">Total</td>
                <td className="px-4 py-2.5 hidden sm:table-cell" />
                <td className="px-4 py-2.5 text-slate-900 text-right tabular-nums font-bold">{formatTokens(alwaysTokens)}</td>
                <td className="px-4 py-2.5 text-right"><span className="text-slate-700 tabular-nums text-xs font-semibold">{alwaysPct}%</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* On-demand docs */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-1">On-Demand Docs</h2>
        <p className="text-xs text-slate-400 mb-3">Loaded when the task matches — not always in context</p>
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium">File</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-medium hidden sm:table-cell">Loaded For</th>
                <th className="text-right px-4 py-2.5 text-slate-500 font-medium">Tokens</th>
                <th className="text-right px-4 py-2.5 text-slate-500 font-medium">% of Window</th>
              </tr>
            </thead>
            <tbody>
              {onDemand.sort((a, b) => b.tokens - a.tokens).map((item) => (
                <tr key={item.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${CATEGORY_LABELS[item.category]?.bar}`} />
                      <span className="text-slate-800 font-mono text-xs">{item.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs hidden sm:table-cell">{item.description}</td>
                  <td className="px-4 py-2.5 text-slate-700 text-right tabular-nums font-medium">{formatTokens(item.tokens)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-slate-500 tabular-nums text-xs">{((item.tokens / CONTEXT_WINDOW) * 100).toFixed(2)}%</span>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50">
                <td className="px-4 py-2.5 text-slate-800 font-semibold">Total</td>
                <td className="px-4 py-2.5 hidden sm:table-cell" />
                <td className="px-4 py-2.5 text-slate-900 text-right tabular-nums font-bold">{formatTokens(onDemandTokens)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className="text-slate-700 tabular-nums text-xs font-semibold">{((onDemandTokens / CONTEXT_WINDOW) * 100).toFixed(1)}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
