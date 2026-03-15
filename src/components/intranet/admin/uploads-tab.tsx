"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface UploadStats {
  total: number;
  enriched: number;
  pending: number;
  byCategory: Record<string, number>;
  byBucket: Record<string, number>;
}

interface FailedDoc {
  id: string;
  filename: string;
  r2_key: string;
  category: string | null;
  bucket: string;
  error?: string;
}

const KNOWN_ERRORS: Record<string, string> = {
  "Haydn 2020_TaxReturn-1.pdf": "Claude CLI command failed (file too large or malformed)",
  "Haydn 2020_TaxReturn.pdf": "Claude CLI command failed (file too large or malformed)",
  "2019 Tax Return Documents (SONNAD SUBHASH R - Client Copy).pdf": "Claude CLI command failed",
  "2019 Tax Return Documents (SONNAD RAHUL and KATHLE - Client Copy).pdf": "Claude CLI command failed",
  "updated 2018 Tax Return Documents (SONNAD RAHUL and KATHLE - Client Copy).pdf": "Claude CLI command failed",
  "IMG_4184.jpg": "Claude CLI command failed (image parsing error)",
  "2022 Tax Return Documents (Subhash Sonnad Rvoc Tr).pdf": "Claude CLI command failed",
  "SONNE7181_2021_Organizer.pdf": "Claude CLI command failed",
};

const SKIPPED_FILES: { filename: string; reason: string }[] = [
  { filename: "*.htm files (10)", reason: "Unsupported file type: htm" },
  { filename: "*.numbers files (1)", reason: "Unsupported file type: numbers" },
  { filename: "*.pfl files (1)", reason: "Unsupported file type: pfl" },
  { filename: "personal_key US GOV ID social security website password.txt", reason: "Blocked: contains sensitive credentials" },
];

export function UploadsTab() {
  const [stats, setStats] = useState<UploadStats | null>(null);
  const [failedDocs, setFailedDocs] = useState<FailedDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);

      const [allResult, enrichedResult, categoryResult, bucketResult, failedResult] =
        await Promise.all([
          supabase
            .from("document_index")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("document_index")
            .select("id", { count: "exact", head: true })
            .not("ai_metadata", "is", null),
          supabase
            .from("document_index")
            .select("category"),
          supabase
            .from("document_index")
            .select("bucket"),
          supabase
            .from("document_index")
            .select("id, filename, r2_key, category, bucket")
            .is("ai_metadata", null)
            .in("category", ["legal", "tax-personal", "investment", "other"]),
        ]);

      const total = allResult.count || 0;
      const enriched = enrichedResult.count || 0;

      const byCategory: Record<string, number> = {};
      (categoryResult.data || []).forEach((row: { category: string | null }) => {
        const cat = row.category || "uncategorized";
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      });

      const byBucket: Record<string, number> = {};
      (bucketResult.data || []).forEach((row: { bucket: string | null }) => {
        const b = row.bucket || "unknown";
        byBucket[b] = (byBucket[b] || 0) + 1;
      });

      const failed = (failedResult.data || []).map((doc) => ({
        ...doc,
        error: KNOWN_ERRORS[doc.filename] || undefined,
      }));

      setStats({ total, enriched, pending: total - enriched, byCategory, byBucket });
      setFailedDocs(failed);
      setLoading(false);
    }

    fetchStats();
  }, []);

  const pct = (n: number, total: number) =>
    total > 0 ? Math.round((n / total) * 100) : 0;

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        Loading upload statistics...
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Upload Summary</h1>
        <p className="text-sm text-slate-500 mt-1">
          Document ingestion and AI metadata extraction status
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Documents" value={stats.total} />
        <StatCard
          label="AI Enriched"
          value={stats.enriched}
          subtitle={`${pct(stats.enriched, stats.total)}% complete`}
          color="green"
        />
        <StatCard
          label="Pending Extraction"
          value={stats.pending}
          color={stats.pending > 0 ? "amber" : "green"}
        />
        <StatCard
          label="Failed / Skipped"
          value={failedDocs.length + SKIPPED_FILES.length}
          color={failedDocs.length > 0 ? "red" : "slate"}
        />
      </div>

      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm text-slate-600 mb-1">
          <span>Extraction Progress</span>
          <span>
            {stats.enriched} / {stats.total}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-3">
          <div
            className="bg-[#1B6B3A] h-3 rounded-full transition-all"
            style={{ width: `${pct(stats.enriched, stats.total)}%` }}
          />
        </div>
      </div>

      {/* Category & Bucket Breakdown */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-700">By Category</h3>
          </div>
          <table className="w-full">
            <tbody>
              {Object.entries(stats.byCategory)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]) => (
                  <tr key={cat} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-2 text-sm text-slate-700 capitalize">
                      {cat.replace(/-/g, " ")}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-900 font-medium text-right">
                      {count}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-700">By Bucket</h3>
          </div>
          <table className="w-full">
            <tbody>
              {Object.entries(stats.byBucket)
                .sort((a, b) => b[1] - a[1])
                .map(([bucket, count]) => (
                  <tr key={bucket} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-2 text-sm text-slate-700">{bucket}</td>
                    <td className="px-4 py-2 text-sm text-slate-900 font-medium text-right">
                      {count}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Skipped Files */}
      {SKIPPED_FILES.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Skipped Files ({SKIPPED_FILES.length})
          </h2>
          <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-200">
                  <th className="text-left text-xs font-medium text-amber-800 px-4 py-2">
                    File
                  </th>
                  <th className="text-left text-xs font-medium text-amber-800 px-4 py-2">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {SKIPPED_FILES.map((f, i) => (
                  <tr key={i} className="border-b border-amber-100 last:border-b-0">
                    <td className="px-4 py-2 text-sm text-slate-700">{f.filename}</td>
                    <td className="px-4 py-2 text-sm text-amber-700">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Failed Files */}
      {failedDocs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Failed Extraction ({failedDocs.length})
          </h2>
          <div className="rounded-xl border border-red-200 bg-red-50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-red-200">
                  <th className="text-left text-xs font-medium text-red-800 px-4 py-2">
                    Filename
                  </th>
                  <th className="text-left text-xs font-medium text-red-800 px-4 py-2">
                    Category
                  </th>
                  <th className="text-left text-xs font-medium text-red-800 px-4 py-2">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {failedDocs.map((doc) => (
                  <tr key={doc.id} className="border-b border-red-100 last:border-b-0">
                    <td className="px-4 py-2 text-sm text-slate-700 max-w-xs truncate">
                      {doc.filename}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-600 capitalize">
                      {(doc.category || "—").replace(/-/g, " ")}
                    </td>
                    <td className="px-4 py-2 text-sm text-red-700">
                      {doc.error || "No ai_metadata — extraction may not have run"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color = "slate",
}: {
  label: string;
  value: number;
  subtitle?: string;
  color?: "slate" | "green" | "amber" | "red";
}) {
  const colors = {
    slate: "border-slate-200 bg-white",
    green: "border-green-200 bg-green-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  };
  const textColors = {
    slate: "text-slate-900",
    green: "text-green-900",
    amber: "text-amber-900",
    red: "text-red-900",
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${textColors[color]}`}>
        {value.toLocaleString()}
      </p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}
