"use client";

import { useState, useEffect, useCallback } from "react";

const API_BASE = "https://claude-sessions.finleg.workers.dev";
const API_TOKEN = "alpaca-sessions-2026";

const PROJECT_ALIASES: Record<string, string> = { genalpaca: "alpacapps" };
const HIDDEN_PROJECTS = new Set(["/", "/Users/rahulio", "test", "unknown", ""]);

const PROJECT_COLORS: Record<string, string> = {
  finleg: "bg-emerald-100 text-emerald-800",
  alpacapps: "bg-purple-100 text-purple-800",
  genalpaca: "bg-purple-100 text-purple-800",
  Khangtsen: "bg-amber-100 text-amber-800",
  khangtsen: "bg-amber-100 text-amber-800",
  portsie: "bg-sky-100 text-sky-800",
};

interface Session {
  id: string;
  project: string;
  model: string;
  started_at: string;
  duration_mins: number;
  summary: string;
  transcript: string;
  token_count: number;
}

interface Stats {
  total_sessions: number;
  total_tokens: number;
  total_minutes: number;
  avg_tokens: number;
  avg_duration: number;
}

interface TranscriptMessage { role: string; content: string; }

function fmt(n: number) { return n ? n.toLocaleString() : "0"; }

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function fmtTokens(n: number) {
  if (!n) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k tokens` : `${n} tokens`;
}

function parseTranscript(text: string): TranscriptMessage[] {
  if (!text) return [];
  return text.split(/\n---\n/).map((part) => {
    part = part.trim();
    if (!part) return null;
    const role = part.startsWith("## User") ? "USER" : "ASSISTANT";
    const content = part.replace(/^## (User|Assistant)\n?/, "").trim();
    return { role, content };
  }).filter(Boolean) as TranscriptMessage[];
}

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="px-2.5 py-1 text-xs border border-slate-300 rounded-md hover:bg-slate-100 transition text-slate-600"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export function SessionsTab() {
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

  const headers = { Authorization: `Bearer ${API_TOKEN}` };

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (selectedProject) params.set("project", selectedProject);
      if (search) params.set("search", search);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(`${API_BASE}/sessions?${params}`, { headers });
      if (res.ok) { const data = await res.json(); setSessions(data.sessions || data); }
    } catch {}
    setLoading(false);
  }, [selectedProject, search, dateFrom, dateTo]);

  const fetchFullSession = useCallback(async (id: string) => {
    if (transcriptCache[id]) return;
    try {
      const res = await fetch(`${API_BASE}/sessions/${id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTranscriptCache((prev) => ({ ...prev, [id]: data.transcript || "" }));
      }
    } catch {}
  }, [transcriptCache]);

  const toggleSession = (id: string) => {
    if (expandedId === id) { setExpandedId(null); }
    else { setExpandedId(id); fetchFullSession(id); }
  };

  useEffect(() => {
    fetch(`${API_BASE}/stats`, { headers }).then((r) => r.json()).then(setStats).catch(() => {});
    fetch(`${API_BASE}/projects`, { headers }).then((r) => r.json())
      .then((data) => setProjects((Array.isArray(data) ? data : data.projects || []).filter((p: string) => !HIDDEN_PROJECTS.has(p))))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Sessions</h1>
        <p className="text-sm text-slate-500">AI development session history across all projects</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Sessions", value: fmt(stats.total_sessions), color: "text-purple-700" },
            { label: "Tokens", value: fmt(stats.total_tokens), color: "text-emerald-700" },
            { label: "Projects", value: String(projects.length || "—"), color: "text-blue-700" },
            { label: "Avg Duration", value: `${Math.round((stats.avg_duration || 0) / 60)}m`, color: "text-amber-700" },
          ].map((s) => (
            <div key={s.label} className="border border-slate-200 rounded-xl px-4 py-4 text-center bg-white">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 border border-slate-200 rounded-xl p-4 bg-white">
        <input type="text" placeholder="Search sessions..." value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchSessions()}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 text-slate-800 placeholder:text-slate-400" />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800" />
        <button onClick={fetchSessions}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition">
          Search
        </button>
        <button onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setSelectedProject(""); }}
          className="border border-slate-300 text-slate-600 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition">
          Clear
        </button>
      </div>

      {/* Sessions list */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading...</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-slate-400">No sessions found</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const projName = PROJECT_ALIASES[s.project] || s.project || "unknown";
            const projColor = PROJECT_COLORS[s.project] || "bg-blue-100 text-blue-800";
            const model = s.model ? s.model.replace("claude-", "").split("-202")[0] : "";
            const tokens = fmtTokens(s.token_count);
            const isExpanded = expandedId === s.id;
            const messages = isExpanded ? parseTranscript(transcriptCache[s.id] || s.transcript || "") : [];

            return (
              <div key={s.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white hover:border-slate-300 transition">
                <div className="px-5 py-4 cursor-pointer" onClick={() => toggleSession(s.id)}>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block ${projColor} text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0`}>{projName}</span>
                    <span className="text-sm font-semibold text-slate-800 truncate">{s.summary || "No summary"}</span>
                    <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                      <span className="text-xs text-slate-400">{fmtDate(s.started_at)}</span>
                      {model && <span className="hidden sm:inline-block bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">{model}</span>}
                      {s.duration_mins > 0 && <span className="hidden sm:inline-block bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">{s.duration_mins}m</span>}
                      {tokens && <span className="hidden sm:inline-block bg-emerald-50 text-emerald-700 text-xs font-medium px-2 py-0.5 rounded-full">{tokens}</span>}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 px-5 py-4 bg-slate-50">
                    <div className="flex items-center gap-2 mb-4">
                      <CopyBtn text={messages.map((m) => `### ${m.role}\n\n${m.content}`).join("\n\n---\n\n")} label="Copy Full Session" />
                    </div>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {messages.length > 0 ? messages.map((msg, idx) => (
                        <div key={idx} className={`rounded-lg p-4 ${msg.role === "USER" ? "bg-blue-50 border border-blue-200" : "bg-white border border-slate-200"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-bold tracking-wide ${msg.role === "USER" ? "text-blue-600" : "text-slate-500"}`}>{msg.role}</span>
                            <CopyBtn text={msg.content} />
                          </div>
                          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 font-sans">
                            {msg.content.length > 3000 ? msg.content.substring(0, 3000) + "\n\n... [truncated]" : msg.content}
                          </pre>
                        </div>
                      )) : (
                        <div className="text-sm text-slate-400">No transcript available</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
