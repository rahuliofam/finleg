"use client";

import { useEffect, useState } from "react";

const REPO = "rahuliofam/finleg";
const GH_API = `https://api.github.com/repos/${REPO}/pulls`;

interface PR {
  number: number;
  title: string;
  merged_at: string;
  html_url: string;
  user: { login: string; avatar_url: string };
  labels: { name: string; color: string }[];
}

function categorize(title: string): { label: string; color: string } {
  const t = title.toLowerCase();
  if (t.startsWith("fix") || t.includes("bug")) return { label: "Fix", color: "rose" };
  if (t.includes("add") || t.includes("new")) return { label: "New", color: "emerald" };
  if (t.includes("rewrite") || t.includes("refactor") || t.includes("redesign"))
    return { label: "Rewrite", color: "violet" };
  return { label: "Update", color: "sky" };
}

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDate(prs: PR[]): { label: string; prs: PR[] }[] {
  const groups: Map<string, PR[]> = new Map();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const pr of prs) {
    const d = new Date(pr.merged_at).toDateString();
    let label: string;
    if (d === today) label = "Today";
    else if (d === yesterday) label = "Yesterday";
    else
      label = new Date(pr.merged_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(pr);
  }

  return Array.from(groups.entries()).map(([label, prs]) => ({ label, prs }));
}

const TAG_COLORS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
};

export function ReleasesTab() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPRs() {
      try {
        const res = await fetch(
          `${GH_API}?state=closed&sort=updated&direction=desc&per_page=50`
        );
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data: PR[] = await res.json();
        setPrs(data.filter((pr) => pr.merged_at));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      }
      setLoading(false);
    }
    fetchPRs();
  }, []);

  const groups = groupByDate(prs);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Changelog</h1>
          <p className="text-sm text-slate-500 mt-1">
            {loading
              ? "Loading..."
              : `${prs.length} changes shipped`}
          </p>
        </div>
        <a
          href={`https://github.com/${REPO}/pulls?q=is%3Apr+is%3Amerged`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
          View all on GitHub
        </a>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading changelog...
        </div>
      ) : prs.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No changes recorded yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.prs.map((pr) => {
                  const cat = categorize(pr.title);
                  return (
                    <a
                      key={pr.number}
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-300 hover:bg-slate-50 transition-colors group"
                    >
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${TAG_COLORS[cat.color]}`}
                      >
                        {cat.label}
                      </span>
                      <span className="text-sm text-slate-800 group-hover:text-slate-900 truncate">
                        {pr.title}
                      </span>
                      <span className="ml-auto text-xs text-slate-400 shrink-0">
                        #{pr.number}
                      </span>
                      <span className="text-xs text-slate-400 shrink-0">
                        {relativeDate(pr.merged_at)}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
