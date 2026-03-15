"use client";

import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────

interface CcSummary {
  id: string;
  document_id: string;
  institution: string;
  account_name: string;
  account_number: string;
  account_holder: string;
  statement_date: string;
  period_start: string | null;
  period_end: string | null;
  previous_balance: number | null;
  payments_credits: number | null;
  new_charges: number | null;
  fees: number | null;
  interest_charged: number | null;
  new_balance: number | null;
  minimum_due: number | null;
  payment_due_date: string | null;
  credit_limit: number | null;
  available_credit: number | null;
}

interface CcTransaction {
  id: string;
  summary_id: string;
  institution: string;
  account_name: string;
  statement_date: string;
  transaction_date: string;
  posting_date: string | null;
  description: string;
  amount: number;
  reference_number: string | null;
  category: string | null;
  daily_cash: number | null;
  foreign_spend_amount: number | null;
  foreign_spend_currency: string | null;
}

interface CheckingSummary {
  id: string;
  document_id: string;
  institution: string;
  account_name: string;
  account_number: string;
  account_holder: string;
  statement_date: string;
  period_start: string | null;
  period_end: string | null;
  beginning_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  fees: number | null;
  interest_earned: number | null;
  ending_balance: number | null;
}

interface CheckingTransaction {
  id: string;
  summary_id: string;
  institution: string;
  account_name: string;
  statement_date: string;
  transaction_date: string;
  description: string;
  amount: number;
  running_balance: number | null;
  check_number: string | null;
  transaction_type: string | null;
  ref_number: string | null;
}

interface InvestmentSummary {
  id: string;
  document_id: string;
  institution: string;
  account_name: string;
  account_number: string;
  account_holder: string;
  statement_date: string;
  period_start: string | null;
  period_end: string | null;
  starting_value: number | null;
  ending_value: number | null;
  total_change_dollars: number | null;
  total_change_pct: number | null;
  dividends: number | null;
  interest_earned: number | null;
}

interface InvestmentTransaction {
  id: string;
  summary_id: string;
  institution: string;
  account_name: string;
  statement_date: string;
  trade_date: string;
  description: string;
  transaction_type: string | null;
  security_name: string | null;
  ticker_symbol: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
}

interface LoanSummary {
  id: string;
  document_id: string;
  institution: string;
  account_name: string;
  account_number: string;
  account_holder: string;
  loan_type: string;
  statement_date: string;
  period_start: string | null;
  period_end: string | null;
  principal_balance: number | null;
  interest_rate: number | null;
  total_payment_due: number | null;
  payment_due_date: string | null;
  escrow_balance: number | null;
}

interface LoanTransaction {
  id: string;
  summary_id: string;
  institution: string;
  account_name: string;
  statement_date: string;
  transaction_date: string;
  description: string;
  amount: number;
  principal_amount: number | null;
  interest_amount: number | null;
  transaction_type: string | null;
}

type StatementSummary =
  | (CcSummary & { type: "cc" })
  | (CheckingSummary & { type: "checking" })
  | (InvestmentSummary & { type: "investment" })
  | (LoanSummary & { type: "loan" });

type Transaction =
  | (CcTransaction & { type: "cc" })
  | (CheckingTransaction & { type: "checking" })
  | (InvestmentTransaction & { type: "investment" })
  | (LoanTransaction & { type: "loan" });

// ── Constants ────────────────────────────────────────────────────────────

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
  { value: "brokerage", label: "Brokerage" },
  { value: "ira", label: "IRA" },
  { value: "crypto", label: "Crypto" },
  { value: "heloc", label: "HELOC" },
  { value: "auto-loan", label: "Auto Loan" },
  { value: "mortgage", label: "Mortgage" },
  { value: "credit-line", label: "Credit Line" },
  { value: "loan", label: "All Loans" },
  { value: "investment", label: "All Investments" },
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
  return INSTITUTIONS.find((i) => i.value === slug)?.label || slug;
}

