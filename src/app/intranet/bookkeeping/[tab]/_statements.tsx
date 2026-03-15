"use client";

import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

interface Statement {
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
}

interface AccountGroup {
  key: string;
  institution: string;
  accountName: string;
  accountNumber: string;
  accountHolder: string;
  accountType: string;
  isClosed: boolean;
  statements: Statement[];
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
  { value: "various", label: "Various" },
];

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
];

const HOLDERS = [
  { value: "", label: "All Holders" },
  { value: "Rahul", label: "Rahul" },
  { value: "Subhash", label: "Subhash" },
  { value: "Family", label: "Family" },
  { value: "Trust", label: "Trust" },
  { value: "Tesaloop", label: "Tesaloop" },
];

const YEARS = [
  { value: "", label: "All Years" },
  ...Array.from({ length: 8 }, (_, i) => {
    const y = 2026 - i;
    return { value: String(y), label: String(y) };
  }),
];

function institutionLabel(slug: string): string {
  const match = INSTITUTIONS.find((i) => i.value === slug);
  return match ? match.label : slug;
}

function accountTypeLabel(slug: string): string {
  const labels: Record<string, string> = {
    "credit-card": "Credit Card",
    checking: "Checking",
    payment: "Payment",
    brokerage: "Brokerage",
    ira: "IRA",
    trust: "Trust",
    crypto: "Crypto",
    mortgage: "Mortgage",
    heloc: "HELOC",
    "credit-line": "Credit Line",
    "auto-loan": "Auto Loan",
    "sba-loan": "SBA Loan",
  };
  return labels[slug] || slug;
}

function institutionLogo(slug: string): string {
  const logos: Record<string, string> = {
    amex: "\ud83d\udfe6",
    chase: "\ud83d\udfe6",
    "charles-schwab": "\ud83d\udfe6",
    "us-bank": "\ud83c\udfe6",
    robinhood: "\ud83d\udfe9",
    apple: "\u2b1b",
    "bank-of-america": "\ud83d\udfe5",
    pnc: "\ud83d\udfe7",
    coinbase: "\ud83d\udfe6",
    venmo: "\ud83d\udfe6",
    paypal: "\ud83d\udfe6",
    "cash-app": "\ud83d\udfe9",
    sba: "\ud83c\udfe6",
  };
  return logos[slug] || "\ud83c\udfe6";
}

