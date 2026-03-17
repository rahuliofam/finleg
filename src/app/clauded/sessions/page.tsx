"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

const API_BASE = "https://claude-sessions.finleg.workers.dev";
const API_TOKEN = "alpaca-sessions-2026";

// Project display names (rename raw DB values)
const PROJECT_ALIASES: Record<string, string> = {
  genalpaca: "alpacapps",
};

// Junk project names to hide
const HIDDEN_PROJECTS = new Set(["/", "/Users/rahulio", "test", "unknown", ""]);

// Distinct colors per project
const PROJECT_COLORS: Record<string, { bg: string; text: string }> = {
  finleg: { bg: "bg-emerald-900/50", text: "text-emerald-300" },
  alpacapps: { bg: "bg-purple-900/50", text: "text-purple-300" },
  genalpaca: { bg: "bg-purple-900/50", text: "text-purple-300" },
  Khangtsen: { bg: "bg-amber-900/50", text: "text-amber-300" },
  khangtsen: { bg: "bg-amber-900/50", text: "text-amber-300" },
  portsie: { bg: "bg-sky-900/50", text: "text-sky-300" },
};

const DEFAULT_COLOR = { bg: "bg-blue-900/50", text: "text-blue-300" };

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

interface TranscriptMessage {
  role: string;
  content: string;
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

function formatTokens(n: number) {
  if (!n) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k tokens`;
  return `${n} tokens`;
}

function parseTranscript(text: string): TranscriptMessage[] {
  if (!text) return [];
  const parts = text.split(/\n---\n/);
  return parts
    .map((part) => {
      part = part.trim();
      if (!part) return null;
      const isUser = part.startsWith("## User");
      const role = isUser ? "USER" : "ASSISTANT";
      const content = part.replace(/^## (User|Assistant)\n?/, "").trim();
      return { role, content };
    })
    .filter(Boolean) as TranscriptMessage[];
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1 text-xs border border-slate-600 rounded-md hover:bg-slate-700 transition text-slate-300"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function ShareButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}?session=${sessionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleShare}
      className={`text-lg flex-shrink-0 transition ${copied ? "text-green-400" : "text-slate-500 hover:text-slate-300"}`}
      title="Copy session link"
    >
      {copied ? "✓" : "⤴"}
    </button>
  );
}

/* ─── Detail view for a single session ─── */
function SessionDetail({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Session not found");
        return r.json();
      })
      .then(setSession)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center text-slate-400">
        Loading…
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <p className="text-slate-400">{error || "Session not found"}</p>
        <a
          href="/clauded/sessions"
          className="text-sm text-emerald-400 hover:underline mt-4 inline-block"
        >
          ← Back to sessions
        </a>
      </div>
    );
  }

  const messages = parseTranscript(session.transcript);

  return (
    <>
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <a
            href="/clauded/sessions"
            className="text-sm text-white/50 hover:text-white/80 transition mb-4 inline-block"
          >
            ← Back to sessions
          </a>
          <h1 className="text-2xl font-bold mb-2">
            {session.summary || "Session Details"}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
            <span>{formatDate(session.started_at)}</span>
            {session.model && (
              <>
                <span>·</span>
                <span>{session.model}</span>
              </>
            )}
            {session.duration_mins > 0 && (
              <>
                <span>·</span>
                <span>{session.duration_mins}m</span>
              </>
            )}
            {session.token_count > 0 && (
              <>
                <span>·</span>
                <span>{formatNumber(session.token_count)} tokens</span>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-8">
        <div className="border border-slate-700 rounded-xl p-6 bg-slate-900/50">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-slate-500">
              Project: {session.project || "—"} · ID: {session.id}
            </div>
            <CopyButton
              text={messages.map((m) => `### ${m.role}\n\n${m.content}`).join("\n\n---\n\n")}
              label="Copy Full Session"
            />
          </div>
          <div className="space-y-3 max-h-[80vh] overflow-y-auto">
            {messages.length > 0 ? (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg p-4 ${
                    msg.role === "USER"
                      ? "bg-blue-900/30 border border-blue-800"
                      : "bg-slate-800/50 border border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-xs font-bold tracking-wide ${
                        msg.role === "USER"
                          ? "text-blue-400"
                          : "text-slate-400"
                      }`}
                    >
                      {msg.role}
                    </span>
                    <CopyButton text={msg.content} />
                  </div>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 font-sans">
                    {msg.content}
                  </pre>
                </div>
              ))
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-slate-800/50 p-4 rounded-lg border border-slate-700 text-slate-300">
                {session.transcript || "No transcript available"}
              </pre>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export default function SessionsPage() {
  const searchParams = useSearchParams();
  const detailId = searchParams.get("id");

  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transcriptCache, setTranscriptCache] = useState<Record<string, string>>({});
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
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(`${API_BASE}/sessions?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || data);
      }
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
    }
    setLoading(false);
  }, [selectedProject, search, dateFrom, dateTo]);

  const fetchFullSession = useCallback(
    async (id: string) => {
      if (transcriptCache[id]) return;
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, { headers });
        if (res.ok) {
          const data = await res.json();
          setTranscriptCache((prev) => ({
            ...prev,
            [id]: data.transcript || "",
          }));
        }
      } catch (e) {
        console.error("Failed to fetch transcript:", e);
      }
    },
    [transcriptCache]
  );

  const toggleSession = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      fetchFullSession(id);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSelectedProject("");
  };

  const copyFullSession = (id: string) => {
    const text = transcriptCache[id];
    if (!text) return;
    const messages = parseTranscript(text);
    const full = messages
      .map((m) => `### ${m.role}\n\n${m.content}`)
      .join("\n\n---\n\n");
    return full;
  };

  useEffect(() => {
    if (detailId) return;
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
  }, [detailId]);

  useEffect(() => {
    if (detailId) return;
    fetchSessions();
  }, [fetchSessions, detailId]);

  /* Show detail view when ?id= is present */
  if (detailId) {
    return <SessionDetail sessionId={detailId} />;
  }

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

      {/* Filters */}
      <section className="border-b border-slate-700 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchSessions()}
            className="border border-slate-600 rounded-lg px-3 py-2 text-sm flex-1 bg-slate-800 text-slate-200 placeholder:text-slate-500"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200"
          />
          <button
            onClick={fetchSessions}
            className="bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition"
          >
            Search
          </button>
          <button
            onClick={clearFilters}
            className="border border-slate-600 text-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition"
          >
            Clear
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
              const model = s.model
                ? s.model.replace("claude-", "").split("-202")[0]
                : "";
              const tokens = formatTokens(s.token_count);
              const isExpanded = expandedId === s.id;
              const messages = isExpanded
                ? parseTranscript(transcriptCache[s.id] || s.transcript || "")
                : [];

              return (
                <div
                  key={s.id}
                  className="relative border border-slate-700 rounded-xl overflow-hidden bg-slate-900/50 hover:border-slate-500 transition"
                >
                  {/* Session header row */}
                  <div
                    className="px-5 py-4 pr-12 cursor-pointer"
                    onClick={() => toggleSession(s.id)}
                  >
                    {/* Top line: project + session name on left, date/badges/share on right */}
                    <div className="flex items-center gap-2">
                      {/* Left: project badge + session name */}
                      <span
                        className={`inline-block ${color.bg} ${color.text} text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0`}
                      >
                        {displayName}
                      </span>
                      <span className="text-sm font-semibold text-slate-200 truncate">
                        {s.summary || "No summary"}
                      </span>

                      {/* Right: date + badges + share */}
                      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                        <span className="text-xs text-slate-400">
                          {formatDate(s.started_at)}
                        </span>
                        {model && (
                          <span className="hidden sm:inline-block bg-slate-800 text-slate-400 text-xs font-medium px-2 py-0.5 rounded-full">
                            {model}
                          </span>
                        )}
                        {s.duration_mins > 0 && (
                          <span className="hidden sm:inline-block bg-blue-900/40 text-blue-300 text-xs font-medium px-2 py-0.5 rounded-full">
                            {s.duration_mins}m
                          </span>
                        )}
                        {tokens && (
                          <span className="hidden sm:inline-block bg-green-900/40 text-green-300 text-xs font-medium px-2 py-0.5 rounded-full">
                            {tokens}
                          </span>
                        )}
                        <ShareButton sessionId={s.id} />
                      </div>
                    </div>
                  </div>
                  {/* Open in new tab */}
                  <a
                    href={`/clauded/sessions?id=${s.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-4 right-4 text-slate-600 hover:text-emerald-400 transition text-lg"
                    title="Open in new tab"
                  >
                    ↗
                  </a>

                  {/* Expanded transcript */}
                  {isExpanded && (
                    <div className="border-t border-slate-700 px-5 py-4 bg-slate-800/50">
                      {/* Actions bar */}
                      <div className="flex items-center gap-2 mb-4">
                        <CopyButton
                          text={copyFullSession(s.id) || s.transcript || ""}
                          label="Copy Full Session"
                        />
                      </div>

                      {/* Transcript messages */}
                      <div className="space-y-3 max-h-[600px] overflow-y-auto">
                        {messages.length > 0 ? (
                          messages.map((msg, idx) => (
                            <div
                              key={idx}
                              className={`rounded-lg p-4 ${
                                msg.role === "USER"
                                  ? "bg-blue-900/30 border border-blue-800"
                                  : "bg-slate-900/50 border border-slate-700"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span
                                  className={`text-xs font-bold tracking-wide ${
                                    msg.role === "USER"
                                      ? "text-blue-400"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {msg.role}
                                </span>
                                <CopyButton text={msg.content} />
                              </div>
                              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 font-sans">
                                {msg.content.length > 3000
                                  ? msg.content.substring(0, 3000) +
                                    "\n\n... [truncated]"
                                  : msg.content}
                              </pre>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-slate-400">
                            No transcript available
                          </div>
                        )}
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
