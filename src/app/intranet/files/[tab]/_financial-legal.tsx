"use client";

import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, PAGE_SIZE, fileIcon, formatSize } from "../_shared";

/** Map full names like "Rahul Sonnad" → first name "Rahul" */
function holderFirstName(holder: string | null | undefined): string {
  if (!holder || holder === "various") return "—";
  // Known entity names that should NOT be split
  const entities = new Set(["Family", "Trust", "Tesloop"]);
  if (entities.has(holder)) return holder;
  return holder.split(" ")[0];
}

/** Build public file URL from bucket + r2_key */
function fileUrl(bucket: string, r2Key: string): string {
  return `${API_BASE}/${bucket}/${r2Key}`;
}

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
  description: string | null;
  ai_metadata: Record<string, unknown> | null;
  extracted_text: string | null;
}

// Category chips — matches document_index.category values
const CATEGORIES = [
  { value: "", label: "All" },
  { value: "statement", label: "Statements" },
  { value: "tax", label: "Tax (Accounting)" },
  { value: "tax-personal", label: "Tax (Personal)" },
  { value: "legal", label: "Legal" },
  { value: "investment", label: "Investments" },
  { value: "insurance", label: "Insurance" },
  { value: "property-expense", label: "Property" },
  { value: "credit-report", label: "Credit Reports" },
  { value: "reference", label: "Reference" },
  { value: "other", label: "Other" },
];

// Account type filter
const ACCOUNT_TYPES = [
  { value: "", label: "All Account Types" },
  // Financial
  { value: "credit-card", label: "Credit Cards" },
  { value: "checking", label: "Checking" },
  { value: "payment", label: "Payment (Venmo, PayPal, Cash App)" },
  { value: "brokerage", label: "Brokerage" },
  { value: "ira", label: "IRA" },
  { value: "self-directed-ira", label: "Self-Directed IRA" },
  { value: "trust", label: "Trust" },
  { value: "crypto", label: "Crypto" },
  { value: "mortgage", label: "Mortgage" },
  { value: "heloc", label: "HELOC" },
  { value: "credit-line", label: "Credit Line" },
  { value: "auto-loan", label: "Auto Loan" },
  { value: "sba-loan", label: "SBA Loan" },
  // Tax
  { value: "tax", label: "Tax (Accounting)" },
  { value: "tax-return", label: "Tax Return" },
  { value: "w2", label: "W-2" },
  { value: "1099", label: "1099" },
  { value: "1098", label: "1098" },
  { value: "k1", label: "K-1" },
  { value: "paycheck", label: "Paycheck/Paystub" },
  { value: "franchise-tax", label: "Franchise Tax" },
  { value: "property-tax", label: "Property Tax" },
  // Legal
  { value: "power-of-attorney", label: "Power of Attorney" },
  { value: "will-and-poa", label: "Will & POA" },
  { value: "divorce", label: "Divorce" },
  { value: "property-deed", label: "Property Deed" },
  { value: "ein-registration", label: "EIN Registration" },
  { value: "business-formation", label: "Business Formation" },
  { value: "litigation", label: "Litigation" },
  // Investments
  { value: "private-investment", label: "Private Investment" },
  // Other
  { value: "insurance", label: "Insurance" },
  { value: "property", label: "Property" },
  { value: "education", label: "Education" },
  { value: "social-security", label: "Social Security" },
  { value: "vehicle-title", label: "Vehicle Title" },
  { value: "closed", label: "Closed Accounts" },
];

