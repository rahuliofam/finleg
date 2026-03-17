"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface BackupLog {
  id: number;
  created_at: string;
  source: string;
  backup_type: string;
  status: string;
  duration_seconds: number | null;
  details: Record<string, unknown> | null;
  r2_key: string | null;
}

const SOURCE_LABELS: Record<string, string> = { hostinger: "Hostinger VPS", "alpaca-mac": "Alpaca Mac" };
const TYPE_LABELS: Record<string, string> = { "db-to-r2": "DB → R2", "r2-to-rvault": "R2 → RVAULT20" };

function fmtDuration(s: number | null) {
  if (!s) return "—";
  return s < 60 ? `${s}s` : s % 60 > 0 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s / 60}m`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function BackupsTab() {
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("backup_logs").select("*").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => { setLogs(data || []); setLoading(false); });
  }, []);

  const lastDb = logs.find((l) => l.backup_type === "db-to-r2");
  const lastRvault = logs.find((l) => l.backup_type === "r2-to-rvault");
  const dbDays = lastDb ? daysSince(lastDb.created_at) : null;
  const rvaultDays = lastRvault ? daysSince(lastRvault.created_at) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Backups</h1>
        <p className="text-sm text-slate-500">Weekly automated backups of Supabase database and Cloudflare R2 file storage.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-5 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Database → R2</h3>
            <span className="text-xs text-slate-400">Hostinger VPS</span>
          </div>
          <p className="text-sm text-slate-500 mb-2">pg_dump → gzip → Cloudflare R2 (finleg-backups bucket)</p>
          <p className="text-xs text-slate-400">Schedule: Sundays 3:00 AM UTC</p>
          {lastDb && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-sm">
                Last: <span className="font-medium text-slate-700">{fmtDate(lastDb.created_at)}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${dbDays !== null && dbDays > 8 ? "bg-amber-100 text-amber-800" : "text-slate-400"}`}>
                  {dbDays === 0 ? "today" : dbDays === 1 ? "1 day ago" : `${dbDays} days ago`}
                </span>
              </p>
              {lastDb.details && <p className="text-xs text-slate-400 mt-1">Size: {String(lastDb.details.size || "—")}</p>}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-5 bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">R2 → RVAULT20</h3>
            <span className="text-xs text-slate-400">Alpaca Mac</span>
          </div>
          <p className="text-sm text-slate-500 mb-2">Sync all R2 buckets + DB dump to external drive</p>
          <p className="text-xs text-slate-400">Schedule: Sundays 5:00 AM local</p>
          {lastRvault && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-sm">
                Last: <span className="font-medium text-slate-700">{fmtDate(lastRvault.created_at)}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${rvaultDays !== null && rvaultDays > 8 ? "bg-amber-100 text-amber-800" : "text-slate-400"}`}>
                  {rvaultDays === 0 ? "today" : rvaultDays === 1 ? "1 day ago" : `${rvaultDays} days ago`}
                </span>
              </p>
              {lastRvault.details && (
                <p className="text-xs text-slate-400 mt-1">
                  Total: {String(lastRvault.details.total_size || "—")} · {String(lastRvault.details["financial-statements"] || 0)} + {String(lastRvault.details["bookkeeping-docs"] || 0)} + {String(lastRvault.details["legal-docs"] || 0)} files
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Activity Log</h2>
        {loading ? (
          <p className="text-slate-400 text-sm">Loading...</p>
        ) : logs.length === 0 ? (
          <p className="text-slate-400 text-sm">No backup logs yet.</p>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Date</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Source</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Duration</th>
                  <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">{fmtDate(log.created_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{TYPE_LABELS[log.backup_type] || log.backup_type}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{SOURCE_LABELS[log.source] || log.source}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${log.status === "success" ? "bg-green-100 text-green-800" : log.status === "error" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600"}`}>{log.status}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{fmtDuration(log.duration_seconds)}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">
                      {log.r2_key && <span className="font-mono">{log.r2_key}</span>}
                      {log.details && "size" in log.details && <span className="ml-1">({String(log.details.size)})</span>}
                      {log.details && "total_size" in log.details && <span>{String(log.details.total_size)} synced</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
