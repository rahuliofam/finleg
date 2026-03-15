"use client";

import { useAuth } from "@/contexts/auth-context";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  API_BASE, PAGE_SIZE, fileIcon, formatSize, USER_OPTIONS,
  type FileResult, type Stats,
} from "../_shared";

const FINLEG_EXTS = "pdf,doc,docx,xls,xlsx,csv,txt,rtf,ppt,pptx";
const CATEGORIES = [
  { value: "", label: "All Financial & Legal" },
  { value: "tax", label: "Tax Documents" },
  { value: "insurance", label: "Insurance" },
  { value: "bank", label: "Banking" },
  { value: "investment", label: "Investments" },
  { value: "legal", label: "Legal / Contracts" },
  { value: "property", label: "Property / Real Estate" },
  { value: "medical", label: "Medical / Health" },
  { value: "estate", label: "Estate Planning" },
];

export default function FinancialLegalTab() {
  const { session } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [driveOnline, setDriveOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [category, setCategory] = useState("");
  const [extFilter, setExtFilter] = useState("");
  const [sortBy, setSortBy] = useState("mtime");
  const [sortOrder, setSortOrder] = useState("desc");
  const [results, setResults] = useState<FileResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [lightbox, setLightbox] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });
  const [lightboxBlob, setLightboxBlob] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const token = session?.access_token;

  const apiFetch = useCallback(
    async (path: string, params: Record<string, string | number> = {}) => {
      if (!token) throw new Error("Not authenticated");
      const url = new URL(API_BASE + path);
      for (const [k, v] of Object.entries(params)) {
        if (v !== "" && v !== null && v !== undefined) url.searchParams.set(k, String(v));
      }
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      return res.json();
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;
    apiFetch("/stats").then(setStats).catch(console.error);
    fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((d) => setDriveOnline(d.drive_mounted === true))
      .catch(() => setDriveOnline(false));
  }, [token, apiFetch]);

  const doSearch = useCallback(
    async (newOffset = 0) => {
      setSearching(true);
      setSearchError("");
      setOffset(newOffset);
      try {
        // Build search query: combine user query with category keyword
        let searchQuery = query;
        if (category) {
          searchQuery = category + (query ? " " + query : "");
        }

        const data = await apiFetch("/search", {
          q: searchQuery,
          ext: extFilter || FINLEG_EXTS,
          dir: userFilter,
          sort: sortBy,
          order: sortOrder,
          limit: PAGE_SIZE,
          offset: newOffset,
        });
        setResults(data.results);
        setTotal(data.total);
      } catch (e: unknown) {
        setSearchError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setTotal(0);
      } finally {
        setSearching(false);
      }
    },
    [apiFetch, query, userFilter, category, extFilter, sortBy, sortOrder]
  );

  const openFile = (index: number) => {
    const f = results[index];
    if (!f) return;
    setLightbox({ open: true, index });
    setLightboxBlob(null);
    fetch(`${API_BASE}/preview/${f.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => setLightboxBlob(URL.createObjectURL(blob)))
      .catch(() => {});
  };

  const closeLightbox = () => {
    setLightbox({ open: false, index: 0 });
    if (lightboxBlob) URL.revokeObjectURL(lightboxBlob);
    setLightboxBlob(null);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (lightbox.open && e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox.open]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const from = offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const currentFile = lightbox.open ? results[lightbox.index] : null;
  const currentExt = (currentFile?.ext || "").toLowerCase();

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Financial &amp; Legal</h1>
        {stats?.total_files != null && (
          <span className="text-sm text-slate-400">
            Documents from your file vault
          </span>
        )}
      </div>

      {/* Quick-access category chips */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => { setCategory(cat.value); setTimeout(() => doSearch(0), 0); }}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              category === cat.value
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {!driveOnline && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2">
          <span>&#9888;</span>
          <span>External drive is offline — search works but file previews are unavailable.</span>
        </div>
      )}

      {/* Search bar */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(0)}
          placeholder="Search financial & legal documents..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-emerald-600"
        />
        <button
          onClick={() => doSearch(0)}
          className="px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg text-sm hover:bg-emerald-700 whitespace-nowrap"
        >
          Search
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none"
        >
          {USER_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
        <select
          value={extFilter}
          onChange={(e) => setExtFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none"
        >
          <option value="">All document types</option>
          <option value="pdf">PDFs</option>
          <option value="xls,xlsx,csv">Spreadsheets</option>
          <option value="doc,docx,rtf,txt">Word / Text</option>
          <option value="ppt,pptx">Presentations</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none"
        >
          <option value="mtime">Date modified</option>
          <option value="">Relevance</option>
          <option value="size">Size</option>
          <option value="name">Name</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none"
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </div>

      {/* Loading */}
      {searching && (
        <div className="text-center py-12 text-slate-400">
          <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      )}

      {searchError && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-3">&#9888;</div>
          <p>Search failed: {searchError}</p>
        </div>
      )}

      {/* Results — list view optimized for documents */}
      {!searching && !searchError && results.length > 0 && (
        <>
          <div className="text-sm text-slate-400 mb-3">
            {from}-{to} of {total.toLocaleString()} documents
            {query ? ` matching "${query}"` : ""}
            {category ? ` in ${CATEGORIES.find((c) => c.value === category)?.label}` : ""}
          </div>

          <div className="mb-6">
            {results.map((f, i) => {
              const ext = (f.ext || "").toLowerCase();
              const dirShort = (f.dir || "").replace("/Volumes/rvault20/", "");
              return (
                <div
                  key={f.id}
                  onClick={() => openFile(i)}
                  className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-lg mb-1.5 cursor-pointer hover:border-emerald-500 hover:shadow-sm transition-all"
                >
                  <div className="text-2xl w-10 text-center flex-shrink-0">{fileIcon(ext)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-slate-900">{f.name}</div>
                    <div className="text-xs text-slate-400 truncate mt-0.5" title={f.path}>
                      {dirShort}
                    </div>
                  </div>
                  <span className="text-[0.65rem] font-semibold uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded flex-shrink-0">
                    {ext || "?"}
                  </span>
                  <div className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0 hidden sm:block">
                    {f.mtime_str ? f.mtime_str.split("T")[0] : ""}
                  </div>
                  <div className="text-[0.78rem] text-slate-600 whitespace-nowrap min-w-[60px] text-right flex-shrink-0">
                    {formatSize(f.size)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex justify-center gap-3 items-center mb-8">
              <button
                onClick={() => doSearch(offset - PAGE_SIZE)}
                disabled={offset === 0}
                className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-sm disabled:opacity-40 hover:bg-slate-50"
              >
                Prev
              </button>
              <span className="text-sm text-slate-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => doSearch(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                className="px-4 py-2 border border-slate-300 rounded-lg bg-white text-sm disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!searching && !searchError && results.length === 0 && total === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83d\udcc2"}</div>
          <p className="text-lg mb-2">Financial &amp; Legal Documents</p>
          <p className="text-sm mb-4">Search for tax returns, insurance policies, contracts, bank statements, and more.</p>
          <p className="text-sm">Select a category above or type a search term to get started.</p>
        </div>
      )}

      {/* Document preview lightbox */}
      {lightbox.open && currentFile && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[51]"
          >
            &times;
          </button>

          <div className="max-w-[95vw] max-h-[85vh] flex items-center justify-center">
            {currentExt === "pdf" && lightboxBlob ? (
              <iframe
                src={`${lightboxBlob}#toolbar=1`}
                title={currentFile.name}
                className="w-[90vw] h-[85vh] border-none rounded bg-white"
              />
            ) : lightboxBlob ? (
              <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left">
                <div className="text-5xl text-center mb-4">{fileIcon(currentFile.ext)}</div>
                <h3 className="text-lg font-semibold mb-4 break-all">{currentFile.name}</h3>
                <p className="text-sm text-slate-500 mb-4">Preview not available for this file type. File downloaded for local viewing.</p>
                <a
                  href={lightboxBlob}
                  download={currentFile.name}
                  className="inline-block px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700"
                >
                  Download File
                </a>
              </div>
            ) : (
              <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left">
                <div className="text-5xl text-center mb-4">{fileIcon(currentFile.ext)}</div>
                <h3 className="text-lg font-semibold mb-4 break-all">{currentFile.name}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr><td className="text-slate-400 py-1 pr-3">Path</td><td className="break-all">{(currentFile.dir || "").replace("/Volumes/rvault20/", "")}</td></tr>
                    <tr><td className="text-slate-400 py-1 pr-3">Size</td><td>{formatSize(currentFile.size)}</td></tr>
                    <tr><td className="text-slate-400 py-1 pr-3">Type</td><td>{(currentFile.ext || "unknown").toUpperCase()}</td></tr>
                    <tr><td className="text-slate-400 py-1 pr-3">Modified</td><td>{currentFile.mtime_str || "unknown"}</td></tr>
                  </tbody>
                </table>
                <div className="mt-4 flex items-center gap-2 text-slate-400">
                  <div className="inline-block w-4 h-4 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin" />
                  <span className="text-sm">Loading preview...</span>
                </div>
              </div>
            )}
          </div>

          <div className="text-slate-400 text-sm mt-3 text-center max-w-[90vw] truncate">
            {currentFile.name} &mdash; {formatSize(currentFile.size)}
          </div>
        </div>
      )}
    </div>
  );
}
