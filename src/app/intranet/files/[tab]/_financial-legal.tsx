"use client";

import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useState, useEffect, useCallback, useRef } from "react";
import { PAGE_SIZE, fileIcon, formatSize } from "../_shared";

interface DocResult {
  id: string;
  bucket: string;
  r2_key: string;
  filename: string;
  file_type: string;
  file_size: number;
  category: string;
  account_type: string;
  institution: string;
  account_name: string;
  account_number: string;
  account_holder: string;
  year: number | null;
  month: number | null;
  statement_date: string | null;
  is_closed: boolean;
  property: string | null;
  original_path: string;
}

// Category chips — matches document_index.category values
const CATEGORIES = [
  { value: "", label: "All" },
  { value: "statement", label: "Statements" },
  { value: "tax", label: "Tax" },
  { value: "insurance", label: "Insurance" },
  { value: "property-expense", label: "Property" },
  { value: "credit-report", label: "Credit Reports" },
  { value: "reference", label: "Reference" },
];

// Account type filter
const ACCOUNT_TYPES = [
  { value: "", label: "All Account Types" },
  { value: "credit-card", label: "Credit Cards" },
  { value: "checking", label: "Checking" },
  { value: "payment", label: "Payment (Venmo, PayPal, Cash App)" },
  { value: "brokerage", label: "Brokerage" },
  { value: "ira", label: "IRA" },
  { value: "trust", label: "Trust" },
  { value: "crypto", label: "Crypto" },
  { value: "mortgage", label: "Mortgage" },
  { value: "heloc", label: "HELOC" },
  { value: "credit-line", label: "Credit Line" },
  { value: "auto-loan", label: "Auto Loan" },
  { value: "sba-loan", label: "SBA Loan" },
  { value: "tax", label: "Tax" },
  { value: "insurance", label: "Insurance" },
  { value: "property", label: "Property" },
  { value: "closed", label: "Closed Accounts" },
];

// Institution filter
const INSTITUTIONS = [
  { value: "", label: "All Institutions" },
  { value: "amex", label: "American Express" },
  { value: "chase", label: "Chase" },
  { value: "charles-schwab", label: "Charles Schwab" },
  { value: "us-bank", label: "US Bank" },
  { value: "robinhood", label: "Robinhood" },
  { value: "apple", label: "Apple" },
  { value: "bank-of-america", label: "Bank of America" },
  { value: "pnc", label: "PNC" },
  { value: "coinbase", label: "Coinbase" },
  { value: "venmo", label: "Venmo" },
  { value: "paypal", label: "PayPal" },
  { value: "cash-app", label: "Cash App" },
  { value: "sba", label: "SBA" },
  { value: "irs", label: "IRS" },
  { value: "various", label: "Various" },
];

// Format filter (file type)
const FORMATS = [
  { value: "", label: "All Formats" },
  { value: "pdf", label: "PDF" },
  { value: "spreadsheet", label: "Spreadsheet (xlsx, csv)" },
  { value: "document", label: "Document (docx, doc)" },
  { value: "image", label: "Image (jpg, png)" },
];

// Year filter — generate dynamically
const YEARS = [
  { value: "", label: "All Years" },
  ...Array.from({ length: 8 }, (_, i) => {
    const y = 2026 - i;
    return { value: String(y), label: String(y) };
  }),
];

// Account holder filter
const HOLDERS = [
  { value: "", label: "All Account Holders" },
  { value: "Rahul", label: "Rahul" },
  { value: "Subhash", label: "Subhash" },
  { value: "Family", label: "Family" },
  { value: "Trust", label: "Trust" },
  { value: "Tesaloop", label: "Tesaloop" },
];

