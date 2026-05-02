"use client";

import { useEffect, useState } from "react";

const OWNER = "rahuliofam";
const REPO = "finleg";
const GH_API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}`;

interface PRDetail {
  number: number;
  title: string;
  merged_at: string;
  html_url: string;
  additions: number;
  deletions: number;
  changed_files: number;
  user: { login: string };
  version?: string;
}

interface Commit {
  sha: string;
  commit: { message: string };
}

interface VersionJson {
  version: string;
  release: number;
}

function categorize(title: string): { label: string; color: string } {
  const t = title.toLowerCase();
  if (t.startsWith("fix") || t.includes("bug")) return { label: "Fix", color: "rose" };
  if (t.includes("add") || t.includes("new")) return { label: "New", color: "emerald" };
  if (t.includes("rewrite") || t.includes("refactor") || t.includes("redesign"))
    return { label: "Rewrite", color: "violet" };
  return { label: "Update", color: "sky" };
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDate(prs: PRDetail[]): { label: string; prs: PRDetail[] }[] {
  const groups: Map<string, PRDetail[]> = new Map();
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
  emerald: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  rose: "bg-rose-900/50 text-rose-300 border-rose-700",
  violet: "bg-violet-900/50 text-violet-300 border-violet-700",
  sky: "bg-sky-900/50 text-sky-300 border-sky-700",
};

async function fetchWithFallback(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/**
 * Changelog view. Correlates merged PRs with the version bumped by CI:
 * scans commit history for `chore: bump version` commits, matches the preceding
 * merge-commit's PR number, then fetches `version.json` at that commit to
 * attach the exact version string to each PR row.
 */
export function ReleasesTab() {
  const [prs, setPrs] = useState<PRDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalLines, setTotalLines] = useState(0);

  useEffect(() => {
    async function loadData() {
      try {
        // Step 1: Fetch merged PRs list + commits in parallel
        const [prListRes, commitsRes] = await Promise.all([
          fetch(`${GH_API}/pulls?state=closed&sort=updated&direction=desc&per_page=50`),
          fetch(`${GH_API}/commits?per_page=100`),
        ]);

        if (!prListRes.ok) throw new Error(`GitHub API ${prListRes.status}`);
        const prList = (await prListRes.json()).filter((pr: { merged_at: string }) => pr.merged_at);
        const commits: Commit[] = commitsRes.ok ? await commitsRes.json() : [];

        // Step 2: Find bump commits and map PR numbers to version SHAs
        // Commits are newest-first. A bump commit follows a merge commit.
        const prToVersionSha: Record<number, string> = {};
        for (let i = 0; i < commits.length; i++) {
          const c = commits[i];
          if (c.commit.message.startsWith("chore: bump version")) {
            // The next commit (older) should be the PR merge
            const mergeCommit = commits[i + 1];
            if (mergeCommit) {
              const match = mergeCommit.commit.message.match(/Merge pull request #(\d+)/);
              if (match) {
                prToVersionSha[parseInt(match[1])] = c.sha;
              }
            }
          }
        }

        // Step 3: Fetch individual PR details + version.json files in parallel
        const prDetailPromises = prList.map((pr: { number: number }) =>
          fetchWithFallback(`${GH_API}/pulls/${pr.number}`).catch(() => null)
        );

        const versionShas = [...new Set(Object.values(prToVersionSha))];
        const versionPromises = versionShas.map((sha) =>
          fetch(`${RAW_BASE}/${sha}/version.json`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        );

        const [prDetails, ...versionResults] = await Promise.all([
          Promise.all(prDetailPromises),
          ...versionPromises,
        ]);

        // Build SHA → version map
        const shaToVersion: Record<string, string> = {};
        versionShas.forEach((sha, i) => {
          const v = versionResults[i] as VersionJson | null;
          if (v?.version) shaToVersion[sha] = v.version;
        });

        // Step 4: Merge everything
        const enriched: PRDetail[] = prList.map((pr: { number: number }, idx: number) => {
          const detail = prDetails[idx] as PRDetail | null;
          const vSha = prToVersionSha[pr.number];
          const version = vSha ? shaToVersion[vSha] : undefined;
          return {
            ...pr,
            additions: detail?.additions ?? 0,
            deletions: detail?.deletions ?? 0,
            changed_files: detail?.changed_files ?? 0,
            version,
          };
        });

        setPrs(enriched);
        setTotalLines(enriched.reduce((sum, pr) => sum + pr.additions + pr.deletions, 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch");
      }
      setLoading(false);
    }
    loadData();
  }, []);

  const groups = groupByDate(prs);

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Changelog</h1>
          <p className="text-base text-zinc-400 mt-1">
            {loading
              ? "Loading..."
              : `${prs.length} changes shipped · ${totalLines.toLocaleString()} lines changed`}
          </p>
        </div>
        <a
          href={`https://github.com/${OWNER}/${REPO}/pulls?q=is%3Apr+is%3Amerged`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-400 hover:text-white flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
          View on GitHub
        </a>
      </div>

      {error && (
        <div className="mb-4 text-base rounded-lg px-4 py-3 bg-red-900/50 border border-red-700 text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-zinc-700 p-8 text-center text-zinc-400 text-base">
          Loading changelog...
        </div>
      ) : prs.length === 0 ? (
        <div className="rounded-xl border border-zinc-700 p-8 text-center text-zinc-400 text-base">
          No changes recorded yet.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.prs.map((pr) => {
                  const cat = categorize(pr.title);
                  const lines = pr.additions + pr.deletions;
                  return (
                    <a
                      key={pr.number}
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3.5 hover:border-zinc-500 hover:bg-zinc-800 transition-colors group"
                    >
                      {/* Category tag */}
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded text-sm font-medium border shrink-0 ${TAG_COLORS[cat.color]}`}
                      >
                        {cat.label}
                      </span>

                      {/* Title */}
                      <span className="text-base text-zinc-200 group-hover:text-white truncate">
                        {pr.title}
                      </span>

                      {/* Right side metadata */}
                      <div className="ml-auto flex items-center gap-3 shrink-0">
                        {/* Version badge */}
                        {pr.version && (
                          <span className="text-sm font-mono text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded">
                            {pr.version}
                          </span>
                        )}

                        {/* Lines changed */}
                        {lines > 0 && (
                          <span className="text-sm text-zinc-400 tabular-nums">
                            <span className="text-emerald-400">+{pr.additions}</span>
                            {" "}
                            <span className="text-rose-400">-{pr.deletions}</span>
                          </span>
                        )}

                        {/* PR number */}
                        <span className="text-sm text-zinc-500">
                          #{pr.number}
                        </span>

                        {/* Full timestamp */}
                        <span className="text-sm text-zinc-500 hidden sm:inline">
                          {formatFullDate(pr.merged_at)}
                        </span>
                      </div>
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
