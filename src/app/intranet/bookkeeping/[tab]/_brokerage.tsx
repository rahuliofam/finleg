"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const SCHWAB_OAUTH_WORKER = "https://schwab-oauth.finleg.workers.dev";

interface Account {
  id: string;
  account_number_masked: string | null;
  account_type: string;
  account_subtype: string | null;
  display_name: string | null;
  official_name: string | null;
  account_holder: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  total_value: number | null;
  cash_balance: number | null;
  buying_power: number | null;
  balance_current: number | null;
  balance_available: number | null;
  connection_type: string | null;
  metadata: Record<string, unknown> | null;
}

interface Holding {
  id: string;
  account_id: string;
  quantity: number;
  cost_basis: number | null;
  market_value: number | null;
  price: number | null;
  unrealized_gain_loss: number | null;
  unrealized_gain_loss_pct: number | null;
  last_synced_at: string | null;
  security: {
    ticker_symbol: string | null;
    name: string;
    security_type: string;
  };
}

interface ConnectionStatus {
  connected: boolean;
  refreshTokenExpiresAt?: string;
  lastUpdated?: string;
}

interface AccountGroup {
  name: string;
  accounts: Account[];
}

// Determine which group an account belongs to based on holder + type
function getAccountGroup(acct: Account): string {
  const holder = acct.account_holder || "";
  const type = acct.account_type;
  const subtype = acct.account_subtype || "";
  const name = acct.display_name || "";

  // SubTrust = Revocable Trust of Subhash Sonnad
  if (holder.includes("Subhash") || name.startsWith("SubTrust")) {
    return "SubTrust";
  }

  // Kids' Trust IRAs (trust subtype for Haydn/Hannah/Emina)
  if (subtype === "trust" && (holder.includes("Haydn") || holder.includes("Hannah") || holder.includes("Emina"))) {
    return "Kids Trust IRAs";
  }

  // Kids' personal accounts
  if (holder.includes("Haydn") || holder.includes("Hannah") || holder.includes("Emina")) {
    return "Kids Personal";
  }

  // Dina
  if (holder.includes("Dina")) {
    return "Other";
  }

  // Kathy accounts
  if (holder.includes("Kathy")) {
    return "Kathy";
  }

  // Rahul — split into retirement vs non-retirement
  const retirementTypes = ["ira", "roth_ira", "401k", "403b"];
  if (retirementTypes.includes(type)) {
    return "Retirement";
  }

  return "Non Retirement";
}

// Sort order for groups (matches Schwab summary layout)
const GROUP_ORDER = [
  "Non Retirement",
  "Retirement",
  "Kathy",
  "SubTrust",
  "Kids Trust IRAs",
  "Kids Personal",
  "Other",
];

function groupAccounts(accounts: Account[]): AccountGroup[] {
  const groups: Record<string, Account[]> = {};
  for (const acct of accounts) {
    const group = getAccountGroup(acct);
    if (!groups[group]) groups[group] = [];
    groups[group].push(acct);
  }

  return GROUP_ORDER
    .filter((name) => groups[name]?.length)
    .map((name) => ({ name, accounts: groups[name] }));
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    brokerage: "Brokerage",
    checking: "Checking",
    savings: "Savings",
    ira: "IRA",
    roth_ira: "Roth IRA",
    "401k": "401(k)",
    "403b": "403(b)",
    trust: "Trust",
    credit_card: "Credit Card",
    money_market: "Money Market",
    other: "Other",
  };
  return map[type] || type;
}

