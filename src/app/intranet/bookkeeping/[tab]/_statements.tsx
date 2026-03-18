"use client";

import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import React, { useState, useEffect, useCallback, useRef } from "react";

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
  period_start: string | null;
  period_end: string | null;
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

interface InstitutionGroup {
  institution: string;
  label: string;
  accounts: AccountGroup[];
  totalStatements: number;
}

type AccountSortField = "name" | "number" | "type" | "holder" | "stmts";
type SortDir = "asc" | "desc";

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
  { value: "Tesloop", label: "Tesloop" },
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

const API_BASE = "https://r2-files.finleg.workers.dev";

function fileUrl(bucket: string, r2Key: string): string {
  return `${API_BASE}/${bucket}/${r2Key}`;
}

// Map account_type to summary table name
const SUMMARY_TABLES: Record<string, string> = {
  "credit-card": "cc_statement_summaries",
  "credit-line": "cc_statement_summaries",
  checking: "checking_statement_summaries",
  payment: "checking_statement_summaries",
  brokerage: "investment_statement_summaries",
  ira: "investment_statement_summaries",
  trust: "investment_statement_summaries",
  crypto: "investment_statement_summaries",
  mortgage: "loan_statement_summaries",
  heloc: "loan_statement_summaries",
  "auto-loan": "loan_statement_summaries",
  "sba-loan": "loan_statement_summaries",
};