function institutionLogo(slug: string): string {
  const logos: Record<string, string> = {
    amex: "\ud83d\udfe6", chase: "\ud83d\udfe6", "charles-schwab": "\ud83d\udfe6",
    "us-bank": "\ud83c\udfe6", robinhood: "\ud83d\udfe9", apple: "\u2b1b",
    "bank-of-america": "\ud83d\udfe5", pnc: "\ud83d\udfe7", coinbase: "\ud83d\udfe6",
    venmo: "\ud83d\udfe6", paypal: "\ud83d\udfe6", "cash-app": "\ud83d\udfe9", sba: "\ud83c\udfe6",
  };
  return logos[slug] || "\ud83c\udfe6";
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(d: string | null): string {
  if (!d) return "--";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtShortDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Helpers to normalize across types ────────────────────────────────────

function txnDate(t: Transaction): string {
  if (t.type === "investment") return t.trade_date || t.statement_date;
  return t.transaction_date;
}

function txnAmount(t: Transaction): number {
  if (t.type === "investment") return t.total_amount || 0;
  return t.amount;
}

// ── Views ────────────────────────────────────────────────────────────────

type ViewMode = "accounts" | "transactions";

// ── Component ────────────────────────────────────────────────────────────

export default function StatementsTab() {
  useAuth();
  const [view, setView] = useState<ViewMode>("accounts");
  const [summaries, setSummaries] = useState<StatementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] = useState("");
  const [holderFilter, setHolderFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [selectedSummary, setSelectedSummary] = useState<StatementSummary | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnSearch, setTxnSearch] = useState("");
  const [txnSort, setTxnSort] = useState<{ col: string; asc: boolean }>({ col: "transaction_date", asc: false });

  // ── Fetch summaries ──────────────────────────────────────────────────
  const fetchSummaries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const results: StatementSummary[] = [];

      // Fetch CC summaries
      if (!accountType || accountType === "credit-card") {
        let q = supabase.from("cc_statement_summaries").select("*").order("statement_date", { ascending: false });
        if (institution) q = q.eq("institution", institution);
        if (holderFilter) q = q.eq("account_holder", holderFilter);
        if (yearFilter) q = q.gte("statement_date", `${yearFilter}-01-01`).lte("statement_date", `${yearFilter}-12-31`);
        const { data, error: err } = await q;
        if (err) throw err;
        (data || []).forEach((d) => results.push({ ...d, type: "cc" } as CcSummary & { type: "cc" }));
      }

      // Fetch checking summaries
      if (!accountType || accountType === "checking") {
        let q = supabase.from("checking_statement_summaries").select("*").order("statement_date", { ascending: false });
        if (institution) q = q.eq("institution", institution);
        if (holderFilter) q = q.eq("account_holder", holderFilter);
        if (yearFilter) q = q.gte("statement_date", `${yearFilter}-01-01`).lte("statement_date", `${yearFilter}-12-31`);
        const { data, error: err } = await q;
        if (err) throw err;
        (data || []).forEach((d) => results.push({ ...d, type: "checking" } as CheckingSummary & { type: "checking" }));
      }

      // Fetch investment summaries
      if (!accountType || ["brokerage", "ira", "crypto", "investment"].includes(accountType)) {
        let q = supabase.from("investment_statement_summaries").select("*").order("statement_date", { ascending: false });
        if (institution) q = q.eq("institution", institution);
        if (holderFilter) q = q.eq("account_holder", holderFilter);
        if (yearFilter) q = q.gte("statement_date", `${yearFilter}-01-01`).lte("statement_date", `${yearFilter}-12-31`);
        const { data, error: err } = await q;
        if (err) throw err;
        (data || []).forEach((d) => results.push({ ...d, type: "investment" } as InvestmentSummary & { type: "investment" }));
      }

      // Fetch loan summaries
      if (!accountType || ["heloc", "auto-loan", "mortgage", "credit-line", "loan"].includes(accountType)) {
        let q = supabase.from("loan_statement_summaries").select("*").order("statement_date", { ascending: false });
        if (institution) q = q.eq("institution", institution);
        if (holderFilter) q = q.eq("account_holder", holderFilter);
        if (yearFilter) q = q.gte("statement_date", `${yearFilter}-01-01`).lte("statement_date", `${yearFilter}-12-31`);
        if (accountType && accountType !== "loan") q = q.eq("loan_type", accountType);
        const { data, error: err } = await q;
        if (err) throw err;
        (data || []).forEach((d) => results.push({ ...d, type: "loan" } as LoanSummary & { type: "loan" }));
      }

      // Sort by date descending
      results.sort((a, b) => (b.statement_date || "").localeCompare(a.statement_date || ""));
      setSummaries(results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load statements");
    } finally {
      setLoading(false);
    }
  }, [institution, accountType, holderFilter, yearFilter]);

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  // ── Fetch transactions for a summary ─────────────────────────────────
  const fetchTransactions = useCallback(async (summary: StatementSummary) => {
    setTxnLoading(true);
    setTxns([]);
    try {
      if (summary.type === "cc") {
        const { data } = await supabase.from("cc_transactions").select("*").eq("summary_id", summary.id).order("transaction_date", { ascending: true });
        setTxns((data || []).map((t) => ({ ...t, type: "cc" } as CcTransaction & { type: "cc" })));
      } else if (summary.type === "checking") {
        const { data } = await supabase.from("checking_transactions").select("*").eq("summary_id", summary.id).order("transaction_date", { ascending: true });
        setTxns((data || []).map((t) => ({ ...t, type: "checking" } as CheckingTransaction & { type: "checking" })));
      } else if (summary.type === "investment") {
        const { data } = await supabase.from("investment_transactions").select("*").eq("summary_id", summary.id).order("trade_date", { ascending: true });
        setTxns((data || []).map((t) => ({ ...t, type: "investment" } as InvestmentTransaction & { type: "investment" })));
      } else if (summary.type === "loan") {
        const { data } = await supabase.from("loan_transactions").select("*").eq("summary_id", summary.id).order("transaction_date", { ascending: true });
        setTxns((data || []).map((t) => ({ ...t, type: "loan" } as LoanTransaction & { type: "loan" })));
      }
    } finally {
      setTxnLoading(false);
    }
  }, []);

  // ── Fetch ALL transactions for "Transactions" view ───────────────────
  const [allTxns, setAllTxns] = useState<Transaction[]>([]);
  const [allTxnLoading, setAllTxnLoading] = useState(false);

  const fetchAllTransactions = useCallback(async () => {
    setAllTxnLoading(true);
    try {
      const results: Transaction[] = [];

      if (!accountType || accountType === "credit-card") {
        let q = supabase.from("cc_transactions").select("*").order("transaction_date", { ascending: false }).limit(2000);
        if (institution) q = q.eq("institution", institution);
        if (yearFilter) q = q.gte("transaction_date", `${yearFilter}-01-01`).lte("transaction_date", `${yearFilter}-12-31`);
        const { data } = await q;
        (data || []).forEach((t) => results.push({ ...t, type: "cc" } as CcTransaction & { type: "cc" }));
      }

      if (!accountType || accountType === "checking") {
        let q = supabase.from("checking_transactions").select("*").order("transaction_date", { ascending: false }).limit(2000);
        if (institution) q = q.eq("institution", institution);
        if (yearFilter) q = q.gte("transaction_date", `${yearFilter}-01-01`).lte("transaction_date", `${yearFilter}-12-31`);
        const { data } = await q;
        (data || []).forEach((t) => results.push({ ...t, type: "checking" } as CheckingTransaction & { type: "checking" }));
      }

      results.sort((a, b) => (txnDate(b)).localeCompare(txnDate(a)));
      setAllTxns(results);
    } finally {
      setAllTxnLoading(false);
    }
  }, [institution, accountType, yearFilter]);

  useEffect(() => {
    if (view === "transactions") fetchAllTransactions();
  }, [view, fetchAllTransactions]);

  // ── Group summaries by account ───────────────────────────────────────
  const accountGroups = (() => {
    const map = new Map<string, { institution: string; accountName: string; accountNumber: string; accountHolder: string; accountType: string; summaries: StatementSummary[] }>();
    for (const s of summaries) {
      const key = `${s.institution}|${s.account_name}`;
      if (!map.has(key)) {
        const atLabel = s.type === "cc" ? "Credit Card" : s.type === "checking" ? "Checking" : s.type === "investment" ? "Investment" : "Loan";
        map.set(key, { institution: s.institution, accountName: s.account_name, accountNumber: s.account_number || "", accountHolder: s.account_holder || "", accountType: atLabel, summaries: [] });
      }
      map.get(key)!.summaries.push(s);
    }
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      const iA = institutionLabel(a.institution), iB = institutionLabel(b.institution);
      if (iA !== iB) return iA.localeCompare(iB);
      return a.accountName.localeCompare(b.accountName);
    });
  })();

  // ── Totals ───────────────────────────────────────────────────────────
  const ccSummaries = summaries.filter((s) => s.type === "cc") as (CcSummary & { type: "cc" })[];
  const chkSummaries = summaries.filter((s) => s.type === "checking") as (CheckingSummary & { type: "checking" })[];

  // ── Filtered txns for "Transactions" view ────────────────────────────
  const filteredAllTxns = (() => {
    let list = allTxns;
    if (txnSearch) {
      const q = txnSearch.toLowerCase();
      list = list.filter((t) => t.description.toLowerCase().includes(q) || (t.type === "cc" && t.category?.toLowerCase().includes(q)));
    }
    // Sort
    list = [...list].sort((a, b) => {
      const col = txnSort.col;
      let va: string | number = "", vb: string | number = "";
      if (col === "transaction_date") { va = txnDate(a); vb = txnDate(b); }
      else if (col === "description") { va = a.description; vb = b.description; }
      else if (col === "amount") { va = txnAmount(a); vb = txnAmount(b); }
      else if (col === "account") { va = a.account_name; vb = b.account_name; }
      if (typeof va === "string") return txnSort.asc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return txnSort.asc ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  })();

  const toggleSort = (col: string) => {
    setTxnSort((prev) => prev.col === col ? { col, asc: !prev.asc } : { col, asc: col === "description" || col === "account" });
  };

  const sortIcon = (col: string) => txnSort.col === col ? (txnSort.asc ? " \u25b2" : " \u25bc") : "";

  const toggleAccount = (key: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasFilters = institution || accountType || holderFilter || yearFilter;
  const selectClass = "px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none focus:border-emerald-600";

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Statements</h1>
        {!loading && (
          <span className="text-sm text-slate-400">
            {summaries.length} statements across {accountGroups.length} accounts
          </span>
        )}
      </div>

      {/* View toggle */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
        {(["accounts", "transactions"] as ViewMode[]).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {v === "accounts" ? "By Account" : "All Transactions"}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <select value={institution} onChange={(e) => setInstitution(e.target.value)} className={selectClass}>
          {INSTITUTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={accountType} onChange={(e) => setAccountType(e.target.value)} className={selectClass}>
          {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={holderFilter} onChange={(e) => setHolderFilter(e.target.value)} className={selectClass}>
          {HOLDERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={selectClass}>
          {YEARS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => { setInstitution(""); setAccountType(""); setHolderFilter(""); setYearFilter(""); }}
            className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
            Clear filters
          </button>
        )}
      </div>

      {/* Summary cards */}
      {!loading && summaries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-xs text-slate-400 mb-1">Total Statements</div>
            <div className="text-xl font-bold text-slate-900">{summaries.length}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-xs text-slate-400 mb-1">Accounts</div>
            <div className="text-xl font-bold text-slate-900">{accountGroups.length}</div>
          </div>
          {ccSummaries.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-xs text-slate-400 mb-1">CC Statements</div>
              <div className="text-xl font-bold text-slate-900">{ccSummaries.length}</div>
            </div>
          )}
          {chkSummaries.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-xs text-slate-400 mb-1">Checking Statements</div>
              <div className="text-xl font-bold text-slate-900">{chkSummaries.length}</div>
            </div>
          )}
        </div>
      )}

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

      {/* ══════════════ ACCOUNTS VIEW ══════════════ */}
      {!loading && !error && view === "accounts" && accountGroups.length > 0 && (
        <>
          <div className="flex gap-3 mb-4 text-sm">
            <button onClick={() => setExpandedAccounts(new Set(accountGroups.map(([k]) => k)))}
              className="text-emerald-600 hover:text-emerald-700">Expand all</button>
            <button onClick={() => setExpandedAccounts(new Set())}
              className="text-slate-400 hover:text-slate-600">Collapse all</button>
          </div>

          <div className="space-y-3">
            {accountGroups.map(([key, group]) => {
              const isExpanded = expandedAccounts.has(key);
              return (
                <div key={key} className="rounded-xl border border-slate-200 bg-white">
                  {/* Account header */}
                  <button onClick={() => toggleAccount(key)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 rounded-xl transition-colors">
                    <span className="text-2xl flex-shrink-0">{institutionLogo(group.institution)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 truncate">{group.accountName}</span>
                        {group.accountNumber && <span className="text-xs text-slate-400 font-mono">****{group.accountNumber}</span>}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {institutionLabel(group.institution)} &middot; {group.accountType}
                        {group.accountHolder && group.accountHolder !== "various" && ` \u00b7 ${group.accountHolder}`}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {group.summaries.length} stmt{group.summaries.length !== 1 ? "s" : ""}
                    </span>
                    <svg className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded: statement cards */}
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-0">
                      <div className="border-t border-slate-100 pt-3 space-y-2">
                        {group.summaries.map((s) => (
                          <button key={s.id} onClick={() => { setSelectedSummary(s); fetchTransactions(s); }}
                            className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-emerald-50 hover:border-emerald-200 border border-slate-100 transition-colors text-left">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-800">{fmtDate(s.statement_date)}</div>
                              {s.period_start && s.period_end && (
                                <div className="text-[0.7rem] text-slate-400">{fmtShortDate(s.period_start)} - {fmtShortDate(s.period_end)}</div>
                              )}
                            </div>
                            {s.type === "cc" ? (
                              <div className="flex gap-5 text-xs text-right">
                                <div><div className="text-slate-400">New Charges</div><div className="font-medium text-slate-700">{fmtMoney(s.new_charges)}</div></div>
                                <div><div className="text-slate-400">Balance</div><div className="font-semibold text-slate-900">{fmtMoney(s.new_balance)}</div></div>
                              </div>
                            ) : s.type === "checking" ? (
                              <div className="flex gap-5 text-xs text-right">
                                <div><div className="text-slate-400">Deposits</div><div className="font-medium text-emerald-600">{fmtMoney(s.total_deposits)}</div></div>
                                <div><div className="text-slate-400">Balance</div><div className="font-semibold text-slate-900">{fmtMoney(s.ending_balance)}</div></div>
                              </div>
                            ) : s.type === "investment" ? (
                              <div className="flex gap-5 text-xs text-right">
                                <div><div className="text-slate-400">Change</div><div className={`font-medium ${(s.total_change_dollars ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtMoney(s.total_change_dollars)}</div></div>
                                <div><div className="text-slate-400">Value</div><div className="font-semibold text-slate-900">{fmtMoney(s.ending_value)}</div></div>
                              </div>
                            ) : s.type === "loan" ? (
                              <div className="flex gap-5 text-xs text-right">
                                <div><div className="text-slate-400">Payment</div><div className="font-medium text-slate-700">{fmtMoney(s.total_payment_due)}</div></div>
                                <div><div className="text-slate-400">Principal</div><div className="font-semibold text-slate-900">{fmtMoney(s.principal_balance)}</div></div>
                              </div>
                            ) : null}
                            <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
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

      {/* ══════════════ TRANSACTIONS VIEW ══════════════ */}
      {!loading && !error && view === "transactions" && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <input type="text" placeholder="Search transactions..." value={txnSearch} onChange={(e) => setTxnSearch(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none focus:border-emerald-600 w-64" />
            <span className="text-xs text-slate-400">{filteredAllTxns.length.toLocaleString()} transactions</span>
            {allTxnLoading && <div className="inline-block w-4 h-4 border-2 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500 cursor-pointer select-none" onClick={() => toggleSort("transaction_date")}>
                    Date{sortIcon("transaction_date")}
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500 cursor-pointer select-none" onClick={() => toggleSort("description")}>
                    Description{sortIcon("description")}
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500 cursor-pointer select-none" onClick={() => toggleSort("account")}>
                    Account{sortIcon("account")}
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500 cursor-pointer select-none" onClick={() => toggleSort("amount")}>
                    Amount{sortIcon("amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAllTxns.slice(0, 500).map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtShortDate(txnDate(t))}</td>
                    <td className="px-4 py-2 text-slate-800 max-w-[300px] truncate">
                      {t.description}
                      {t.type === "cc" && t.category && (
                        <span className="ml-2 text-[0.65rem] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{t.category}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                      {institutionLabel(t.institution)} &middot; {t.account_name}
                    </td>
                    <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${txnAmount(t) < 0 ? "text-emerald-600" : "text-slate-800"}`}>
                      {fmtMoney(txnAmount(t))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAllTxns.length > 500 && (
              <div className="text-center py-3 text-xs text-slate-400 bg-slate-50">
                Showing first 500 of {filteredAllTxns.length.toLocaleString()} transactions. Use filters to narrow results.
              </div>
            )}
            {filteredAllTxns.length === 0 && !allTxnLoading && (
              <div className="text-center py-12 text-slate-400">
                <div className="text-3xl mb-2">&#128269;</div>
                <p>No transactions found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && summaries.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83c\udfe6"}</div>
          <p className="text-lg mb-2">No Statement Data Yet</p>
          <p className="text-sm">
            {hasFilters
              ? "No statements match your current filters."
              : "Run the ingestion script to parse statement PDFs into transaction data."}
          </p>
        </div>
      )}

      {/* ══════════════ STATEMENT DETAIL MODAL ══════════════ */}
      {selectedSummary && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) { setSelectedSummary(null); setTxns([]); } }}>
          <button onClick={() => { setSelectedSummary(null); setTxns([]); }}
            className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[51]">
            &times;
          </button>

          <div className="bg-white rounded-xl max-w-[800px] w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
            {/* Summary header */}
            <div className="px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">{institutionLogo(selectedSummary.institution)}</span>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{selectedSummary.account_name}</h3>
                  <p className="text-sm text-slate-500">
                    {institutionLabel(selectedSummary.institution)} &middot; {fmtDate(selectedSummary.statement_date)}
                    {selectedSummary.period_start && selectedSummary.period_end &&
                      ` (${fmtShortDate(selectedSummary.period_start)} - ${fmtShortDate(selectedSummary.period_end)})`}
                  </p>
                </div>
              </div>

              {/* Summary amounts */}
              {selectedSummary.type === "cc" ? (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {[
                    { label: "Previous Balance", value: fmtMoney(selectedSummary.previous_balance) },
                    { label: "Payments/Credits", value: fmtMoney(selectedSummary.payments_credits), color: "text-emerald-600" },
                    { label: "New Charges", value: fmtMoney(selectedSummary.new_charges) },
                    { label: "Fees", value: fmtMoney(selectedSummary.fees) },
                    { label: "Interest", value: fmtMoney(selectedSummary.interest_charged) },
                    { label: "New Balance", value: fmtMoney(selectedSummary.new_balance), bold: true },
                    { label: "Minimum Due", value: fmtMoney(selectedSummary.minimum_due) },
                    { label: "Due Date", value: fmtDate(selectedSummary.payment_due_date) },
                    { label: "Credit Limit", value: fmtMoney(selectedSummary.credit_limit) },
                    { label: "Available", value: fmtMoney(selectedSummary.available_credit), color: "text-emerald-600" },
                  ].map((item, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[0.65rem] text-slate-400 uppercase">{item.label}</div>
                      <div className={`text-sm ${item.bold ? "font-bold text-slate-900" : item.color || "text-slate-700"}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : selectedSummary.type === "checking" ? (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {[
                    { label: "Beginning", value: fmtMoney(selectedSummary.beginning_balance) },
                    { label: "Deposits", value: fmtMoney(selectedSummary.total_deposits), color: "text-emerald-600" },
                    { label: "Withdrawals", value: fmtMoney(selectedSummary.total_withdrawals), color: "text-red-500" },
                    { label: "Fees", value: fmtMoney(selectedSummary.fees) },
                    { label: "Interest", value: fmtMoney(selectedSummary.interest_earned), color: "text-emerald-600" },
                    { label: "Ending", value: fmtMoney(selectedSummary.ending_balance), bold: true },
                  ].map((item, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[0.65rem] text-slate-400 uppercase">{item.label}</div>
                      <div className={`text-sm ${item.bold ? "font-bold text-slate-900" : item.color || "text-slate-700"}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : selectedSummary.type === "investment" ? (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {[
                    { label: "Starting Value", value: fmtMoney(selectedSummary.starting_value) },
                    { label: "Ending Value", value: fmtMoney(selectedSummary.ending_value), bold: true },
                    { label: "Change", value: fmtMoney(selectedSummary.total_change_dollars), color: (selectedSummary.total_change_dollars ?? 0) >= 0 ? "text-emerald-600" : "text-red-500" },
                    { label: "Dividends", value: fmtMoney(selectedSummary.dividends) },
                    { label: "Interest", value: fmtMoney(selectedSummary.interest_earned) },
                  ].map((item, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[0.65rem] text-slate-400 uppercase">{item.label}</div>
                      <div className={`text-sm ${item.bold ? "font-bold text-slate-900" : item.color || "text-slate-700"}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : selectedSummary.type === "loan" ? (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {([
                    { label: "Principal", value: fmtMoney(selectedSummary.principal_balance), bold: true, color: "" },
                    { label: "Rate", value: selectedSummary.interest_rate != null ? `${selectedSummary.interest_rate}%` : "--", bold: false, color: "" },
                    { label: "Payment Due", value: fmtMoney(selectedSummary.total_payment_due), bold: false, color: "" },
                    { label: "Due Date", value: fmtDate(selectedSummary.payment_due_date), bold: false, color: "" },
                    { label: "Escrow", value: fmtMoney(selectedSummary.escrow_balance), bold: false, color: "" },
                  ]).map((item, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[0.65rem] text-slate-400 uppercase">{item.label}</div>
                      <div className={`text-sm ${item.bold ? "font-bold text-slate-900" : item.color || "text-slate-700"}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Transactions list */}
            <div className="flex-1 overflow-y-auto">
              {txnLoading ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="inline-block w-5 h-5 border-2 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
                </div>
              ) : txns.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">No transactions found for this statement</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-4 py-2 font-medium text-slate-500">Date</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-500">Description</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-500">Amount</th>
                      {txns[0]?.type === "checking" && <th className="text-right px-4 py-2 font-medium text-slate-500">Balance</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t) => (
                      <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtShortDate(txnDate(t))}</td>
                        <td className="px-4 py-2 text-slate-800 max-w-[350px]">
                          <div className="truncate">{t.description}</div>
                          {t.type === "cc" && t.category && (
                            <span className="text-[0.6rem] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{t.category}</span>
                          )}
                          {t.type === "checking" && t.transaction_type && (
                            <span className="text-[0.6rem] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{t.transaction_type}</span>
                          )}
                        </td>
                        <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${txnAmount(t) < 0 ? "text-emerald-600" : "text-slate-800"}`}>
                          {fmtMoney(txnAmount(t))}
                        </td>
                        {t.type === "checking" && <td className="px-4 py-2 text-right text-slate-500 whitespace-nowrap">{fmtMoney(t.running_balance)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {txns.length > 0 && (
              <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400">
                {txns.length} transaction{txns.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