export default function BrokerageTab() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Record<string, Holding[]>>({});
  const [lastSync, setLastSync] = useState<{ at: string; status: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);

    const { data: institution } = await supabase
      .from("institutions")
      .select("id")
      .eq("name", "Charles Schwab")
      .single();

    if (!institution) {
      setStatus({ connected: false });
      setLoading(false);
      return;
    }

    const { data: tokenRow } = await supabase
      .from("oauth_tokens")
      .select("id, status, access_token_expires_at, refresh_token_expires_at, updated_at")
      .eq("institution_id", institution.id)
      .single();

    if (tokenRow && tokenRow.status === "active") {
      const refreshExpires = tokenRow.refresh_token_expires_at ? new Date(tokenRow.refresh_token_expires_at) : null;
      const connected = !refreshExpires || new Date() < refreshExpires;
      setStatus({
        connected,
        refreshTokenExpiresAt: tokenRow.refresh_token_expires_at || undefined,
        lastUpdated: tokenRow.updated_at,
      });
    } else {
      setStatus({ connected: false });
    }

    const { data: accts } = await supabase
      .from("accounts")
      .select("*")
      .eq("institution_id", institution.id)
      .eq("is_active", true)
      .order("display_name");

    if (accts?.length) {
      setAccounts(accts);

      // Initialize all groups as expanded
      const groups = groupAccounts(accts);
      const expanded: Record<string, boolean> = {};
      for (const g of groups) expanded[g.name] = true;
      setExpandedGroups(expanded);

      const { data: allHoldings } = await supabase
        .from("holdings")
        .select("*, security:securities(ticker_symbol, name, security_type)")
        .in("account_id", accts.map((a) => a.id))
        .order("market_value", { ascending: false });

      if (allHoldings) {
        const grouped: Record<string, Holding[]> = {};
        for (const h of allHoldings) {
          const key = h.account_id;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(h as Holding);
        }
        setHoldings(grouped);
      }
    }

    const { data: syncData } = await supabase
      .from("brokerage_sync_runs")
      .select("completed_at, status")
      .eq("institution_id", institution.id)
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    if (syncData) {
      setLastSync({ at: syncData.completed_at, status: syncData.status });
    }

    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("schwab") === "connected") {
      fetchData();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.functions.invoke("schwab-sync", {
        body: { syncType: "manual", triggeredBy: `admin:${session.user.email}`, includeTransactions: true },
      });
      await fetchData();
    } catch (err) {
      console.error("Sync failed:", err);
    }
    setSyncing(false);
  };

  const handleConnect = () => {
    window.location.href = `${SCHWAB_OAUTH_WORKER}/schwab/auth`;
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Schwab? Existing data will be preserved but no new syncs will run.")) return;
    const { data: institution } = await supabase
      .from("institutions")
      .select("id")
      .eq("name", "Charles Schwab")
      .single();
    if (institution) {
      await supabase
        .from("oauth_tokens")
        .update({ status: "revoked" })
        .eq("institution_id", institution.id);
    }
    setStatus({ connected: false });
  };

  const fmt = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n) : "–";

  const fmtCompact = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "–";

  const fmtPct = (n: number | null | undefined) =>
    n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "–";

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";

  const fmtDateFull = (d: string | null) =>
    d ? new Date(d).toLocaleString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: true, month: "2-digit", day: "2-digit", year: "numeric",
    }) : "";

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleAccount = (id: string) => {
    setExpandedAccounts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        Loading brokerage data...
      </div>
    );
  }

  const totalValue = accounts.reduce((sum, a) => sum + (a.total_value || a.balance_current || 0), 0);
  const totalCash = accounts.reduce((sum, a) => sum + (a.cash_balance || 0), 0);
  const groups = groupAccounts(accounts);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Summary</h1>
          {lastSync?.at && (
            <p className="text-xs text-slate-400 mt-0.5">
              Updated: {fmtDateFull(lastSync.at)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status?.connected ? (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700"
            >
              Connect Schwab
            </button>
          )}
        </div>
      </div>

      {/* Refresh token expiry warning */}
      {status?.connected && status.refreshTokenExpiresAt && (() => {
        const daysLeft = Math.ceil((new Date(status.refreshTokenExpiresAt).getTime() - Date.now()) / 86400000);
        if (daysLeft <= 2) {
          return (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Schwab connection expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}. Re-authenticate to maintain sync.
            </div>
          );
        }
        return null;
      })()}

      {/* Total Value Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 mb-5">
        <div className="flex items-baseline gap-6 mb-1">
          <div>
            <div className="text-xs text-slate-500 mb-1">Total Value</div>
            <div className="text-3xl font-bold text-slate-900">{fmtCompact(totalValue)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Cash & Cash Investments</div>
            <div className="text-lg font-semibold text-slate-700">{fmt(totalCash)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Accounts</div>
            <div className="text-lg font-semibold text-slate-700">{accounts.length}</div>
          </div>
        </div>
      </div>

      {/* Not connected empty state */}
      {!status?.connected && accounts.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Connect Your Schwab Account</h3>
          <p className="text-sm text-slate-500 mb-4">
            Link your Charles Schwab brokerage to view accounts, positions, and balances.
          </p>
          <button
            onClick={handleConnect}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            Connect Schwab
          </button>
        </div>
      )}

      {/* Accounts Table — Schwab-style grouped layout */}
      {accounts.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Accounts</h2>
              <p className="text-xs text-slate-400">{accounts.length} accounts included in Total Value</p>
            </div>
          </div>

          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50">
                  <th className="px-4 py-2 font-medium text-left w-[220px]">Account Name</th>
                  <th className="px-3 py-2 font-medium text-left w-[90px]">Type</th>
                  <th className="px-3 py-2 font-medium text-right w-[140px]">Cash & Investments</th>
                  <th className="px-3 py-2 font-medium text-right w-[140px]">Account Value</th>
                  <th className="px-3 py-2 font-medium text-right w-[50px]">Holdings</th>
                  <th className="px-3 py-2 font-medium text-center w-[50px]">Source</th>
                  <th className="px-3 py-2 font-medium text-center w-[60px]"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <GroupSection
                    key={group.name}
                    group={group}
                    expanded={expandedGroups[group.name] ?? true}
                    expandedAccounts={expandedAccounts}
                    holdings={holdings}
                    onToggleGroup={() => toggleGroup(group.name)}
                    onToggleAccount={toggleAccount}
                    fmt={fmt}
                    fmtPct={fmtPct}
                    fmtDate={fmtDate}
                  />
                ))}
              </tbody>
              {/* Grand total */}
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-sm">
                  <td className="px-4 py-2.5 text-slate-900" colSpan={2}>Total</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{fmt(totalCash)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-900">{fmt(totalValue)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">
                    {Object.values(holdings).reduce((s, h) => s + h.length, 0)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Positions Section */}
      {Object.keys(holdings).length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Positions</h2>
            <p className="text-xs text-slate-400">
              {Object.values(holdings).reduce((s, h) => s + h.length, 0)} holdings across{" "}
              {Object.keys(holdings).length} accounts
            </p>
          </div>
          {accounts
            .filter((a) => holdings[a.id]?.length)
            .map((acct) => (
              <PositionsBlock
                key={acct.id}
                account={acct}
                holdings={holdings[acct.id] || []}
                fmt={fmt}
                fmtPct={fmtPct}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Group Section — collapsible account group with subtotals
   ============================================================ */

function GroupSection({
  group,
  expanded,
  expandedAccounts,
  holdings,
  onToggleGroup,
  onToggleAccount,
  fmt,
  fmtPct,
  fmtDate,
}: {
  group: AccountGroup;
  expanded: boolean;
  expandedAccounts: Record<string, boolean>;
  holdings: Record<string, Holding[]>;
  onToggleGroup: () => void;
  onToggleAccount: (id: string) => void;
  fmt: (n: number | null | undefined) => string;
  fmtPct: (n: number | null | undefined) => string;
  fmtDate: (d: string | null) => string;
}) {
  const groupValue = group.accounts.reduce((s, a) => s + (a.total_value || a.balance_current || 0), 0);
  const groupCash = group.accounts.reduce((s, a) => s + (a.cash_balance || 0), 0);
  const groupHoldings = group.accounts.reduce((s, a) => s + (holdings[a.id]?.length || 0), 0);

  return (
    <>
      {/* Group header row */}
      <tr
        className="border-b border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 select-none"
        onClick={onToggleGroup}
      >
        <td className="px-4 py-2 font-semibold text-slate-800" colSpan={2}>
          <span className="inline-block w-4 text-slate-400 mr-1 text-xs">
            {expanded ? "▼" : "▶"}
          </span>
          {group.name}
        </td>
        <td className="px-3 py-2 text-right font-medium text-slate-600">{fmt(groupCash)}</td>
        <td className="px-3 py-2 text-right font-semibold text-slate-900">{fmt(groupValue)}</td>
        <td className="px-3 py-2 text-right text-slate-600">{groupHoldings || ""}</td>
        <td colSpan={2}></td>
      </tr>

      {/* Account rows */}
      {expanded &&
        group.accounts.map((acct) => {
          const acctHoldings = holdings[acct.id] || [];
          const isExpanded = expandedAccounts[acct.id] ?? false;
          const value = acct.total_value || acct.balance_current || 0;

          return (
            <tr
              key={acct.id}
              className={`border-b border-slate-100 hover:bg-blue-50/30 cursor-pointer transition-colors ${
                isExpanded ? "bg-blue-50/20" : ""
              }`}
              onClick={() => onToggleAccount(acct.id)}
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {acctHoldings.length > 0 && (
                    <span className="text-xs text-slate-400">{isExpanded ? "▼" : "▶"}</span>
                  )}
                  <div>
                    <div className="font-medium text-slate-900 text-sm">
                      {acct.display_name || acct.account_number_masked}
                    </div>
                    <div className="text-xs text-slate-400">
                      {acct.account_number_masked}
                      {acct.account_holder && ` · ${acct.account_holder}`}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-slate-600 text-xs">{typeLabel(acct.account_type)}</td>
              <td className="px-3 py-2.5 text-right text-slate-700">{fmt(acct.cash_balance)}</td>
              <td className="px-3 py-2.5 text-right font-medium text-slate-900">{value ? fmt(value) : "–"}</td>
              <td className="px-3 py-2.5 text-right text-slate-600">{acctHoldings.length || ""}</td>
              <td className="px-3 py-2.5 text-center">
                {acct.connection_type === "api" ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="API-synced" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-slate-300" title="Manual" />
                )}
              </td>
              <td className="px-3 py-2.5 text-center">
                {acctHoldings.length > 0 && (
                  <span className="text-xs text-blue-600 font-medium">
                    {isExpanded ? "Hide" : "More"}
                  </span>
                )}
              </td>
            </tr>
          );
        })}

      {/* Group subtotal */}
      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50/50">
          <td className="px-4 py-1.5 text-xs font-semibold text-slate-500 pl-9" colSpan={2}>
            {group.name} Total
          </td>
          <td className="px-3 py-1.5 text-right text-xs font-semibold text-slate-600">{fmt(groupCash)}</td>
          <td className="px-3 py-1.5 text-right text-xs font-semibold text-slate-900">{fmt(groupValue)}</td>
          <td className="px-3 py-1.5 text-right text-xs text-slate-500">{groupHoldings || ""}</td>
          <td colSpan={2}></td>
        </tr>
      )}
    </>
  );
}

/* ============================================================
   Positions Block — per-account holdings table in Positions section
   ============================================================ */

function PositionsBlock({
  account,
  holdings,
  fmt,
  fmtPct,
}: {
  account: Account;
  holdings: Holding[];
  fmt: (n: number | null | undefined) => string;
  fmtPct: (n: number | null | undefined) => string;
}) {
  const [expanded, setExpanded] = useState(true);

  const totalMarketValue = holdings.reduce((s, h) => s + (h.market_value || 0), 0);
  const totalCostBasis = holdings.reduce((s, h) => s + (h.cost_basis || 0), 0);
  const totalGainLoss = holdings.reduce((s, h) => s + (h.unrealized_gain_loss || 0), 0);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* Account header */}
      <div
        className="px-4 py-2.5 bg-slate-50/50 flex items-center justify-between cursor-pointer hover:bg-slate-100"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{expanded ? "▼" : "▶"}</span>
          <span className="font-semibold text-sm text-slate-900">
            {account.display_name || account.account_number_masked}
          </span>
          <span className="text-xs text-slate-400">
            {account.account_number_masked} · {typeLabel(account.account_type)}
          </span>
        </div>
        <span className="text-sm font-medium text-slate-700">{fmt(totalMarketValue)}</span>
      </div>

      {/* Holdings table */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="px-4 py-1.5 font-medium text-left">Symbol</th>
                <th className="px-3 py-1.5 font-medium text-left">Description</th>
                <th className="px-3 py-1.5 font-medium text-right">Quantity</th>
                <th className="px-3 py-1.5 font-medium text-right">Price</th>
                <th className="px-3 py-1.5 font-medium text-right">Market Value</th>
                <th className="px-3 py-1.5 font-medium text-right">Cost Basis</th>
                <th className="px-3 py-1.5 font-medium text-right">Gain/Loss $</th>
                <th className="px-3 py-1.5 font-medium text-right">Gain/Loss %</th>
                <th className="px-3 py-1.5 font-medium text-right">% of Account</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const pctOfAccount = totalMarketValue > 0 && h.market_value
                  ? (h.market_value / totalMarketValue) * 100
                  : null;
                return (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-blue-700">
                      {h.security?.ticker_symbol || "–"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-[200px] truncate">
                      {h.security?.name || "–"}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {h.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 }) || "–"}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmt(h.price)}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">{fmt(h.market_value)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmt(h.cost_basis)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      (h.unrealized_gain_loss || 0) >= 0 ? "text-green-600" : "text-red-600"
                    }`}>
                      {fmt(h.unrealized_gain_loss)}
                    </td>
                    <td className={`px-3 py-2 text-right ${
                      (h.unrealized_gain_loss_pct || 0) >= 0 ? "text-green-600" : "text-red-600"
                    }`}>
                      {fmtPct(h.unrealized_gain_loss_pct)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {pctOfAccount != null ? `${pctOfAccount.toFixed(1)}%` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/50 text-xs font-semibold">
                <td className="px-4 py-1.5 text-slate-700" colSpan={4}>Account Total</td>
                <td className="px-3 py-1.5 text-right text-slate-900">{fmt(totalMarketValue)}</td>
                <td className="px-3 py-1.5 text-right text-slate-700">{fmt(totalCostBasis)}</td>
                <td className={`px-3 py-1.5 text-right ${totalGainLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {fmt(totalGainLoss)}
                </td>
                <td className={`px-3 py-1.5 text-right ${totalGainLoss >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {totalCostBasis > 0 ? fmtPct((totalGainLoss / totalCostBasis) * 100) : "–"}
                </td>
                <td className="px-3 py-1.5 text-right text-slate-500">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
