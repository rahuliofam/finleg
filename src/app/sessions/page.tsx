"use client";

import { useState, useEffect, useCallback } from "react";

const API_BASE = "https://claude-sessions.alpacapps.workers.dev";
const API_TOKEN = "alpaca-sessions-2026";

// Project display names (rename raw DB values)
const PROJECT_ALIASES: Record<string, string> = {
  genalpaca: "alpacapps",
};

// Junk project names to hide
const HIDDEN_PROJECTS = new Set(["/", "/Users/rahulio", "test", "unknown", ""]);

// Distinct colors per project
const PROJECT_COLORS: Record<string, { bg: string; text: string }> = {
  finleg: { bg: "bg-emerald-100", text: "text-emerald-800" },
  alpacapps: { bg: "bg-purple-100", text: "text-purple-800" },
  genalpaca: { bg: "bg-purple-100", text: "text-purple-800" },
  Khangtsen: { bg: "bg-amber-100", text: "text-amber-800" },
  khangtsen: { bg: "bg-amber-100", text: "text-amber-800" },
  portsie: { bg: "bg-sky-100", text: "text-sky-800" },
};

const DEFAULT_COLOR = { bg: "bg-blue-100", text: "text-blue-800" };

function getProjectDisplay(raw: string) {
  return PROJECT_ALIASES[raw] || raw || "unknown";
}

function getProjectColor(raw: string) {
  return PROJECT_COLORS[raw] || DEFAULT_COLOR;
}

interface Session {
  id: string;
  project: string;
  model: string;
  started_at: string;
  ended_at: string;
  duration_mins: number;
  summary: string;
  transcript: string;
  token_count: number;
  tags: string;
}

interface Stats {
  total_sessions: number;
  total_tokens: number;
  total_minutes: number;
  avg_tokens: number;
  avg_duration: number; // seconds
}

function formatDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const year = d.getFullYear();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${weekday} ${day} ${month} ${year}, ${time}`;
}

function formatNumber(n: number) {
  if (!n) return "0";
  return n.toLocaleString();
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const headers = {
    Authorization: `Bearer ${API_TOKEN}`,
  };

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (selectedProject) params.set("project", selectedProject);
      if (search) params.set("search", search);
      const res = await fetch(`${API_BASE}/sessions?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || data);
      }
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
    }
    setLoading(false);
  }, [selectedProject, search]);

  useEffect(() => {
    // Fetch stats
    fetch(`${API_BASE}/stats`, { headers })
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
    // Fetch projects — API returns raw array
    fetch(`${API_BASE}/projects`, { headers })
      .then((r) => r.json())
      .then((data) => {
        const raw: string[] = Array.isArray(data)
          ? data
          : data.projects || [];
        const clean = raw.filter((p) => !HIDDEN_PROJECTS.has(p));
        setProjects(clean);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-6 py-12 sm:py-16">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Claude Sessions
          </h1>
          <p className="text-lg text-white/70">
            AI development session history across all projects
          </p>

          {/* Stats bar */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8">
              {[
                {
                  label: "Sessions",
                  value: formatNumber(stats.total_sessions),
                },
                { label: "Tokens", value: formatNumber(stats.total_tokens) },
                { label: "Projects", value: String(projects.length || "—") },
                {
                  label: "Avg Duration",
                  value: `${Math.round((stats.avg_duration || 0) / 60)}m`,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="bg-white/10 rounded-lg px-4 py-3 text-center"
                >
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-sm text-white/60">{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Filters — light background with good contrast */}
      <section className="bg-slate-100 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row gap-3">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {getProjectDisplay(p)}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchSessions()}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 bg-white text-slate-900 placeholder:text-slate-400"
          />
          <button
            onClick={fetchSessions}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition"
          >
            Search
          </button>
        </div>
      </section>

      {/* Sessions list */}
      <section className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            No sessions found
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const color = getProjectColor(s.project);
              const displayName = getProjectDisplay(s.project);
              return (
                <div
                  key={s.id}
                  className="border rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition"
                >
                  {/* Session header */}
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === s.id ? null : s.id)
                    }
                    className="w-full text-left px-5 py-4 flex items-start gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-block ${color.bg} ${color.text} text-xs font-medium px-2 py-0.5 rounded-full`}
                        >
                          {displayName}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatDate(s.started_at)}
                        </span>
                        {s.duration_mins && (
                          <span className="text-xs text-slate-400">
                            · {s.duration_mins}m
                          </span>
                        )}
                        {s.token_count > 0 && (
                          <span className="text-xs text-slate-400">
                            · {formatNumber(s.token_count)} tokens
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 truncate">
                        {s.summary || "No summary"}
                      </p>
                    </div>
                    <span className="text-slate-400 text-lg mt-1">
                      {expandedId === s.id ? "▲" : "▼"}
                    </span>
                  </button>

                  {/* Expanded transcript */}
                  {expandedId === s.id && (
                    <div className="border-t px-5 py-4 bg-slate-50">
                      <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
                        <span>Model: {s.model || "—"}</span>
                        <span>·</span>
                        <span>ID: {s.id.slice(0, 8)}…</span>
                      </div>
                      <div className="prose prose-sm max-w-none max-h-[500px] overflow-y-auto">
                        <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-white p-4 rounded-lg border">
                          {s.transcript || "No transcript available"}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