// Institution filter
const INSTITUTIONS = [
  { value: "", label: "All Institutions" },
  { value: "amex", label: "American Express" },
  { value: "apple", label: "Apple" },
  { value: "bank-of-america", label: "Bank of America" },
  { value: "cash-app", label: "Cash App" },
  { value: "charles-schwab", label: "Charles Schwab" },
  { value: "chase", label: "Chase" },
  { value: "coinbase", label: "Coinbase" },
  { value: "decentrane", label: "Decentrane" },
  { value: "dmv", label: "DMV" },
  { value: "fidelity", label: "Fidelity" },
  { value: "irs", label: "IRS" },
  { value: "madison-trust", label: "Madison Trust" },
  { value: "paypal", label: "PayPal" },
  { value: "peak-advisors", label: "Peak Advisors" },
  { value: "pnc", label: "PNC" },
  { value: "robinhood", label: "Robinhood" },
  { value: "sba", label: "SBA" },
  { value: "snohomish-county", label: "Snohomish County" },
  { value: "ssa", label: "Social Security Admin" },
  { value: "swan", label: "SWAN" },
  { value: "texas", label: "Texas (State)" },
  { value: "us-bank", label: "US Bank" },
  { value: "venmo", label: "Venmo" },
  { value: "venturables", label: "Venturables LLC" },
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

// Year filter — generate dynamically (2026 back to 2013 for tax history)
const YEARS = [
  { value: "", label: "All Years" },
  ...Array.from({ length: 14 }, (_, i) => {
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
  { value: "Tesloop", label: "Tesloop" },
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [totalDocs, setTotalDocs] = useState(0);
  const [lightbox, setLightbox] = useState<{ open: boolean; index: number }>({ open: false, index: 0 });
  const [lightboxBlob, setLightboxBlob] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
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
          .select("id,bucket,r2_key,filename,file_type,file_size,category,account_type,institution,account_name,account_number,account_holder,year,month,statement_date,is_closed,property,original_path,description,ai_metadata,extracted_text", { count: "exact" });

        // Text search — each term must appear in the filename (AND).
        // Escape %/_ in user terms so they're treated as literals.
        if (query.trim()) {
          const terms = query.trim().split(/\s+/);
          for (const term of terms) {
            const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
            q = q.ilike("filename", `%${escaped}%`);
          }
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
        const sortColMap: Record<string, string> = {
          name: "filename", size: "file_size", year: "year",
          institution: "institution", account_type: "account_type",
          category: "category", account_holder: "account_holder", format: "file_type",
        };
        const sortCol = sortColMap[sortBy] || "year";
        if (sortCol === "year") {
          // Sort by statement_date first (most precise), then year/month as fallback
          q = q.order("statement_date", { ascending: sortOrder === "asc", nullsFirst: sortOrder === "asc" });
          q = q.order("year", { ascending: sortOrder === "asc", nullsFirst: sortOrder === "asc" });
          q = q.order("month", { ascending: sortOrder === "asc", nullsFirst: sortOrder === "asc" });
        } else {
          q = q.order(sortCol, { ascending: sortOrder === "asc" });
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
    setShowText(false);
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
    <div className="max-w-[1400px] mx-auto">
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

      {/* Filters row 2: Format, Year */}
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

          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("account_holder"); setSortOrder(sortBy === "account_holder" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    Holder {sortBy === "account_holder" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("institution"); setSortOrder(sortBy === "institution" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    Institution {sortBy === "institution" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("account_type"); setSortOrder(sortBy === "account_type" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    Acct Type {sortBy === "account_type" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("category"); setSortOrder(sortBy === "category" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    File Type {sortBy === "category" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("name"); setSortOrder(sortBy === "name" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    File Name {sortBy === "name" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("year"); setSortOrder(sortBy === "year" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    Date {sortBy === "year" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("format"); setSortOrder(sortBy === "format" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    Format {sortBy === "format" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right cursor-pointer hover:text-emerald-600" onClick={() => { setSortBy("size"); setSortOrder(sortBy === "size" && sortOrder === "asc" ? "desc" : "asc"); }}>
                    Size {sortBy === "size" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-center w-10"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((f, i) => (
                  <tr
                    key={f.id}
                    onClick={() => openFile(i)}
                    className="border-b border-slate-100 cursor-pointer hover:bg-emerald-50/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{holderFirstName(f.account_holder)}</td>
                    <td className="py-2.5 px-3 capitalize text-slate-700 whitespace-nowrap">{f.institution?.replace(/-/g, " ") || "—"}</td>
                    <td className="py-2.5 px-3 capitalize text-slate-600 whitespace-nowrap">{f.account_type?.replace(/-/g, " ") || "—"}</td>
                    <td className="py-2.5 px-3 capitalize text-slate-600 whitespace-nowrap">{f.category?.replace(/-/g, " ") || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-900 max-w-[300px] relative group/tip">
                      <div className="truncate font-medium">{f.filename}</div>
                      <div className="text-xs text-slate-400 truncate">
                        {f.account_name}{f.account_number ? ` (${f.account_number})` : ""}
                      </div>
                      {f.description && (
                        <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[90vw] rounded-lg bg-slate-800 text-white text-xs leading-relaxed px-3 py-2 shadow-lg opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity duration-150">
                          {f.description}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                      {(() => {
                        if (f.statement_date) return f.statement_date;
                        if (f.year && f.month) return `${f.year}-${String(f.month).padStart(2, "0")}`;
                        // Extract date from filename patterns
                        const mmYYYY = f.filename?.match(/^(\d{2})-(\d{4})\./);
                        if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}`;
                        const yyyyMM = f.filename?.match(/^(\d{4})-(\d{2})\./);
                        if (yyyyMM) return `${yyyyMM[1]}-${yyyyMM[2]}`;
                        // "...January 2026..." or "...March 2025..."
                        const monthNames: Record<string, string> = { january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12" };
                        const nameMatch = f.filename?.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
                        if (nameMatch) return `${nameMatch[2]}-${monthNames[nameMatch[1].toLowerCase()]}`;
                        return f.year || "—";
                      })()}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-[0.65rem] font-semibold uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                        {f.file_type || "?"}
                      </span>
                      {f.extracted_text && (
                        <span className="text-[0.6rem] font-semibold uppercase bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded ml-1" title="Extracted text available">
                          TXT
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 text-right whitespace-nowrap">{formatSize(f.file_size)}</td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        title={copiedId === f.id ? "Copied!" : "Copy share link"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = fileUrl(f.bucket, f.r2_key);
                          navigator.clipboard.writeText(url);
                          setCopiedId(f.id);
                          setTimeout(() => setCopiedId((prev) => prev === f.id ? null : prev), 1500);
                        }}
                        className={`transition-colors ${copiedId === f.id ? "text-emerald-500" : "text-slate-400 hover:text-emerald-600"}`}
                      >
                        {copiedId === f.id ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

          <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left text-slate-900 max-h-[85vh] overflow-y-auto">
            <a
              href={fileUrl(currentFile.bucket, currentFile.r2_key)}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-5xl text-center mb-4 hover:opacity-70 transition-opacity cursor-pointer"
              title="Open file"
            >
              {fileIcon(currentFile.file_type)}
              <div className="text-xs text-emerald-600 mt-1 font-medium">Open file &#x2197;</div>
            </a>
            <h3 className="text-lg font-semibold mb-2 break-all">{currentFile.filename}</h3>
            {currentFile.description && (
              <p className="text-sm text-slate-500 mb-4 italic">{currentFile.description}</p>
            )}
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Category</td><td className="capitalize">{currentFile.category?.replace(/-/g, " ")}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Account</td><td>{currentFile.account_name}{currentFile.account_number ? ` (${currentFile.account_number})` : ""}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Institution</td><td className="capitalize">{currentFile.institution}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Account Type</td><td className="capitalize">{currentFile.account_type?.replace(/-/g, " ")}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Holder</td><td>{holderFirstName(currentFile.account_holder)}</td></tr>
                {currentFile.statement_date && (
                  <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Date</td><td>{currentFile.statement_date}</td></tr>
                )}
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Size</td><td>{formatSize(currentFile.file_size)}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Type</td><td>{(currentFile.file_type || "unknown").toUpperCase()}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Bucket</td><td>{currentFile.bucket}</td></tr>
                <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">R2 Key</td><td className="break-all text-xs">{currentFile.r2_key}</td></tr>
                {currentFile.is_closed && (
                  <tr><td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Status</td><td className="text-amber-600">Closed Account</td></tr>
                )}
                {currentFile.extracted_text && (
                  <tr>
                    <td className="text-slate-500 py-1 pr-3 whitespace-nowrap">Text</td>
                    <td>
                      <button
                        onClick={() => setShowText(!showText)}
                        className="text-emerald-600 hover:text-emerald-700 font-medium text-sm"
                      >
                        {showText ? "Hide text" : `View extracted text (${(currentFile.extracted_text.length / 1000).toFixed(1)}k chars)`}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Extracted text panel */}
            {showText && currentFile.extracted_text && (
              <div className="mt-4 border border-slate-200 rounded-lg">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-t-lg">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Extracted Text</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentFile.extracted_text!);
                    }}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    Copy all
                  </button>
                </div>
                <pre className="p-3 text-xs text-slate-700 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto font-sans leading-relaxed">
                  {currentFile.extracted_text}
                </pre>
              </div>
            )}
          </div>

          <div className="text-slate-400 text-sm mt-3 text-center max-w-[90vw] truncate">
            {currentFile.filename} &mdash; {formatSize(currentFile.file_size)}
          </div>
        </div>
      )}
    </div>
  );
}
