"use client";

import { useAuth } from "@/contexts/auth-context";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, formatSize } from "../../files/_shared";

interface PhotoSearchResult {
  file_id: number;
  path: string;
  name: string;
  score: number;
  thumbnail_url: string;
  size?: number;
  caption?: string;
}

interface ExifData {
  camera_model?: string;
  date_taken?: string;
  focal_length?: string;
  aperture?: string;
  iso?: string;
  width?: number;
  height?: number;
}

interface SearchResponse {
  results: PhotoSearchResult[];
  total: number;
  query: string;
  mode: string;
  search_time_ms: number;
}

type SearchMode = "semantic" | "text" | "hybrid";

const RESULTS_PER_PAGE = 50;

export default function PhotoSearchTab() {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [results, setResults] = useState<PhotoSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [searchTimeMs, setSearchTimeMs] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [lightbox, setLightbox] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });
  const [lightboxBlob, setLightboxBlob] = useState<string | null>(null);
  const [lightboxExif, setLightboxExif] = useState<ExifData | null>(null);
  const [loadingFullRes, setLoadingFullRes] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const token = session?.access_token;

  const doSearch = useCallback(
    async (newOffset = 0) => {
      if (!token || !query.trim()) return;
      setSearching(true);
      setSearchError("");
      setHasSearched(true);
      try {
        const res = await fetch(`${API_BASE}/photo-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: query.trim(),
            mode,
            limit: RESULTS_PER_PAGE,
            offset: newOffset,
          }),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
        const data: SearchResponse = await res.json();
        if (newOffset === 0) {
          setResults(data.results);
        } else {
          setResults((prev) => [...prev, ...data.results]);
        }
        setTotal(data.total);
        setSearchTimeMs(data.search_time_ms);
      } catch (e: unknown) {
        setSearchError(e instanceof Error ? e.message : "Search failed");
        if (newOffset === 0) {
          setResults([]);
          setTotal(0);
        }
      } finally {
        setSearching(false);
      }
    },
    [token, query, mode]
  );

  const thumbUrl = (fileId: number, size = "sm") =>
    `${API_BASE}/thumbnail/${fileId}?_t=${token}&size=${size}`;

  const openPhoto = (index: number) => {
    const f = results[index];
    if (!f) return;
    setLightbox({ open: true, index });
    setLightboxBlob(null);
    setLightboxExif(null);
    setLoadingFullRes(false);
    // Fetch EXIF data
    fetch(`${API_BASE}/photo-exif/${f.file_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setLightboxExif)
      .catch(() => {});
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
    const i = lightbox.index + dir;
    if (i >= 0 && i < results.length) {
      openPhoto(i);
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

  const currentFile = lightbox.open ? results[lightbox.index] : null;
  const exampleQueries = [
    "sunset at the beach",
    "birthday cake",
    "hiking in the mountains",
    "family dinner",
    "snow day",
    "baby photos",
    "graduation",
    "holiday decorations",
  ];

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Photo Search</h1>
        <span className="text-sm text-slate-400">AI-powered semantic search</span>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(0)}
          placeholder="Search your photos... (e.g., sunset at the beach, birthday cake, hiking)"
          className="flex-1 min-w-[200px] px-4 py-3 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600"
        />
        <button
          onClick={() => doSearch(0)}
          disabled={!query.trim() || searching}
          className="px-6 py-3 bg-amber-600 text-white font-semibold rounded-lg text-sm hover:bg-amber-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Search mode toggle */}
      <div className="flex gap-2 mb-6 items-center">
        <span className="text-xs text-slate-400 mr-1">Mode:</span>
        {(["hybrid", "semantic", "text"] as SearchMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
              mode === m
                ? "bg-amber-100 text-amber-800 font-medium"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {m === "hybrid" ? "Hybrid" : m === "semantic" ? "Semantic" : "Text"}
          </button>
        ))}
        <span className="text-[0.65rem] text-slate-400 ml-2">
          {mode === "hybrid" && "Best of both — AI understanding + keyword matching"}
          {mode === "semantic" && "Find by visual similarity and meaning"}
          {mode === "text" && "Search photo captions by keyword"}
        </span>
      </div>

      {/* Loading */}
      {searching && results.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-amber-600 rounded-full animate-spin" />
          <p className="mt-3 text-sm">Searching through your photos...</p>
        </div>
      )}

      {/* Error */}
      {searchError && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-3">&#9888;</div>
          <p>Search failed: {searchError}</p>
        </div>
      )}

      {/* Results */}
      {!searchError && results.length > 0 && (
        <>
          <div className="text-sm text-slate-400 mb-3">
            {total.toLocaleString()} result{total !== 1 ? "s" : ""} in{" "}
            {(searchTimeMs / 1000).toFixed(2)}s
            {query ? ` for "${query}"` : ""}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mb-6">
            {results.map((f, i) => (
              <div
                key={`${f.file_id}-${i}`}
                onClick={() => openPhoto(i)}
                className="group relative aspect-square bg-slate-100 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-amber-500 transition-all"
              >
                <img
                  src={thumbUrl(f.file_id)}
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
                    <div className="text-white/70 text-[0.65rem]">
                      {Math.round(f.score * 100)}% match
                      {f.size ? ` \u00b7 ${formatSize(f.size)}` : ""}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Load more */}
          {results.length < total && (
            <div className="text-center mb-8">
              <button
                onClick={() => doSearch(results.length)}
                disabled={searching}
                className="px-6 py-2.5 border border-slate-300 rounded-lg bg-white text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {searching ? "Loading..." : `Load more (${results.length} of ${total.toLocaleString()})`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Empty state — before searching */}
      {!hasSearched && !searching && results.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83d\udd0d"}</div>
          <p className="text-lg mb-2">Search your photo library</p>
          <p className="text-sm mb-6 max-w-md mx-auto">
            Describe what you&apos;re looking for in natural language. Our AI understands
            scenes, objects, activities, and moods.
          </p>
          <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
            {exampleQueries.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuery(q);
                  setTimeout(() => doSearch(0), 0);
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-600 text-sm rounded-full transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No results — after searching */}
      {hasSearched && !searching && !searchError && results.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83d\udcf7"}</div>
          <p className="text-lg mb-2">No photos matched your search</p>
          <p className="text-sm mb-6">Try different words or a broader description.</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {exampleQueries.slice(0, 4).map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuery(q);
                  setTimeout(() => doSearch(0), 0);
                }}
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
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
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

          <div className="max-w-[95vw] max-h-[75vh] flex items-center justify-center">
            {!lightboxBlob ? (
              <img
                src={thumbUrl(currentFile.file_id, "md")}
                alt={currentFile.name}
                className="max-w-full max-h-[75vh] rounded cursor-zoom-in"
                onClick={() => loadFullRes(currentFile.file_id)}
                title={loadingFullRes ? "Loading full resolution..." : "Click for full resolution"}
              />
            ) : (
              <img
                src={lightboxBlob}
                alt={currentFile.name}
                className="max-w-full max-h-[75vh] rounded"
                title="Full resolution"
              />
            )}
          </div>

          {/* File info */}
          <div className="text-slate-400 text-sm mt-3 text-center max-w-[90vw] truncate">
            {currentFile.name} &mdash; {Math.round(currentFile.score * 100)}% match
            {currentFile.size ? ` \u00b7 ${formatSize(currentFile.size)}` : ""}
            {loadingFullRes && " (loading full res...)"}
          </div>

          {/* EXIF */}
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

          {/* Caption */}
          {currentFile.caption && (
            <div className="text-slate-400 text-xs mt-3 text-center max-w-lg mx-auto px-4 leading-relaxed">
              <span className="text-slate-500 font-medium">AI Caption:</span>{" "}
              {currentFile.caption}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
