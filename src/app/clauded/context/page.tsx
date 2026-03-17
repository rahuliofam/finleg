"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const CONTEXT_WINDOW = 200_000; // Claude's context window in tokens

// Rough estimate: ~4 chars per token for English text
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

// Files that Claude loads into context at session start
const CONTEXT_FILES: { name: string; path: string; category: ContextItem["category"]; description: string; githubPath?: string }[] = [
  // Instructions
  { name: "Global CLAUDE.md", path: "~/.claude/CLAUDE.md", category: "instructions", description: "User's private global instructions for all projects" },
  { name: "Project CLAUDE.md", path: "./CLAUDE.md", category: "instructions", description: "Project-specific directives, mandatory behaviors, code guards", githubPath: "CLAUDE.md" },
  // Memory
  { name: "MEMORY.md", path: "~/.claude/projects/.../memory/MEMORY.md", category: "memory", description: "Memory index — pointers to all saved memories" },
  { name: "feedback_always_give_urls.md", path: "memory/", category: "memory", description: "Always provide test URLs after changes" },
  { name: "feedback_deep_links.md", path: "memory/", category: "memory", description: "Always provide deepest possible direct URLs" },
  { name: "feedback_hostinger_batch_jobs.md", path: "memory/", category: "memory", description: "Use Hostinger VPS + Claude CLI for batch jobs" },
  { name: "feedback_ssh_for_remote_volumes.md", path: "memory/", category: "memory", description: "SSH into Alpaca Mac for remote volumes" },
  { name: "reference_alpaca_mac.md", path: "memory/", category: "memory", description: "SSH access, RVAULT20, Google Takeout location" },
  { name: "reference_test_account.md", path: "memory/", category: "memory", description: "Test account credentials for browser testing" },
  // Docs (loaded on-demand per CLAUDE.md)
  { name: "SCHEMA.md", path: "docs/SCHEMA.md", category: "docs", description: "Database schema — loaded for queries, table modifications", githubPath: "docs/SCHEMA.md" },
  { name: "PATTERNS.md", path: "docs/PATTERNS.md", category: "docs", description: "UI code, Tailwind styling, code review patterns", githubPath: "docs/PATTERNS.md" },
  { name: "KEY-FILES.md", path: "docs/KEY-FILES.md", category: "docs", description: "Project structure and file locations", githubPath: "docs/KEY-FILES.md" },
  { name: "DEPLOY.md", path: "docs/DEPLOY.md", category: "docs", description: "Deployment, pushing, version management", githubPath: "docs/DEPLOY.md" },
  { name: "INTEGRATIONS.md", path: "docs/INTEGRATIONS.md", category: "docs", description: "External APIs, vendor setup, pricing", githubPath: "docs/INTEGRATIONS.md" },
  { name: "CHANGELOG.md", path: "docs/CHANGELOG.md", category: "docs", description: "Recent changes, migration context", githubPath: "docs/CHANGELOG.md" },
  { name: "DATA-ARCHITECTURE.md", path: "docs/DATA-ARCHITECTURE.md", category: "docs", description: "Data architecture documentation", githubPath: "docs/DATA-ARCHITECTURE.md" },
  // System
  { name: "System prompt", path: "(built-in)", category: "system", description: "Claude's base system prompt, tool definitions, environment info" },
];

const SYSTEM_PROMPT_ESTIMATE = 8000; // ~8k tokens for system prompt + tool defs

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  instructions: { label: "Instructions", color: "bg-blue-500" },
  memory: { label: "Memory", color: "bg-purple-500" },
  docs: { label: "On-Demand Docs", color: "bg-amber-500" },
  system: { label: "System", color: "bg-slate-500" },
};

