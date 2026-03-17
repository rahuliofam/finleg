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
  success: "bg-green-900/50 text-green-300 border border-green-700",
  error: "bg-red-900/50 text-red-300 border border-red-700",
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
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-6">
        <Link
          href="/devcontrol"
          className="text-base text-zinc-400 hover:text-white transition-colors"
        >
          ← DevControl
        </Link>
      </div>

      <h1 className="text-3xl font-bold text-white mb-3">Backups</h1>
      <p className="text-zinc-400 text-lg mb-10">
        Weekly automated backups of Supabase database and Cloudflare R2 file
        storage.
      </p>

      {/* Summary cards */}
      <div className="grid gap-6 sm:grid-cols-2 mb-10">
        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Database → R2</h3>
            <span className="text-sm text-zinc-400">Hostinger VPS</span>
          </div>
          <p className="text-base text-zinc-400 mb-3">
            pg_dump → gzip → Cloudflare R2 (finleg-backups bucket)
          </p>
          <p className="text-sm text-zinc-500">
            Schedule: Sundays 3:00 AM UTC
          </p>
          {lastDb && (
            <div className="mt-4 pt-4 border-t border-zinc-700">
              <p className="text-base">
                Last:{" "}
                <span className="font-medium text-white">
                  {formatDate(lastDb.created_at)}
                </span>
                <span
                  className={`ml-2 text-sm px-2 py-0.5 rounded ${
                    dbDays !== null && dbDays > 8
                      ? "bg-amber-900/50 text-amber-300"
                      : "text-zinc-400"
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
                <p className="text-sm text-zinc-400 mt-2">
                  Size: {String(lastDb.details.size || "—")}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">R2 → RVAULT20</h3>
            <span className="text-sm text-zinc-400">Alpaca Mac</span>
          </div>
          <p className="text-base text-zinc-400 mb-3">
            Sync all R2 buckets + DB dump to external drive
          </p>
          <p className="text-sm text-zinc-500">
            Schedule: Sundays 5:00 AM local
          </p>
          {lastRvault && (
            <div className="mt-4 pt-4 border-t border-zinc-700">
              <p className="text-base">
                Last:{" "}
                <span className="font-medium text-white">
                  {formatDate(lastRvault.created_at)}
                </span>
                <span
                  className={`ml-2 text-sm px-2 py-0.5 rounded ${
                    rvaultDays !== null && rvaultDays > 8
                      ? "bg-amber-900/50 text-amber-300"
                      : "text-zinc-400"
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
                <p className="text-sm text-zinc-400 mt-2">
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
      <h2 className="text-2xl font-semibold text-white mb-6">
        Activity Log
      </h2>

      {loading ? (
        <p className="text-zinc-400 text-base">Loading...</p>
      ) : logs.length === 0 ? (
        <p className="text-zinc-400 text-base">
          No backup logs yet. Logs will appear after the first scheduled run.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-left text-zinc-400 border-b border-zinc-700">
                <th className="pb-3 font-semibold">Date</th>
                <th className="pb-3 font-semibold">Type</th>
                <th className="pb-3 font-semibold">Source</th>
                <th className="pb-3 font-semibold">Status</th>
                <th className="pb-3 font-semibold">Duration</th>
                <th className="pb-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-b border-zinc-800 hover:bg-zinc-900/50"
                >
                  <td className="py-4 pr-4 whitespace-nowrap text-zinc-200">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="py-4 pr-4 whitespace-nowrap">
                    <span className="font-mono text-sm bg-zinc-800 text-zinc-200 px-2.5 py-1 rounded">
                      {TYPE_LABELS[log.backup_type] || log.backup_type}
                    </span>
                  </td>
                  <td className="py-4 pr-4 whitespace-nowrap text-zinc-300">
                    {SOURCE_LABELS[log.source] || log.source}
                  </td>
                  <td className="py-4 pr-4 whitespace-nowrap">
                    <span
                      className={`text-sm px-2.5 py-1 rounded-full font-medium ${
                        STATUS_COLORS[log.status] || "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {log.status}
                    </span>
                  </td>
                  <td className="py-4 pr-4 whitespace-nowrap text-zinc-300">
                    {formatDuration(log.duration_seconds)}
                  </td>
                  <td className="py-4 text-zinc-400 text-sm">
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