function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export default function StatementsTab() {
  useAuth();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] = useState("");
  const [holderFilter, setHolderFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [detailStatement, setDetailStatement] = useState<Statement | null>(null);

  const fetchStatements = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let q = supabase
        .from("document_index")
        .select("*")
        .eq("category", "statement")
        .order("year", { ascending: false })
        .order("month", { ascending: false, nullsFirst: false });

      if (institution) q = q.eq("institution", institution);
      if (accountType) q = q.eq("account_type", accountType);
      if (holderFilter) q = q.eq("account_holder", holderFilter);
      if (yearFilter) q = q.eq("year", parseInt(yearFilter));

      const { data, error: err } = await q;
      if (err) throw err;
      setStatements((data as Statement[]) || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load statements");
      setStatements([]);
    } finally {
      setLoading(false);
    }
  }, [institution, accountType, holderFilter, yearFilter]);

  useEffect(() => {
    fetchStatements();
  }, [fetchStatements]);

  // Group statements by account
  const accountGroups: AccountGroup[] = (() => {
    const map = new Map<string, AccountGroup>();
    for (const s of statements) {
      const key = `${s.institution}|${s.account_name}|${s.account_number}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          institution: s.institution,
          accountName: s.account_name,
          accountNumber: s.account_number,
          accountHolder: s.account_holder,
          accountType: s.account_type,
          isClosed: s.is_closed,
          statements: [],
        });
      }
      map.get(key)!.statements.push(s);
    }
    // Sort groups: open accounts first, then by institution name
    return Array.from(map.values()).sort((a, b) => {
      if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
      const instA = institutionLabel(a.institution);
      const instB = institutionLabel(b.institution);
      if (instA !== instB) return instA.localeCompare(instB);
      return a.accountName.localeCompare(b.accountName);
    });
  })();

  const toggleAccount = (key: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedAccounts(new Set(accountGroups.map((g) => g.key)));
  };

  const collapseAll = () => {
    setExpandedAccounts(new Set());
  };

  const hasFilters = institution || accountType || holderFilter || yearFilter;

  const selectClass =
    "px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none focus:border-emerald-600";

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Statements</h1>
        {!loading && (
          <span className="text-sm text-slate-400">
            {statements.length.toLocaleString()} statements across{" "}
            {accountGroups.length} accounts
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <select
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          className={selectClass}
        >
          {INSTITUTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
          className={selectClass}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={holderFilter}
          onChange={(e) => setHolderFilter(e.target.value)}
          className={selectClass}
        >
          {HOLDERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className={selectClass}
        >
          {YEARS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setInstitution("");
              setAccountType("");
              setHolderFilter("");
              setYearFilter("");
            }}
            className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-16 text-slate-400">
          <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-3">&#9888;</div>
          <p>{error}</p>
        </div>
      )}

      {/* Account groups */}
      {!loading && !error && accountGroups.length > 0 && (
        <>
          {/* Expand/collapse controls */}
          <div className="flex gap-3 mb-4 text-sm">
            <button
              onClick={expandAll}
              className="text-emerald-600 hover:text-emerald-700"
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              className="text-slate-400 hover:text-slate-600"
            >
              Collapse all
            </button>
          </div>

          <div className="space-y-3">
            {accountGroups.map((group) => {
              const isExpanded = expandedAccounts.has(group.key);
              // Group statements by year for the expanded view
              const byYear = new Map<number, Statement[]>();
              for (const s of group.statements) {
                const yr = s.year || 0;
                if (!byYear.has(yr)) byYear.set(yr, []);
                byYear.get(yr)!.push(s);
              }
              const years = Array.from(byYear.keys()).sort((a, b) => b - a);

              return (
                <div
                  key={group.key}
                  className={`rounded-xl border ${
                    group.isClosed
                      ? "border-slate-200 bg-slate-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  {/* Account header */}
                  <button
                    onClick={() => toggleAccount(group.key)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 rounded-xl transition-colors"
                  >
                    <span className="text-2xl flex-shrink-0">
                      {institutionLogo(group.institution)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 truncate">
                          {group.accountName}
                        </span>
                        {group.accountNumber && (
                          <span className="text-xs text-slate-400 font-mono">
                            ****{group.accountNumber}
                          </span>
                        )}
                        {group.isClosed && (
                          <span className="text-[0.65rem] uppercase font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            Closed
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {institutionLabel(group.institution)}
                        {" \u00b7 "}
                        {accountTypeLabel(group.accountType)}
                        {group.accountHolder &&
                          group.accountHolder !== "various" &&
                          ` \u00b7 ${group.accountHolder}`}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {group.statements.length} stmt
                      {group.statements.length !== 1 ? "s" : ""}
                    </span>
                    <svg
                      className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {/* Expanded: statement list by year */}
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-0">
                      <div className="border-t border-slate-100 pt-3">
                        {years.map((yr) => (
                          <div key={yr} className="mb-3 last:mb-0">
                            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5 px-1">
                              {yr || "Unknown Year"}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                              {byYear.get(yr)!.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => setDetailStatement(s)}
                                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-emerald-50 hover:border-emerald-200 border border-transparent transition-colors text-left"
                                >
                                  <span className="text-lg flex-shrink-0">
                                    {s.file_type === "pdf" ? "\ud83d\udcc4" : "\ud83d\udcc3"}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-800">
                                      {s.month
                                        ? `${MONTH_NAMES[s.month]} ${yr}`
                                        : s.statement_date || s.filename}
                                    </div>
                                    <div className="text-[0.7rem] text-slate-400 truncate">
                                      {s.filename}
                                    </div>
                                  </div>
                                  <span className="text-[0.65rem] text-slate-400 flex-shrink-0">
                                    {formatSize(s.file_size)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !error && accountGroups.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83c\udfe6"}</div>
          <p className="text-lg mb-2">No Statements Found</p>
          <p className="text-sm">
            {hasFilters
              ? "No statements match your current filters."
              : "No statements indexed yet."}
          </p>
        </div>
      )}

      {/* Statement detail modal */}
      {detailStatement && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailStatement(null);
          }}
        >
          <button
            onClick={() => setDetailStatement(null)}
            className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[51]"
          >
            &times;
          </button>

          <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left">
            <div className="flex items-center gap-3 mb-5">
              <span className="text-4xl">
                {detailStatement.file_type === "pdf" ? "\ud83d\udcc4" : "\ud83d\udcc3"}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {detailStatement.month
                    ? `${MONTH_NAMES[detailStatement.month]} ${detailStatement.year} Statement`
                    : "Statement"}
                </h3>
                <p className="text-sm text-slate-500">
                  {detailStatement.account_name}
                </p>
              </div>
            </div>

            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Account
                  </td>
                  <td className="text-slate-700">
                    {detailStatement.account_name}
                    {detailStatement.account_number
                      ? ` (${detailStatement.account_number})`
                      : ""}
                  </td>
                </tr>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Institution
                  </td>
                  <td className="text-slate-700 capitalize">
                    {institutionLabel(detailStatement.institution)}
                  </td>
                </tr>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Type
                  </td>
                  <td className="text-slate-700">
                    {accountTypeLabel(detailStatement.account_type)}
                  </td>
                </tr>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Holder
                  </td>
                  <td className="text-slate-700">
                    {detailStatement.account_holder}
                  </td>
                </tr>
                {detailStatement.statement_date && (
                  <tr>
                    <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                      Statement Date
                    </td>
                    <td className="text-slate-700">
                      {detailStatement.statement_date}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Period
                  </td>
                  <td className="text-slate-700">
                    {detailStatement.month
                      ? `${MONTH_NAMES[detailStatement.month]} ${detailStatement.year}`
                      : detailStatement.year || "Unknown"}
                  </td>
                </tr>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    File
                  </td>
                  <td className="text-slate-700 break-all text-xs">
                    {detailStatement.filename}
                  </td>
                </tr>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Size
                  </td>
                  <td className="text-slate-700">
                    {formatSize(detailStatement.file_size)}
                  </td>
                </tr>
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                    Format
                  </td>
                  <td className="text-slate-700 uppercase">
                    {detailStatement.file_type}
                  </td>
                </tr>
                {detailStatement.is_closed && (
                  <tr>
                    <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                      Status
                    </td>
                    <td className="text-amber-600 font-medium">
                      Closed Account
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-400">
              <span className="font-medium">R2 Key:</span>{" "}
              <span className="break-all">{detailStatement.r2_key}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
