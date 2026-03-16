"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

const SOURCE_LABELS: Record<string, string> = {
  hostinger: "Hostinger VPS",
  "alpaca-mac": "Alpaca Mac",
};

const TYPE_LABELS: Record<string, string> = {
  "db-to-r2": "DB → R2",
  "r2-to-rvault": "R2 → RVAULT20",
};

const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function daysSince(iso: string): number {
  return Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
  );
}

export default function BackupsPage() {
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("backup_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setLogs(data || []);
        setLoading(false);
      });
  }, []);

  const lastDb = logs.find((l) => l.backup_type === "db-to-r2");
  const lastRvault = logs.find((l) => l.backup_type === "r2-to-rvault");
  const dbDays = lastDb ? daysSince(lastDb.created_at) : null;
  const rvaultDays = lastRvault ? daysSince(lastRvault.created_at) : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-4">
        <Link
          href="/clauded"
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← Clauded
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-slate-900 mb-2">Backups</h1>
      <p className="text-slate-500 text-sm mb-8">
        Weekly automated backups of Supabase database and Cloudflare R2 file
        storage.
      </p>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        <div className="rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700">Database → R2</h3>
            <span className="text-xs text-slate-400">Hostinger VPS</span>
          </div>
          <p className="text-sm text-slate-500 mb-2">
            pg_dump → gzip → Cloudflare R2 (finleg-backups bucket)
          </p>
          <p className="text-xs text-slate-400">
            Schedule: Sundays 3:00 AM UTC
          </p>
          {lastDb && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-sm">
                Last:{" "}
                <span className="font-medium text-slate-700">
                  {formatDate(lastDb.created_at)}
                </span>
                <span
                  className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                    dbDays !== null && dbDays > 8
                      ? "bg-amber-100 text-amber-800"
                      : "text-slate-400"
                  }`}
                >
                  {dbDays === 0
                    ? "today"
                    : dbDays === 1
                    ? "1 day ago"
                    : `${dbDays} days ago`}
                </span>
              </p>
              {lastDb.details && (
                <p className="text-xs text-slate-400 mt-1">
                  Size: {String(lastDb.details.size || "—")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700">R2 → RVAULT20</h3>
            <span className="text-xs text-slate-400">Alpaca Mac</span>
          </div>
          <p className="text-sm text-slate-500 mb-2">
            Sync all R2 buckets + DB dump to external drive
          </p>
          <p className="text-xs text-slate-400">
            Schedule: Sundays 5:00 AM local
          </p>
          {lastRvault && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-sm">
                Last:{" "}
                <span className="font-medium text-slate-700">
                  {formatDate(lastRvault.created_at)}
                </span>
                <span
                  className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                    rvaultDays !== null && rvaultDays > 8
                      ? "bg-amber-100 text-amber-800"
                      : "text-slate-400"
                  }`}
                >
                  {rvaultDays === 0
                    ? "today"
                    : rvaultDays === 1
                    ? "1 day ago"
                    : `${rvaultDays} days ago`}
                </span>
              </p>
              {lastRvault.details && (
                <p className="text-xs text-slate-400 mt-1">
                  Total: {String(lastRvault.details.total_size || "—")} ·{" "}
                  {String(lastRvault.details["financial-statements"] || 0)} +{" "}
                  {String(lastRvault.details["bookkeeping-docs"] || 0)} +{" "}
                  {String(lastRvault.details["legal-docs"] || 0)} files
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Activity log */}
      <h2 className="text-lg font-semibold text-slate-800 mb-4">
        Activity Log
      </h2>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading...</p>
      ) : logs.length === 0 ? (
        <p className="text-slate-400 text-sm">
          No backup logs yet. Logs will appear after the first scheduled run.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Duration</th>
                <th className="pb-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-slate-700">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">
                      {TYPE_LABELS[log.backup_type] || log.backup_type}
                    </span>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                    {SOURCE_LABELS[log.source] || log.source}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        STATUS_COLORS[log.status] || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-slate-500">
                    {formatDuration(log.duration_seconds)}
                  </td>
                  <td className="py-3 text-slate-500 text-xs">
                    {log.r2_key && (
                      <span className="font-mono">{log.r2_key}</span>
                    )}
                    {log.details && "size" in log.details && (
                      <span className="ml-1">
                        ({String(log.details.size)})
                      </span>
                    )}
                    {log.details && "total_size" in log.details && (
                      <span>{String(log.details.total_size)} synced</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
