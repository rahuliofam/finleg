"use client";

import { useAuth } from "@/contexts/auth-context";
import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = "https://files.alpacaplayhouse.com";
const PAGE_SIZE = 60;

const IMG_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "heic"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "flv", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "flac", "wma", "aac", "wav", "ogg", "m4a"]);
const DOC_EXTS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf"]);

function fileIcon(ext: string) {
  ext = (ext || "").toLowerCase();
  if (IMG_EXTS.has(ext)) return "\ud83d\uddbc\ufe0f";
  if (VIDEO_EXTS.has(ext)) return "\ud83c\udfa5";
  if (AUDIO_EXTS.has(ext)) return "\ud83c\udfa7";
  if (ext === "pdf") return "\ud83d\udcc4";
  if (DOC_EXTS.has(ext)) return "\ud83d\udcc3";
  if (["zip", "rar", "7z", "tgz", "gz", "tar"].includes(ext)) return "\ud83d\udce6";
  return "\ud83d\udcc1";
}

function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

interface FileResult {
  id: number;
  name: string;
  path: string;
  ext: string;
  dir: string;
  size: number;
  mtime_str: string;
  category: string;
  rank: number;
  exif?: ExifData;
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

interface Stats {
  total_files?: number;
  total_size_tb?: string;
  total_photos?: number;
  photos_with_gps?: number;
  indexed_at?: string;
}

export default function FileVaultPage() {
  const { session } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [driveOnline, setDriveOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [extFilter, setExtFilter] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [includeExif, setIncludeExif] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
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

  // Load stats on mount
  useEffect(() => {
    if (!token) return;
    apiFetch("/stats")
      .then(setStats)
      .catch(console.error);
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
          ext: extFilter,
          sort: sortBy,
          order: sortOrder,
          exif: includeExif ? "1" : "",
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
    [apiFetch, query, extFilter, sortBy, sortOrder, includeExif]
  );

  // Open lightbox
  const openFile = (index: number) => {
    const f = results[index];
    if (!f) return;
    const ext = (f.ext || "").toLowerCase();
    if (IMG_EXTS.has(ext) || ext === "pdf" || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
      setLightbox({ open: true, index });
      setLightboxBlob(null);
      setLightboxExif(null);
      setLoadingFullRes(false);

      // Load EXIF for images
      if (IMG_EXTS.has(ext)) {
        apiFetch(`/photo-exif/${f.id}`)
          .then(setLightboxExif)
          .catch(() => {});
      }

      // Load blob for non-image types (PDF, video, audio)
      if (!IMG_EXTS.has(ext)) {
        fetch(`${API_BASE}/preview/${f.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.blob())
          .then((blob) => setLightboxBlob(URL.createObjectURL(blob)))
          .catch(() => {});
      }
    } else {
      // Non-previewable: open info lightbox
      setLightbox({ open: true, index });
      setLightboxBlob(null);
      setLightboxExif(null);
    }
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

  const findAdjacentImage = (dir: number): number | null => {
    let i = lightbox.index + dir;
    while (i >= 0 && i < results.length) {
      const ext = (results[i].ext || "").toLowerCase();
      if (IMG_EXTS.has(ext)) return i;
      i += dir;
    }
    return null;
  };

  const navLightbox = (dir: number) => {
    const next = findAdjacentImage(dir);
    if (next !== null) openFile(next);
  };

  // Keyboard shortcuts
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
  const currentExt = (currentFile?.ext || "").toLowerCase();
  const isImage = IMG_EXTS.has(currentExt);

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">File Vault</h1>
        {stats?.indexed_at && (
          <span className="text-sm text-slate-400">
            Indexed {stats.indexed_at.split("T")[0]}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setView("grid")}
            className={`px-2 py-1 border rounded text-sm ${view === "grid" ? "bg-amber-600 text-white border-amber-600" : "bg-white border-slate-300"}`}
          >
            &#9638;
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-2 py-1 border rounded text-sm ${view === "list" ? "bg-amber-600 text-white border-amber-600" : "bg-white border-slate-300"}`}
          >
            &#9776;
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {[
            { label: "Files", val: Number(stats.total_files || 0).toLocaleString() },
            { label: "Total Size", val: (stats.total_size_tb || "?") + " TB" },
            { label: "Photos", val: Number(stats.total_photos || 0).toLocaleString() },
            { label: "With GPS", val: Number(stats.photos_with_gps || 0).toLocaleString() },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-lg px-4 py-3 min-w-[120px]">
              <div className="text-[0.7rem] text-slate-400 uppercase tracking-wide">{s.label}</div>
              <div className="text-xl font-bold text-slate-900">{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Drive offline banner */}
      {!driveOnline && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2">
          <span>&#9888;</span>
          <span>External drive is offline — search works but thumbnails and file previews are unavailable.</span>
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
          placeholder="Search files by name..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-slate-300 rounded-lg bg-white text-sm outline-none focus:border-amber-600"
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
          value={extFilter}
          onChange={(e) => { setExtFilter(e.target.value); }}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm outline-none"
        >
          <option value="">All types</option>
          <option value="jpg,jpeg,png,gif,bmp,tiff,webp,heic">Photos</option>
          <option value="mp4,mov,avi,mkv,wmv,flv">Videos</option>
          <option value="pdf">PDFs</option>
          <option value="doc,docx,xls,xlsx,ppt,pptx,txt,csv">Documents</option>
          <option value="mp3,flac,wma,aac,wav,ogg,m4a">Audio</option>
          <option value="zip,rar,7z,tgz,gz,tar">Archives</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm outline-none"
        >
          <option value="">Relevance</option>
          <option value="size">Size</option>
          <option value="mtime">Date modified</option>
          <option value="name">Name</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm outline-none"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <label className="text-sm text-slate-600 flex items-center gap-1">
          <input
            type="checkbox"
            checked={includeExif}
            onChange={(e) => setIncludeExif(e.target.checked)}
          />
          EXIF data
        </label>
      </div>

      {/* Results info */}
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

      {!searching && !searchError && results.length > 0 && (
        <>
          <div className="text-sm text-slate-400 mb-3">
            {from}-{to} of {total.toLocaleString()} results
            {query ? ` for "${query}"` : ""}
          </div>

          {/* Grid view */}
          {view === "grid" && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 mb-6">
              {results.map((f, i) => {
                const ext = (f.ext || "").toLowerCase();
                const isImg = IMG_EXTS.has(ext);
                return (
                  <div
                    key={f.id}
                    onClick={() => openFile(i)}
                    className="bg-white border border-slate-200 rounded-lg overflow-hidden cursor-pointer hover:border-amber-600 hover:shadow-md transition-all"
                  >
                    {isImg ? (
                      <div className="w-full h-[140px] bg-slate-100">
                        <img
                          src={thumbUrl(f.id)}
                          loading="lazy"
                          alt={f.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            (e.target as HTMLImageElement).parentElement!.innerHTML = `<div class="flex items-center justify-center w-full h-full text-4xl text-slate-300">${fileIcon(ext)}</div>`;
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-full h-[140px] flex items-center justify-center bg-slate-50 text-4xl text-slate-300">
                        {fileIcon(ext)}
                      </div>
                    )}
                    <div className="px-3 py-2">
                      <div className="text-[0.78rem] font-medium truncate">{f.name}</div>
                      <div className="text-[0.68rem] text-slate-400 mt-0.5">
                        <span className="inline-block text-[0.6rem] font-semibold uppercase bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          {ext || "?"}
                        </span>{" "}
                        {formatSize(f.size)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* List view */}
          {view === "list" && (
            <div className="mb-6">
              {results.map((f, i) => {
                const ext = (f.ext || "").toLowerCase();
                const dirShort = (f.dir || "").replace("/Volumes/rvault20/", "");
                return (
                  <div
                    key={f.id}
                    onClick={() => openFile(i)}
                    className="flex items-center gap-3 px-3 py-2.5 bg-white border border-slate-200 rounded-lg mb-1.5 cursor-pointer hover:border-amber-600 transition-colors"
                  >
                    <div className="text-xl w-8 text-center flex-shrink-0">{fileIcon(ext)}</div>
                    <div className="flex-1 text-sm truncate">{f.name}</div>
                    <div className="flex-2 text-xs text-slate-400 truncate hidden sm:block" title={f.path}>
                      {dirShort}
                    </div>
                    <span className="text-[0.65rem] font-semibold uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                      {ext || "?"}
                    </span>
                    <div className="text-[0.78rem] text-slate-600 whitespace-nowrap min-w-[60px] text-right">
                      {formatSize(f.size)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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

      {!searching && !searchError && results.length === 0 && total === 0 && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-3">{"\ud83d\udd0d"}</div>
          <p>Search your file vault. Enter a name or browse by type.</p>
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

          {/* Nav arrows for images */}
          {isImage && findAdjacentImage(-1) !== null && (
            <button
              onClick={() => navLightbox(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 hover:text-white bg-transparent border-none cursor-pointer p-4"
            >
              &#8249;
            </button>
          )}
          {isImage && findAdjacentImage(1) !== null && (
            <button
              onClick={() => navLightbox(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 hover:text-white bg-transparent border-none cursor-pointer p-4"
            >
              &#8250;
            </button>
          )}

          {/* Content */}
          <div className="max-w-[95vw] max-h-[85vh] flex items-center justify-center">
            {isImage && !lightboxBlob && (
              <img
                src={thumbUrl(currentFile.id, "md")}
                alt={currentFile.name}
                className="max-w-full max-h-[85vh] rounded cursor-zoom-in"
                onClick={() => loadFullRes(currentFile.id)}
                title={loadingFullRes ? "Loading full resolution..." : "Click for full resolution"}
              />
            )}
            {isImage && lightboxBlob && (
              <img
                src={lightboxBlob}
                alt={currentFile.name}
                className="max-w-full max-h-[85vh] rounded"
                title="Full resolution"
              />
            )}
            {currentExt === "pdf" && lightboxBlob && (
              <iframe
                src={`${lightboxBlob}#toolbar=1`}
                title={currentFile.name}
                className="w-[90vw] h-[85vh] border-none rounded bg-white"
              />
            )}
            {VIDEO_EXTS.has(currentExt) && lightboxBlob && (
              <video controls autoPlay className="max-w-[90vw] max-h-[80vh] rounded">
                <source src={lightboxBlob} />
              </video>
            )}
            {AUDIO_EXTS.has(currentExt) && lightboxBlob && (
              <div className="text-center">
                <div className="text-5xl mb-4">{"\ud83c\udfa7"}</div>
                <audio controls autoPlay className="w-[400px] max-w-[90vw]">
                  <source src={lightboxBlob} />
                </audio>
              </div>
            )}
            {!isImage && !lightboxBlob && !VIDEO_EXTS.has(currentExt) && !AUDIO_EXTS.has(currentExt) && currentExt !== "pdf" && (
              <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left">
                <div className="text-5xl text-center mb-4">{fileIcon(currentFile.ext)}</div>
                <h3 className="text-lg font-semibold mb-4 break-all">{currentFile.name}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr><td className="text-slate-400 py-1">Path</td><td className="break-all">{(currentFile.dir || "").replace("/Volumes/rvault20/", "")}</td></tr>
                    <tr><td className="text-slate-400 py-1">Size</td><td>{formatSize(currentFile.size)}</td></tr>
                    <tr><td className="text-slate-400 py-1">Type</td><td>{(currentFile.ext || "unknown").toUpperCase()}</td></tr>
                    <tr><td className="text-slate-400 py-1">Modified</td><td>{currentFile.mtime_str || "unknown"}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {!isImage && !lightboxBlob && (VIDEO_EXTS.has(currentExt) || AUDIO_EXTS.has(currentExt) || currentExt === "pdf") && (
              <div className="inline-block w-6 h-6 border-3 border-slate-600 border-t-white rounded-full animate-spin" />
            )}
          </div>

          {/* Info bar */}
          <div className="text-slate-400 text-sm mt-3 text-center max-w-[90vw] truncate">
            {currentFile.name} &mdash; {formatSize(currentFile.size)}
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
        </div>
      )}
    </div>
  );
}