interface ParsedSummary {
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

interface AppUser {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface ShareModal {
  statement: Statement;
  shareUrl: string | null;
  shareId: string | null;
  creating: boolean;
  copied: boolean;
  sendMode: boolean;
  sending: boolean;
  sentTo: Set<string>;
}

export default function StatementsTab() {
  const authCtx = useAuth();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountType, setAccountType] = useState("");
  const [holderFilter, setHolderFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [expandedInstitutions, setExpandedInstitutions] = useState<Set<string>>(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [detailStatement, setDetailStatement] = useState<Statement | null>(null);
  // Display name overrides: keyed by "institution|account_number|account_name"
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [acctSortField, setAcctSortField] = useState<AccountSortField>("stmts");
  const [acctSortDir, setAcctSortDir] = useState<SortDir>("desc");
  // Track which document_ids have parsed data
  const [parsedDocIds, setParsedDocIds] = useState<Set<string>>(new Set());
  const [parsedDetail, setParsedDetail] = useState<ParsedSummary | null>(null);
  const [parsedLoading, setParsedLoading] = useState(false);

  // Share state
  const [shareModal, setShareModal] = useState<ShareModal | null>(null);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [currentAppUserId, setCurrentAppUserId] = useState<string | null>(null);

  const toggleAcctSort = (field: AccountSortField) => {
    if (acctSortField === field) {
      setAcctSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setAcctSortField(field);
      setAcctSortDir(field === "name" || field === "type" || field === "holder" ? "asc" : "desc");
    }
  };

  const sortAccounts = (accounts: AccountGroup[]): AccountGroup[] => {
    return [...accounts].sort((a, b) => {
      let cmp = 0;
      switch (acctSortField) {
        case "name":
          cmp = getDisplayName(a).localeCompare(getDisplayName(b));
          break;
        case "number":
          cmp = (a.accountNumber || "").localeCompare(b.accountNumber || "");
          break;
        case "type":
          cmp = accountTypeLabel(a.accountType).localeCompare(accountTypeLabel(b.accountType));
          break;
        case "holder":
          cmp = (a.accountHolder || "").localeCompare(b.accountHolder || "");
          break;
        case "stmts":
          cmp = a.statements.length - b.statements.length;
          break;
      }
      return acctSortDir === "asc" ? cmp : -cmp;
    });
  };

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

  // Fetch display name overrides
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("account_display_names")
        .select("institution, account_number, account_name, display_name");
      if (data) {
        const map: Record<string, string> = {};
        for (const row of data) {
          const key = `${row.institution}|${row.account_name}|${row.account_number || ""}`;
          map[key] = row.display_name;
        }
        setDisplayNames(map);
      }
    })();
  }, []);

  // Fetch parsed document IDs from all summary tables
  useEffect(() => {
    (async () => {
      const tables = ["cc_statement_summaries", "checking_statement_summaries", "investment_statement_summaries", "loan_statement_summaries"];
      const ids = new Set<string>();
      await Promise.all(tables.map(async (t) => {
        const { data } = await supabase.from(t).select("document_id");
        if (data) data.forEach((r: { document_id: string }) => { if (r.document_id) ids.add(r.document_id); });
      }));
      setParsedDocIds(ids);
    })();
  }, []);

  const loadParsedDetail = async (s: Statement) => {
    const table = SUMMARY_TABLES[s.account_type];
    if (!table) return;
    setParsedLoading(true);
    const { data } = await supabase.from(table).select("*").eq("document_id", s.id).single();
    if (data) {
      setParsedDetail({ table, data });
    }
    setParsedLoading(false);
  };

  // Fetch current user's app_users id
  const user = authCtx.user;
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("app_users")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();
      if (data) setCurrentAppUserId(data.id);
    })();
  }, [user]);

  // Fetch app users for send-to feature
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_users")
        .select("id, display_name, first_name, last_name, email, role")
        .not("role", "in", "(pending,prospect)")
        .eq("is_archived", false)
        .order("first_name");
      if (data) setAppUsers(data as AppUser[]);
    })();
  }, []);

  const openShareModal = async (s: Statement) => {
    setShareModal({
      statement: s,
      shareUrl: null,
      shareId: null,
      creating: true,
      copied: false,
      sendMode: false,
      sending: false,
      sentTo: new Set(),
    });

    if (!currentAppUserId) {
      setShareModal((prev) => prev ? { ...prev, creating: false } : null);
      return;
    }

    // Check for existing active share
    const { data: existing } = await supabase
      .from("document_shares")
      .select("id, share_token")
      .eq("document_id", s.id)
      .eq("created_by", currentAppUserId)
      .eq("is_revoked", false)
      .limit(1)
      .single();

    if (existing) {
      const url = `${window.location.origin}/shared?token=${existing.share_token}`;
      setShareModal((prev) => prev ? { ...prev, shareUrl: url, shareId: existing.id, creating: false } : null);

      // Load already-sent recipients
      const { data: recipients } = await supabase
        .from("document_share_recipients")
        .select("recipient_user_id")
        .eq("share_id", existing.id);
      if (recipients) {
        const sent = new Set(recipients.map((r: { recipient_user_id: string }) => r.recipient_user_id));
        setShareModal((prev) => prev ? { ...prev, sentTo: sent } : null);
      }
      return;
    }

    // Create new share
    const { data: newShare, error: createErr } = await supabase
      .from("document_shares")
      .insert({ document_id: s.id, created_by: currentAppUserId })
      .select("id, share_token")
      .single();

    if (createErr || !newShare) {
      setShareModal((prev) => prev ? { ...prev, creating: false } : null);
      return;
    }

    const url = `${window.location.origin}/shared?token=${newShare.share_token}`;
    setShareModal((prev) => prev ? { ...prev, shareUrl: url, shareId: newShare.id, creating: false } : null);
  };

  const copyShareLink = async () => {
    if (!shareModal?.shareUrl) return;
    await navigator.clipboard.writeText(shareModal.shareUrl);
    setShareModal((prev) => prev ? { ...prev, copied: true } : null);
    setTimeout(() => {
      setShareModal((prev) => prev ? { ...prev, copied: false } : null);
    }, 2000);
  };

  const sendToUser = async (userId: string) => {
    if (!shareModal?.shareId) return;
    setShareModal((prev) => prev ? { ...prev, sending: true } : null);

    await supabase
      .from("document_share_recipients")
      .upsert(
        { share_id: shareModal.shareId, recipient_user_id: userId },
        { onConflict: "share_id,recipient_user_id" }
      );

    setShareModal((prev) => {
      if (!prev) return null;
      const sentTo = new Set(prev.sentTo);
      sentTo.add(userId);
      return { ...prev, sentTo, sending: false };
    });
  };

  const getDisplayName = (acct: AccountGroup): string => {
    return displayNames[acct.key] || acct.accountName;
  };

  const startEditing = (key: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingKey(key);
    setEditValue(currentName);
    setTimeout(() => editRef.current?.focus(), 0);
  };

  const saveDisplayName = async (acct: AccountGroup) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === getDisplayName(acct)) {
      setEditingKey(null);
      return;
    }
    setDisplayNames((prev) => ({ ...prev, [acct.key]: trimmed }));
    setEditingKey(null);
    await supabase.from("account_display_names").upsert(
      {
        institution: acct.institution,
        account_number: acct.accountNumber || "",
        account_name: acct.accountName || "",
        display_name: trimmed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "institution,account_number,account_name" }
    );
  };

  // Group statements by institution → account
  const institutionGroups: InstitutionGroup[] = (() => {
    // First build account groups
    const accountMap = new Map<string, AccountGroup>();
    for (const s of statements) {
      const key = `${s.institution}|${s.account_name}|${s.account_number}`;
      if (!accountMap.has(key)) {
        accountMap.set(key, {
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
      accountMap.get(key)!.statements.push(s);
    }

    // Group accounts by institution
    const instMap = new Map<string, AccountGroup[]>();
    for (const acct of accountMap.values()) {
      if (!instMap.has(acct.institution)) instMap.set(acct.institution, []);
      instMap.get(acct.institution)!.push(acct);
    }

    // Sort and build institution groups
    return Array.from(instMap.entries())
      .map(([inst, accounts]) => ({
        institution: inst,
        label: institutionLabel(inst),
        accounts: accounts.sort((a, b) => {
          if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
          return a.accountName.localeCompare(b.accountName);
        }),
        totalStatements: accounts.reduce((sum, a) => sum + a.statements.length, 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  // Determine active vs archived institution groups
  // Active = has at least one statement from current calendar year or last 6 months
  const isActiveGroup = (group: InstitutionGroup): boolean => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const cutoffYear = sixMonthsAgo.getFullYear();
    const cutoffMonth = sixMonthsAgo.getMonth() + 1; // 1-indexed

    return group.accounts.some((acct) =>
      acct.statements.some((s) => {
        if (!s.year) return false;
        // Current calendar year
        if (s.year >= currentYear) return true;
        // Within last 6 months
        if (s.year === cutoffYear && s.month && s.month >= cutoffMonth) return true;
        return false;
      })
    );
  };

  const activeGroups = institutionGroups.filter(isActiveGroup);
  const archivedGroups = institutionGroups.filter((g) => !isActiveGroup(g));

  const allAccountKeys = institutionGroups.flatMap((g) => g.accounts.map((a) => a.key));
  const allInstitutionKeys = institutionGroups.map((g) => g.institution);
  const totalAccounts = institutionGroups.reduce((sum, g) => sum + g.accounts.length, 0);

  const toggleInstitution = (inst: string) => {
    setExpandedInstitutions((prev) => {
      const next = new Set(prev);
      if (next.has(inst)) next.delete(inst);
      else next.add(inst);
      return next;
    });
  };

  const toggleAccount = (key: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedInstitutions(new Set(allInstitutionKeys));
    setExpandedAccounts(new Set(allAccountKeys));
  };

  const collapseAll = () => {
    setExpandedInstitutions(new Set());
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
            {totalAccounts} accounts
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

      {/* Institution groups */}
      {!loading && !error && institutionGroups.length > 0 && (
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

          {/* Render institution group card */}
          {(() => {
            const renderInstGroup = (instGroup: InstitutionGroup) => {
              const instExpanded = expandedInstitutions.has(instGroup.institution);

              return (
                <div key={instGroup.institution} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  {/* Institution header */}
                  <button
                    onClick={() => toggleInstitution(instGroup.institution)}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-xl flex-shrink-0">
                      {institutionLogo(instGroup.institution)}
                    </span>
                    <span className="font-semibold text-slate-900 flex-1">
                      {instGroup.label}
                    </span>
                    <span className="text-xs text-slate-400 mr-2">
                      {instGroup.accounts.length} account{instGroup.accounts.length !== 1 ? "s" : ""}
                      {" \u00b7 "}
                      {instGroup.totalStatements} stmt{instGroup.totalStatements !== 1 ? "s" : ""}
                    </span>
                    <svg
                      className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${instExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded: accounts table */}
                  {instExpanded && (
                    <div className="border-t border-slate-100 px-5 pb-3">
                      {/* Sortable column header */}
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[0.65rem] text-slate-400 uppercase tracking-wider">
                            {([
                              ["name", "Account", "text-left"],
                              ["number", "Acct #", "text-left"],
                              ["type", "Type", "text-left"],
                              ["holder", "Holder", "text-left"],
                              ["stmts", "Stmts", "text-right"],
                            ] as [AccountSortField, string, string][]).map(([field, label, align]) => (
                              <th
                                key={field}
                                onClick={() => toggleAcctSort(field)}
                                className={`${align} py-2 pr-3 font-medium cursor-pointer hover:text-slate-600 transition-colors select-none ${field === "stmts" ? "pr-0" : ""}`}
                              >
                                {label}
                                {acctSortField === field && (
                                  <span className="ml-1 text-emerald-500">
                                    {acctSortDir === "asc" ? "\u25b2" : "\u25bc"}
                                  </span>
                                )}
                              </th>
                            ))}
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortAccounts(instGroup.accounts).map((acct) => {
                            const acctExpanded = expandedAccounts.has(acct.key);

                            return (
                              <React.Fragment key={acct.key}>
                              <tr
                                onClick={() => toggleAccount(acct.key)}
                                className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${acct.isClosed ? "opacity-60" : ""}`}
                              >
                                {/* Account Name (with inline edit) */}
                                <td className="py-2 pr-3">
                                  <div className="flex items-center gap-1.5">
                                    {editingKey === acct.key ? (
                                      <input
                                        ref={editRef}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={() => saveDisplayName(acct)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") saveDisplayName(acct);
                                          if (e.key === "Escape") setEditingKey(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-sm font-medium text-slate-700 border border-emerald-300 rounded px-2 py-0.5 outline-none focus:border-emerald-500 bg-white w-full"
                                      />
                                    ) : (
                                      <>
                                        <span className="font-medium text-slate-800 truncate">
                                          {getDisplayName(acct)}
                                        </span>
                                        <span
                                          onClick={(e) => startEditing(acct.key, getDisplayName(acct), e)}
                                          className="text-slate-300 hover:text-emerald-600 cursor-pointer flex-shrink-0"
                                          title="Edit display name"
                                        >
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                          </svg>
                                        </span>
                                        {acct.isClosed && (
                                          <span className="text-[0.6rem] uppercase font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                            Closed
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </td>
                                {/* Account Number */}
                                <td className="py-2 pr-3 text-xs text-slate-400 font-mono whitespace-nowrap">
                                  {acct.accountNumber ? `****${acct.accountNumber}` : "\u2014"}
                                </td>
                                {/* Type */}
                                <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                                  {accountTypeLabel(acct.accountType)}
                                </td>
                                {/* Holder */}
                                <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                                  {acct.accountHolder && acct.accountHolder !== "various" ? acct.accountHolder : "\u2014"}
                                </td>
                                {/* Stmts */}
                                <td className="py-2 text-xs text-slate-400 text-right whitespace-nowrap">
                                  {acct.statements.length}
                                </td>
                                {/* Expand chevron */}
                                <td className="py-2 pl-2 w-8">
                                  <svg
                                    className={`w-3.5 h-3.5 text-slate-400 transition-transform ${acctExpanded ? "rotate-180" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </td>
                              </tr>
                              {acctExpanded && (
                                <tr>
                                  <td colSpan={6} className="p-0">
                                    <div className="pl-4 pb-2 mb-2 border-l-2 border-emerald-200 ml-2">
                                      <div className="text-[0.65rem] text-slate-400 uppercase tracking-wider font-medium py-1.5">
                                        {getDisplayName(acct)} &mdash; {acct.statements.length} statement{acct.statements.length !== 1 ? "s" : ""}
                                      </div>
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="text-[0.6rem] text-slate-400 uppercase tracking-wider">
                                            <th className="text-left py-1 pr-3 font-medium">Starting</th>
                                            <th className="text-left py-1 pr-3 font-medium">Ending</th>
                                            <th className="text-left py-1 pr-3 font-medium">Filename</th>
                                            <th className="text-right py-1 pr-3 font-medium">Size</th>
                                            <th className="text-center py-1 font-medium w-16">View</th>
                                            <th className="text-center py-1 font-medium w-16">Data</th>
                                            <th className="text-center py-1 font-medium w-16">Share</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {acct.statements.map((s) => {
                                            const hasParsed = parsedDocIds.has(s.id);
                                            const fmtDate = (d: string | null) => {
                                              if (!d) return null;
                                              const dt = new Date(d + "T00:00:00");
                                              return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                                            };
                                            const startDate = fmtDate(s.period_start);
                                            const endDate = fmtDate(s.period_end);
                                            const fallbackPeriod = s.month
                                              ? `${MONTH_NAMES[s.month]} ${s.year}`
                                              : s.year
                                                ? String(s.year)
                                                : null;
                                            return (
                                              <tr
                                                key={s.id}
                                                onClick={(e) => { e.stopPropagation(); setDetailStatement(s); }}
                                                className="hover:bg-emerald-50 cursor-pointer transition-colors border-t border-slate-50"
                                              >
                                                <td className="py-1.5 pr-3 text-slate-800 whitespace-nowrap">
                                                  {startDate || fallbackPeriod || "\u2014"}
                                                </td>
                                                <td className="py-1.5 pr-3 text-slate-800 whitespace-nowrap">
                                                  {endDate || "\u2014"}
                                                </td>
                                                <td className="py-1.5 pr-3 text-slate-500 truncate max-w-[300px]">
                                                  {s.filename}
                                                </td>
                                                <td className="py-1.5 pr-3 text-slate-400 text-right whitespace-nowrap text-xs">
                                                  {formatSize(s.file_size)}
                                                </td>
                                                {/* View original PDF */}
                                                <td className="py-1.5 text-center w-16">
                                                  <a
                                                    href={fileUrl(s.bucket, s.r2_key)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-emerald-600 hover:text-emerald-800 text-xs font-medium"
                                                    title="View original document"
                                                  >
                                                    PDF
                                                  </a>
                                                </td>
                                                {/* Parsed data */}
                                                <td className="py-1.5 text-center w-16">
                                                  {hasParsed ? (
                                                    <button
                                                      onClick={(e) => { e.stopPropagation(); loadParsedDetail(s); }}
                                                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                                      title="View parsed statement data"
                                                    >
                                                      View
                                                    </button>
                                                  ) : (
                                                    <span className="text-slate-300 text-xs">&mdash;</span>
                                                  )}
                                                </td>
                                                {/* Share */}
                                                <td className="py-1.5 text-center w-16">
                                                  <button
                                                    onClick={(e) => { e.stopPropagation(); openShareModal(s); }}
                                                    className="text-slate-400 hover:text-emerald-600 text-xs font-medium transition-colors"
                                                    title="Share this statement"
                                                  >
                                                    <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                                    </svg>
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className="space-y-6">
                {/* Active Accounts */}
                {activeGroups.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Active Accounts</h2>
                      <span className="text-xs text-slate-400">
                        {activeGroups.length} institution{activeGroups.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {activeGroups.map(renderInstGroup)}
                    </div>
                  </div>
                )}

                {/* Archived Accounts */}
                {archivedGroups.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Archived Accounts</h2>
                      <span className="text-xs text-slate-400">
                        {archivedGroups.length} institution{archivedGroups.length !== 1 ? "s" : ""} &middot; no activity in 6+ months
                      </span>
                    </div>
                    <div className="space-y-2 opacity-75">
                      {archivedGroups.map(renderInstGroup)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Empty state */}
      {!loading && !error && institutionGroups.length === 0 && (
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
                  {displayNames[`${detailStatement.institution}|${detailStatement.account_name}|${detailStatement.account_number || ""}`] || detailStatement.account_name}
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
                {(detailStatement.period_start || detailStatement.statement_date) && (
                  <tr>
                    <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                      Starting
                    </td>
                    <td className="text-slate-700">
                      {detailStatement.period_start || detailStatement.statement_date}
                    </td>
                  </tr>
                )}
                {detailStatement.period_end && (
                  <tr>
                    <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">
                      Ending
                    </td>
                    <td className="text-slate-700">
                      {detailStatement.period_end}
                    </td>
                  </tr>
                )}
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

            {/* Action buttons */}
            <div className="mt-5 pt-4 border-t border-slate-100 flex gap-3">
              <a
                href={fileUrl(detailStatement.bucket, detailStatement.r2_key)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                View Original PDF
              </a>
              {parsedDocIds.has(detailStatement.id) && (
                <button
                  onClick={() => { loadParsedDetail(detailStatement); }}
                  className="flex-1 text-center py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  View Parsed Data
                </button>
              )}
              <button
                onClick={() => { setDetailStatement(null); openShareModal(detailStatement); }}
                className="flex-1 text-center py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                Share
              </button>
            </div>

            <div className="mt-3 text-xs text-slate-400">
              <span className="font-medium">R2 Key:</span>{" "}
              <span className="break-all">{detailStatement.r2_key}</span>
            </div>
          </div>
        </div>
      )}

      {/* Parsed data detail modal */}
      {parsedDetail && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setParsedDetail(null);
          }}
        >
          <button
            onClick={() => setParsedDetail(null)}
            className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[61]"
          >
            &times;
          </button>

          <div className="bg-white rounded-xl p-8 max-w-[600px] w-[90vw] max-h-[80vh] overflow-y-auto text-left">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Parsed Statement Data
            </h3>
            {parsedLoading ? (
              <div className="text-center py-8 text-slate-400">
                <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(parsedDetail.data)
                    .filter(([k]) => !["id", "created_at", "document_id", "r2_key", "source_file_name"].includes(k))
                    .map(([key, value]) => (
                      <tr key={key} className="border-t border-slate-100">
                        <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top capitalize">
                          {key.replace(/_/g, " ")}
                        </td>
                        <td className="text-slate-700 py-1.5">
                          {value === null || value === undefined
                            ? "\u2014"
                            : typeof value === "number"
                              ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : String(value)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Share modal */}
      {shareModal && (
        <div
          className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShareModal(null);
          }}
        >
          <button
            onClick={() => setShareModal(null)}
            className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[71]"
          >
            &times;
          </button>

          <div className="bg-white rounded-xl p-6 max-w-[480px] w-[90vw] max-h-[80vh] overflow-y-auto text-left">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">
              Share Statement
            </h3>
            <p className="text-sm text-slate-500 mb-5">
              {shareModal.statement.account_name}
              {shareModal.statement.month ? ` — ${MONTH_NAMES[shareModal.statement.month]} ${shareModal.statement.year}` : ""}
            </p>

            {shareModal.creating ? (
              <div className="text-center py-8 text-slate-400">
                <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
                <p className="mt-2 text-sm">Generating share link...</p>
              </div>
            ) : shareModal.shareUrl ? (
              <>
                {/* Copy link section */}
                <div className="mb-5">
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                    Share Link
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareModal.shareUrl}
                      className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-slate-50 text-slate-600 outline-none"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      onClick={copyShareLink}
                      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        shareModal.copied
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                    >
                      {shareModal.copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Only authenticated users can view this link.
                  </p>
                </div>

                {/* Send to users section */}
                <div>
                  <button
                    onClick={() => setShareModal((prev) => prev ? { ...prev, sendMode: !prev.sendMode } : null)}
                    className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-emerald-700 transition-colors mb-3"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Send to a user
                    <svg className={`w-3.5 h-3.5 transition-transform ${shareModal.sendMode ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {shareModal.sendMode && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      {appUsers.length === 0 ? (
                        <div className="p-4 text-sm text-slate-400 text-center">No users found</div>
                      ) : (
                        <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-100">
                          {appUsers
                            .filter((u) => u.id !== currentAppUserId)
                            .map((u) => {
                              const name = u.display_name || `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
                              const isSent = shareModal.sentTo.has(u.id);
                              return (
                                <div key={u.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                                  <div>
                                    <span className="text-sm font-medium text-slate-800">{name}</span>
                                    <span className="text-xs text-slate-400 ml-2">{u.role}</span>
                                  </div>
                                  {isSent ? (
                                    <span className="text-xs text-emerald-600 font-medium">Sent</span>
                                  ) : (
                                    <button
                                      onClick={() => sendToUser(u.id)}
                                      disabled={shareModal.sending}
                                      className="text-xs text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
                                    >
                                      Send
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-6 text-slate-400">
                <p className="text-sm">Unable to create share link. Make sure you have an active account.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