export default function ContextPage() {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSizes() {
      const results: ContextItem[] = [];

      // Fetch file sizes from GitHub raw content
      const fetchPromises = CONTEXT_FILES.map(async (file) => {
        if (file.category === "system") {
          return {
            ...file,
            chars: SYSTEM_PROMPT_ESTIMATE * 4,
            tokens: SYSTEM_PROMPT_ESTIMATE,
          };
        }

        if (file.githubPath) {
          try {
            const res = await fetch(
              `https://raw.githubusercontent.com/rahulio96/finleg/main/${file.githubPath}`
            );
            if (res.ok) {
              const text = await res.text();
              return {
                ...file,
                chars: text.length,
                tokens: charsToTokens(text.length),
              };
            }
          } catch {}
        }

        // For local-only files (global CLAUDE.md, memory files), use estimates
        const estimates: Record<string, number> = {
          "Global CLAUDE.md": 1048,
          "MEMORY.md": 600,
          "feedback_always_give_urls.md": 200,
          "feedback_deep_links.md": 250,
          "feedback_hostinger_batch_jobs.md": 300,
          "feedback_ssh_for_remote_volumes.md": 200,
          "reference_alpaca_mac.md": 400,
          "reference_test_account.md": 150,
        };

        const chars = estimates[file.name] || 200;
        return { ...file, chars, tokens: charsToTokens(chars) };
      });

      const resolved = await Promise.all(fetchPromises);
      setItems(resolved);
      setLoading(false);
    }

    loadSizes();
  }, []);

  // Split into always-loaded vs on-demand
  const alwaysLoaded = items.filter((i) => i.category !== "docs");
  const onDemand = items.filter((i) => i.category === "docs");

  const alwaysTokens = alwaysLoaded.reduce((sum, i) => sum + i.tokens, 0);
  const onDemandTokens = onDemand.reduce((sum, i) => sum + i.tokens, 0);
  const totalTokens = alwaysTokens + onDemandTokens;
  const alwaysPct = ((alwaysTokens / CONTEXT_WINDOW) * 100).toFixed(1);
  const totalPct = ((totalTokens / CONTEXT_WINDOW) * 100).toFixed(1);

  // Category breakdown for the bar
  const categoryTotals = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + i.tokens;
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-4">
        <Link
          href="/clauded"
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          &larr; Clauded
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-white mb-1">Context Window</h1>
      <p className="text-sm text-slate-400 mb-8">
        {loading
          ? "Loading file sizes..."
          : `${formatTokens(alwaysTokens)} tokens loaded on startup (${alwaysPct}% of ${formatTokens(CONTEXT_WINDOW)} window)`}
      </p>

      {loading ? (
        <div className="rounded-xl border border-slate-700 p-8 text-center text-slate-400">
          Loading...
        </div>
      ) : (
        <div className="space-y-8">
          {/* Context window usage bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>Context Window Usage</span>
              <span>{formatTokens(CONTEXT_WINDOW)} total capacity</span>
            </div>
            <div className="h-8 bg-slate-800 rounded-lg overflow-hidden flex">
              {Object.entries(categoryTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, tokens]) => (
                  <div
                    key={cat}
                    className={`${CATEGORY_LABELS[cat]?.color || "bg-slate-600"} h-full relative group`}
                    style={{ width: `${(tokens / CONTEXT_WINDOW) * 100}%` }}
                    title={`${CATEGORY_LABELS[cat]?.label}: ${formatTokens(tokens)} tokens`}
                  />
                ))}
            </div>
            <div className="flex flex-wrap gap-4 mt-2">
              {Object.entries(categoryTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, tokens]) => (
                  <div key={cat} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <div className={`w-2.5 h-2.5 rounded-sm ${CATEGORY_LABELS[cat]?.color}`} />
                    <span>{CATEGORY_LABELS[cat]?.label}</span>
                    <span className="text-slate-500">
                      {formatTokens(tokens)} ({((tokens / CONTEXT_WINDOW) * 100).toFixed(1)}%)
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Always Loaded", value: formatTokens(alwaysTokens), sub: `${alwaysPct}%` },
              { label: "On-Demand Docs", value: formatTokens(onDemandTokens), sub: "loaded as needed" },
              { label: "Total if All Loaded", value: formatTokens(totalTokens), sub: `${totalPct}%` },
              { label: "Remaining for Chat", value: formatTokens(CONTEXT_WINDOW - alwaysTokens), sub: `${(100 - parseFloat(alwaysPct)).toFixed(1)}%` },
            ].map((s) => (
              <div
                key={s.label}
                className="border border-slate-700 rounded-lg px-4 py-4 text-center bg-slate-900/50"
              >
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-slate-400 mt-1">{s.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Always loaded files */}
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-3">
              Always Loaded at Startup
            </h2>
            <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left px-4 py-2 text-slate-400 font-medium">File</th>
                    <th className="text-left px-4 py-2 text-slate-400 font-medium hidden sm:table-cell">Description</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">Tokens</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">% of Window</th>
                  </tr>
                </thead>
                <tbody>
                  {alwaysLoaded
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((item) => (
                      <tr key={item.name} className="border-b border-slate-800 last:border-0">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${CATEGORY_LABELS[item.category]?.color}`} />
                            <span className="text-slate-200 font-mono text-xs">{item.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-500 text-xs hidden sm:table-cell">
                          {item.description}
                        </td>
                        <td className="px-4 py-2 text-slate-300 text-right tabular-nums">
                          {formatTokens(item.tokens)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-slate-400 tabular-nums text-xs">
                            {((item.tokens / CONTEXT_WINDOW) * 100).toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  <tr className="border-t border-slate-600 bg-slate-800/50">
                    <td className="px-4 py-2 text-slate-300 font-semibold">Total</td>
                    <td className="px-4 py-2 hidden sm:table-cell" />
                    <td className="px-4 py-2 text-white text-right tabular-nums font-semibold">
                      {formatTokens(alwaysTokens)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-white tabular-nums text-xs font-semibold">
                        {alwaysPct}%
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* On-demand docs */}
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">
              On-Demand Docs
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Loaded when the task matches — not always in context
            </p>
            <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-900/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left px-4 py-2 text-slate-400 font-medium">File</th>
                    <th className="text-left px-4 py-2 text-slate-400 font-medium hidden sm:table-cell">Loaded For</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">Tokens</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium">% of Window</th>
                  </tr>
                </thead>
                <tbody>
                  {onDemand
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((item) => (
                      <tr key={item.name} className="border-b border-slate-800 last:border-0">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${CATEGORY_LABELS[item.category]?.color}`} />
                            <span className="text-slate-200 font-mono text-xs">{item.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-500 text-xs hidden sm:table-cell">
                          {item.description}
                        </td>
                        <td className="px-4 py-2 text-slate-300 text-right tabular-nums">
                          {formatTokens(item.tokens)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-slate-400 tabular-nums text-xs">
                            {((item.tokens / CONTEXT_WINDOW) * 100).toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  <tr className="border-t border-slate-600 bg-slate-800/50">
                    <td className="px-4 py-2 text-slate-300 font-semibold">Total</td>
                    <td className="px-4 py-2 hidden sm:table-cell" />
                    <td className="px-4 py-2 text-white text-right tabular-nums font-semibold">
                      {formatTokens(onDemandTokens)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-white tabular-nums text-xs font-semibold">
                        {((onDemandTokens / CONTEXT_WINDOW) * 100).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
