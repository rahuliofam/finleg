"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Release {
  id: string;
  version: string;
  release_number: number;
  sha: string;
  actor: string;
  pushed_at: string;
  commits: { sha: string; message: string; author: string }[];
  created_at: string;
}

export function ReleasesTab() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReleases() {
      const { data, error } = await supabase
        .from("releases")
        .select("*")
        .order("release_number", { ascending: false });

      if (error) {
        setError(error.message);
      } else {
        setReleases(data || []);
      }
      setLoading(false);
    }
    fetchReleases();
  }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Releases</h1>
        <p className="text-sm text-slate-500 mt-1">
          {loading
            ? "Loading..."
            : `${releases.length} release${releases.length !== 1 ? "s" : ""} deployed`}
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading releases...
        </div>
      ) : releases.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No releases recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {releases.map((release) => (
            <div
              key={release.id}
              className="rounded-xl border border-slate-200 p-5 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono font-semibold text-slate-900">
                    {release.version}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                    #{release.release_number}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {formatDate(release.pushed_at)}
                </span>
              </div>

              {release.commits && release.commits.length > 0 && (
                <div className="space-y-1.5">
                  {release.commits.map((commit) => (
                    <div
                      key={commit.sha}
                      className="flex items-start gap-2 text-sm"
                    >
                      <code className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono mt-0.5 shrink-0">
                        {commit.sha.slice(0, 7)}
                      </code>
                      <span className="text-slate-700">{commit.message}</span>
                      <span className="text-xs text-slate-400 shrink-0 mt-0.5">
                        {commit.author}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-400">
                <span>
                  Deployed by{" "}
                  <span className="text-slate-600">{release.actor}</span>
                </span>
                <span>SHA: {release.sha}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