export default function FinancialLegalTab() {
  useAuth(); // ensure authenticated
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [accountType, setAccountType] = useState("");
  const [institution, setInstitution] = useState("");
  const [format, setFormat] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [holderFilter, setHolderFilter] = useState("");
  const [sortBy, setSortBy] = useState("year");
  const [sortOrder, setSortOrder] = useState("desc");
  const [results, setResults] = useState<DocResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [totalDocs, setTotalDocs] = useState(0);
  const [lightbox, setLightbox] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });
  const [lightboxBlob, setLightboxBlob] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load total document count on mount
  useEffect(() => {
    supabase
      .from("document_index")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => {
        if (count != null) setTotalDocs(count);
      });
  }, []);

  const doSearch = useCallback(
    async (newOffset = 0) => {
      setSearching(true);
      setSearchError("");
      setOffset(newOffset);
      try {
        let q = supabase
          .from("document_index")
          .select("*", { count: "exact" });

        // Text search
        if (query.trim()) {
          q = q.textSearch("fts", query.trim(), { type: "websearch" });
        }

        // Filters
        if (category) q = q.eq("category", category);
        if (accountType) q = q.eq("account_type", accountType);
        if (institution) q = q.eq("institution", institution);
        if (holderFilter) q = q.eq("account_holder", holderFilter);
        if (yearFilter) q = q.eq("year", parseInt(yearFilter));

        // Format filter maps to file_type values
        if (format === "pdf") {
          q = q.eq("file_type", "pdf");
        } else if (format === "spreadsheet") {
          q = q.in("file_type", ["xlsx", "xls", "csv"]);
        } else if (format === "document") {
          q = q.in("file_type", ["docx", "doc", "rtf", "txt"]);
        } else if (format === "image") {
          q = q.in("file_type", ["jpg", "jpeg", "png"]);
        }

        // Sorting
        const sortCol = sortBy === "name" ? "filename" : sortBy === "size" ? "file_size" : "year";
        q = q.order(sortCol, { ascending: sortOrder === "asc" });
        if (sortCol === "year") {
          q = q.order("month", { ascending: sortOrder === "asc", nullsFirst: false });
        }

        // Pagination
        q = q.range(newOffset, newOffset + PAGE_SIZE - 1);

        const { data, count, error } = await q;
        if (error) throw error;
        setResults((data as DocResult[]) || []);
        setTotal(count || 0);
      } catch (e: unknown) {
        setSearchError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setTotal(0);
      } finally {
        setSearching(false);
      }
    },
    [query, category, accountType, institution, format, yearFilter, holderFilter, sortBy, sortOrder]
  );

  // Auto-search when filters change
  useEffect(() => {
    doSearch(0);
  }, [doSearch]);

  const closeLightbox = () => {
    setLightbox({ open: false, index: 0 });
    if (lightboxBlob) URL.revokeObjectURL(lightboxBlob);
    setLightboxBlob(null);
  };

  const openFile = async (index: number) => {
    const f = results[index];
    if (!f) return;
    setLightbox({ open: true, index });
    setLightboxBlob(null);
    // For now, show metadata. R2 public URL support can be added later.
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

  const selectClass = "px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none focus:border-emerald-600";

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Financial &amp; Legal</h1>
        {totalDocs > 0 && (
          <span className="text-sm text-slate-400">
            {totalDocs.toLocaleString()} documents indexed
          </span>
        )}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
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

      {/* Search bar */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(0)}
          placeholder="Search documents..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-emerald-600"
        />
        <button
          onClick={() => doSearch(0)}
          className="px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg text-sm hover:bg-emerald-700 whitespace-nowrap"
        >
          Search
        </button>
      </div>

      {/* Filters row 1: Account Type, Institution, Account Holder */}
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <select value={accountType} onChange={(e) => setAccountType(e.target.value)} className={selectClass}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select value={institution} onChange={(e) => setInstitution(e.target.value)} className={selectClass}>
          {INSTITUTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select value={holderFilter} onChange={(e) => setHolderFilter(e.target.value)} className={selectClass}>
          {HOLDERS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Filters row 2: Format, Year, Sort */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <select value={format} onChange={(e) => setFormat(e.target.value)} className={selectClass}>
          {FORMATS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={selectClass}>
          {YEARS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={selectClass}>
          <option value="year">Date</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={selectClass}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        {(accountType || institution || format || yearFilter || holderFilter || category) && (
          <button
            onClick={() => {
              setCategory(""); setAccountType(""); setInstitution("");
              setFormat(""); setYearFilter(""); setHolderFilter("");
            }}
            className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          >
            Clear filters
          </button>
        )}
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

      {/* Results */}
      {!searching && !searchError && results.length > 0 && (
        <>
          <div className="text-sm text-slate-400 mb-3">
            {from}-{to} of {total.toLocaleString()} documents
          </div>

          <div className="mb-6">
            {results.map((f, i) => (
              <div
                key={f.id}
                onClick={() => openFile(i)}
                className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-lg mb-1.5 cursor-pointer hover:border-emerald-500 hover:shadow-sm transition-all"
              >
                <div className="text-2xl w-10 text-center flex-shrink-0">{fileIcon(f.file_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-slate-900">{f.filename}</div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">
                    {f.account_name}
                    {f.account_number ? ` (${f.account_number})` : ""}
                    {f.account_holder && f.account_holder !== "various" ? ` - ${f.account_holder}` : ""}
                  </div>
                </div>
                <span className="text-[0.65rem] font-semibold uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded flex-shrink-0">
                  {f.file_type || "?"}
                </span>
                {f.year && (
                  <div className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0 hidden sm:block">
                    {f.statement_date || f.year}
                  </div>
                )}
                <div className="text-[0.78rem] text-slate-600 whitespace-nowrap min-w-[60px] text-right flex-shrink-0">
                  {formatSize(f.file_size)}
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
      {!searching && !searchError && results.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83d\udcc2"}</div>
          <p className="text-lg mb-2">Financial &amp; Legal Documents</p>
          <p className="text-sm mb-4">
            {total === 0 && totalDocs === 0
              ? "No documents indexed yet. Upload documents to R2 to get started."
              : "No documents match your current filters."}
          </p>
        </div>
      )}

      {/* Document detail lightbox */}
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

          <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left">
            <div className="text-5xl text-center mb-4">{fileIcon(currentFile.file_type)}</div>
            <h3 className="text-lg font-semibold mb-4 break-all">{currentFile.filename}</h3>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Account</td><td>{currentFile.account_name}{currentFile.account_number ? ` (${currentFile.account_number})` : ""}</td></tr>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Institution</td><td className="capitalize">{currentFile.institution}</td></tr>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Account Type</td><td className="capitalize">{currentFile.account_type?.replace(/-/g, " ")}</td></tr>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Holder</td><td>{currentFile.account_holder}</td></tr>
                {currentFile.statement_date && (
                  <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Date</td><td>{currentFile.statement_date}</td></tr>
                )}
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Size</td><td>{formatSize(currentFile.file_size)}</td></tr>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Type</td><td>{(currentFile.file_type || "unknown").toUpperCase()}</td></tr>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Bucket</td><td>{currentFile.bucket}</td></tr>
                <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">R2 Key</td><td className="break-all text-xs">{currentFile.r2_key}</td></tr>
                {currentFile.is_closed && (
                  <tr><td className="text-slate-400 py-1 pr-3 whitespace-nowrap">Status</td><td className="text-amber-600">Closed Account</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="text-slate-400 text-sm mt-3 text-center max-w-[90vw] truncate">
            {currentFile.filename} &mdash; {formatSize(currentFile.file_size)}
          </div>
        </div>
      )}
    </div>
  );
}
