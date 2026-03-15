"use client";

import { useAuth } from "@/contexts/auth-context";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  API_BASE, PAGE_SIZE, IMG_EXTS, formatSize, USER_OPTIONS,
  type FileResult, type ExifData, type Stats,
} from "../_shared";

export default function PhotosTab() {
  const { session } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [driveOnline, setDriveOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [results, setResults] = useState<FileResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [lightbox, setLightbox] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });
  const [lightboxBlob, setLightboxBlob] = useState<string | null>(null);
  const [lightboxExif, setLightboxExif] = useState<ExifData | null>(null);
  const [loadingFullRes, setLoadingFullRes] = useState(false);
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

  const thumbUrl = (fileId: number, size = "sm") =>
    `${API_BASE}/thumbnail/${fileId}?_t=${token}&size=${size}`;

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
        const data = await apiFetch("/search", {
          q: query,
          ext: "jpg,jpeg,png,gif,bmp,tiff,tif,webp,heic",
          dir: userFilter,
          sort: sortBy,
          order: sortOrder,
          exif: "1",
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
    [apiFetch, query, userFilter, sortBy, sortOrder]
  );

  const openPhoto = (index: number) => {
    const f = results[index];
    if (!f) return;
    setLightbox({ open: true, index });
    setLightboxBlob(null);
    setLightboxExif(null);
    setLoadingFullRes(false);
    apiFetch(`/photo-exif/${f.id}`).then(setLightboxExif).catch(() => {});
  };

  const closeLightbox = () => {
    setLightbox({ open: false, index: 0 });
    if (lightboxBlob) URL.revokeObjectURL(lightboxBlob);
    setLightboxBlob(null);
    setLightboxExif(null);
  };

  const loadFullRes = async (fileId: number) => {
    setLoadingFullRes(true);
    try {
      const res = await fetch(`${API_BASE}/preview/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      setLightboxBlob(URL.createObjectURL(blob));
    } catch {
      // ignore
    } finally {
      setLoadingFullRes(false);
    }
  };

  const navLightbox = (dir: number) => {
    let i = lightbox.index + dir;
    while (i >= 0 && i < results.length) {
      if (IMG_EXTS.has((results[i].ext || "").toLowerCase())) {
        openPhoto(i);
        return;
      }
      i += dir;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (lightbox.open) {
        if (e.key === "Escape") closeLightbox();
        else if (e.key === "ArrowLeft") navLightbox(-1);
        else if (e.key === "ArrowRight") navLightbox(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox.open, lightbox.index, results]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const from = offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const currentFile = lightbox.open ? results[lightbox.index] : null;

  const exampleQueries = ["sunset", "birthday", "beach", "family", "hiking", "snow"];

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Photos</h1>
        {stats?.total_photos != null && (
          <span className="text-sm text-slate-400">
            {Number(stats.total_photos).toLocaleString()} photos indexed
          </span>
        )}
      </div>

      {/* Stats row */}
      {stats && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {[
            { label: "Photos", val: Number(stats.total_photos || 0).toLocaleString() },
            { label: "With GPS", val: Number(stats.photos_with_gps || 0).toLocaleString() },
            { label: "Indexed", val: (stats.indexed_at || "").split("T")[0] },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-lg px-4 py-3 min-w-[120px]">
              <div className="text-[0.7rem] text-slate-400 uppercase tracking-wide">{s.label}</div>
              <div className="text-xl font-bold text-slate-900">{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {!driveOnline && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2">
          <span>&#9888;</span>
          <span>External drive is offline — search works but thumbnails are unavailable.</span>
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
          placeholder="Search photos by name..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-amber-600"
        />
        <button
          onClick={() => doSearch(0)}
          className="px-5 py-2.5 bg-amber-600 text-white font-semibold rounded-lg text-sm hover:bg-amber-700 whitespace-nowrap"
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
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none"
        >
          <option value="">Relevance</option>
          <option value="size">Size</option>
          <option value="mtime">Date modified</option>
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
          <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-amber-600 rounded-full animate-spin" />
        </div>
      )}

      {searchError && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-3">&#9888;</div>
          <p>Search failed: {searchError}</p>
        </div>
      )}

      {/* Results grid — photo-optimized */}
      {!searching && !searchError && results.length > 0 && (
        <>
          <div className="text-sm text-slate-400 mb-3">
            {from}-{to} of {total.toLocaleString()} photos
            {query ? ` matching "${query}"` : ""}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mb-6">
            {results.map((f, i) => (
              <div
                key={f.id}
                onClick={() => openPhoto(i)}
                className="group relative aspect-square bg-slate-100 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-amber-500 transition-all"
              >
                <img
                  src={thumbUrl(f.id)}
                  loading="lazy"
                  alt={f.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end">
                  <div className="w-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="text-white text-xs truncate font-medium">{f.name}</div>
                    <div className="text-white/70 text-[0.65rem]">{formatSize(f.size)}</div>
                  </div>
                </div>
              </div>
            ))}
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
          <div className="text-5xl mb-4">{"\ud83d\udcf7"}</div>
          <p className="text-lg mb-2">Search your photo library</p>
          <p className="text-sm mb-6">Find photos by filename. AI-powered semantic search coming soon.</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {exampleQueries.map((q) => (
              <button
                key={q}
                onClick={() => { setQuery(q); setTimeout(() => doSearch(0), 0); }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-600 text-sm rounded-full transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
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

          {/* Nav arrows */}
          <button
            onClick={() => navLightbox(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 hover:text-white bg-transparent border-none cursor-pointer p-4"
          >
            &#8249;
          </button>
          <button
            onClick={() => navLightbox(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 hover:text-white bg-transparent border-none cursor-pointer p-4"
          >
            &#8250;
          </button>

          <div className="max-w-[95vw] max-h-[85vh] flex items-center justify-center">
            {!lightboxBlob ? (
              <img
                src={thumbUrl(currentFile.id, "md")}
                alt={currentFile.name}
                className="max-w-full max-h-[85vh] rounded cursor-zoom-in"
                onClick={() => loadFullRes(currentFile.id)}
                title={loadingFullRes ? "Loading full resolution..." : "Click for full resolution"}
              />
            ) : (
              <img
                src={lightboxBlob}
                alt={currentFile.name}
                className="max-w-full max-h-[85vh] rounded"
                title="Full resolution"
              />
            )}
          </div>

          <div className="text-slate-400 text-sm mt-3 text-center max-w-[90vw] truncate">
            {currentFile.name} &mdash; {formatSize(currentFile.size)}
            {loadingFullRes && " (loading full res...)"}
          </div>

          {lightboxExif && (
            <div className="text-slate-500 text-xs mt-1 text-center">
              {[
                lightboxExif.camera_model,
                lightboxExif.date_taken,
                lightboxExif.focal_length,
                lightboxExif.aperture ? "f/" + lightboxExif.aperture : null,
                lightboxExif.iso ? "ISO " + lightboxExif.iso : null,
                lightboxExif.width && lightboxExif.height
                  ? `${lightboxExif.width}\u00d7${lightboxExif.height}`
                  : null,
              ]
                .filter(Boolean)
                .join(" \u2022 ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
