"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

const SCHWAB_OAUTH_WORKER = "https://schwab-oauth.finleg.workers.dev";

// ============================================================
// Types
// ============================================================

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

// ============================================================
// Grouping logic
// ============================================================

function getAccountGroup(acct: Account): string {
  const holder = acct.account_holder || "";
  const type = acct.account_type;
  const subtype = acct.account_subtype || "";
  const name = acct.display_name || "";

  if (holder.includes("Subhash") || name.startsWith("SubTrust")) return "SubTrust";
  if (subtype === "trust" && (holder.includes("Haydn") || holder.includes("Hannah") || holder.includes("Emina")))
    return "Kids Trust IRAs";
  if (holder.includes("Haydn") || holder.includes("Hannah") || holder.includes("Emina"))
    return "Other People's Money";
  if (holder.includes("Dina")) return "Other People's Money";
  if (holder.includes("Kathy")) return "Kathy";

  const retirementTypes = ["ira", "roth_ira", "401k", "403b"];
  if (retirementTypes.includes(type)) return "Retirement";
  return "Non Retirement";
}

const GROUP_ORDER = [
  "Non Retirement",
  "Retirement",
  "SubTrust",
  "Kathy",
  "Kids Trust IRAs",
  "Other People's Money",
];

function groupAccounts(accounts: Account[]): AccountGroup[] {
  const groups: Record<string, Account[]> = {};
  for (const acct of accounts) {
    const group = getAccountGroup(acct);
    if (!groups[group]) groups[group] = [];
    groups[group].push(acct);
  }
  return GROUP_ORDER.filter((n) => groups[n]?.length).map((n) => ({ name: n, accounts: groups[n] }));
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    brokerage: "Brokerage", checking: "Checking", savings: "Savings",
    ira: "IRA", roth_ira: "Roth IRA", "401k": "401(k)", "403b": "403(b)",
    trust: "Trust", credit_card: "Credit Card", money_market: "Money Market",
    other: "Other",
  };
  return map[type] || type;
}

// ============================================================
// Formatters
// ============================================================

const fmt = (n: number | null | undefined) =>
  n != null
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    : "–";

const fmtPct = (n: number | null | undefined) =>
  n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "–";

const fmtQty = (n: number | null | undefined) =>
  n != null ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "–";

const fmtDateFull = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: true, month: "2-digit", day: "2-digit", year: "numeric",
      })
    : "";

// ============================================================
// Color helpers
// ============================================================

function changeColor(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-slate-600";
  return n > 0 ? "text-green-700" : "text-red-600";
}

function changeBg(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "bg-green-50" : "bg-red-50";
}

// ============================================================
// Main Component
// ============================================================

export default function BrokerageTab() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Record<string, Holding[]>>({});
  const [lastSync, setLastSync] = useState<{ at: string; status: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedPositionAccounts, setExpandedPositionAccounts] = useState<Record<string, boolean>>({});
  const [chartRange, setChartRange] = useState("1M");
  const [showSettings, setShowSettings] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const { data: institution } = await supabase
      .from("institutions").select("id").eq("name", "Charles Schwab").single();

    if (!institution) { setStatus({ connected: false }); setLoading(false); return; }

    const { data: tokenRow } = await supabase
      .from("oauth_tokens")
      .select("id, status, access_token_expires_at, refresh_token_expires_at, updated_at")
      .eq("institution_id", institution.id).single();

    if (tokenRow && tokenRow.status === "active") {
      const refreshExpires = tokenRow.refresh_token_expires_at ? new Date(tokenRow.refresh_token_expires_at) : null;
      setStatus({
        connected: !refreshExpires || new Date() < refreshExpires,
        refreshTokenExpiresAt: tokenRow.refresh_token_expires_at || undefined,
        lastUpdated: tokenRow.updated_at,
      });
    } else {
      setStatus({ connected: false });
    }

    const { data: accts } = await supabase
      .from("accounts").select("*").eq("institution_id", institution.id).eq("is_active", true).order("display_name");

    if (accts?.length) {
      setAccounts(accts);
      const groups = groupAccounts(accts);
      const exp: Record<string, boolean> = {};
      for (const g of groups) exp[g.name] = true;
      setExpandedGroups(exp);

      const { data: allHoldings } = await supabase
        .from("holdings")
        .select("*, security:securities(ticker_symbol, name, security_type)")
        .in("account_id", accts.map((a) => a.id))
        .order("market_value", { ascending: false });

      if (allHoldings) {
        const grouped: Record<string, Holding[]> = {};
        for (const h of allHoldings) {
          if (!grouped[h.account_id]) grouped[h.account_id] = [];
          grouped[h.account_id].push(h as Holding);
        }
        setHoldings(grouped);
      }
    }

    const { data: syncData } = await supabase
      .from("brokerage_sync_runs")
      .select("completed_at, status")
      .eq("institution_id", institution.id).eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).single();

    if (syncData) setLastSync({ at: syncData.completed_at, status: syncData.status });
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
    } catch (err) { console.error("Sync failed:", err); }
    setSyncing(false);
  };

  const handleConnect = () => { window.location.href = `${SCHWAB_OAUTH_WORKER}/schwab/auth`; };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Schwab? Existing data will be preserved but no new syncs will run.")) return;
    const { data: institution } = await supabase.from("institutions").select("id").eq("name", "Charles Schwab").single();
    if (institution) await supabase.from("oauth_tokens").update({ status: "revoked" }).eq("institution_id", institution.id);
    setStatus({ connected: false });
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading brokerage data...</div>;
  }

  const totalValue = accounts.reduce((s, a) => s + (a.total_value || a.balance_current || 0), 0);
  const groups = groupAccounts(accounts);
  const totalHoldingsCount = Object.values(holdings).reduce((s, h) => s + h.length, 0);
  const accountsWithHoldings = accounts.filter((a) => holdings[a.id]?.length);

  return (
    <div className="max-w-[1400px]">
      {/* ============ HEADER BAR ============ */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-slate-900">Summary</h1>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {lastSync?.at && <span>Updated: {fmtDateFull(lastSync.at)}</span>}
          {status?.connected ? (
            <>
              <button onClick={handleSync} disabled={syncing}
                className="ml-2 px-3 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
              <button onClick={handleDisconnect}
                className="px-3 py-1 text-xs font-medium rounded border border-red-300 text-red-600 hover:bg-red-50">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={handleConnect}
              className="ml-2 px-3 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700">
              Connect Schwab
            </button>
          )}
        </div>
      </div>

      {/* Expiry warning */}
      {status?.connected && status.refreshTokenExpiresAt && (() => {
        const daysLeft = Math.ceil((new Date(status.refreshTokenExpiresAt).getTime() - Date.now()) / 86400000);
        return daysLeft <= 2 ? (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            Schwab connection expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}. Re-authenticate to maintain sync.
          </div>
        ) : null;
      })()}

      {/* ============ TOTAL VALUE CARD ============ */}
      <div className="border border-slate-200 rounded-lg bg-white mb-4">
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-baseline gap-8">
            <div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-0.5">
                Total Value <span className="inline-block w-3 h-3 rounded-full bg-emerald-600 text-white text-[8px] leading-3 text-center ml-0.5">i</span>
              </div>
              <div className="text-[28px] font-bold text-slate-900 leading-tight">{fmt(totalValue)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-0.5">
                Day Change <span className="inline-block w-3 h-3 rounded-full bg-emerald-600 text-white text-[8px] leading-3 text-center ml-0.5">i</span>
              </div>
              <div className="text-sm font-semibold text-slate-500">–</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-0.5">1-Month Change</div>
              <div className="text-sm font-semibold text-slate-500">–</div>
            </div>
          </div>
        </div>

        {/* Chart area */}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-end gap-1 mb-2">
            <button className="px-2 py-0.5 text-[11px] rounded border border-slate-200 text-slate-500 hover:bg-slate-50">
              Table View
            </button>
            {["1M", "3M", "6M", "YTD", "1Y", "2Y"].map((r) => (
              <button key={r} onClick={() => setChartRange(r)}
                className={`px-2 py-0.5 text-[11px] rounded ${
                  chartRange === r
                    ? "bg-emerald-600 text-white"
                    : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}>
                {r}
              </button>
            ))}
          </div>
          <div className="h-[120px] bg-gradient-to-r from-emerald-50 to-white rounded border border-slate-100 flex items-end px-4 pb-2">
            {/* Chart placeholder — gradient area */}
            <svg viewBox="0 0 400 80" className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#059669" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#059669" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,60 Q50,55 100,50 T200,40 T300,35 T400,20" fill="none" stroke="#059669" strokeWidth="2" />
              <path d="M0,60 Q50,55 100,50 T200,40 T300,35 T400,20 V80 H0Z" fill="url(#chartGrad)" />
            </svg>
          </div>
        </div>
      </div>

      {/* ============ NOT CONNECTED ============ */}
      {!status?.connected && accounts.length === 0 && (
        <div className="border border-slate-200 rounded-lg bg-white p-12 text-center">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Connect Your Schwab Account</h3>
          <p className="text-sm text-slate-500 mb-4">Link your Charles Schwab brokerage to view accounts, positions, and balances.</p>
          <button onClick={handleConnect} className="px-4 py-2 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700">
            Connect Schwab
          </button>
        </div>
      )}

      {/* ============ ACCOUNTS TABLE ============ */}
      {accounts.length > 0 && (
        <div className="border border-slate-200 rounded-lg bg-white mb-4 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Accounts</h2>
              <p className="text-[11px] text-slate-400">{accounts.length} of {accounts.length} accounts included in Total Value</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                <span className="text-emerald-600">&#9432;</span> FDIC Disclosures
              </button>
              <button className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50">
                Additional Info
              </button>
              <button onClick={() => setShowSettings(true)}
                className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-2 font-medium text-left min-w-[200px]">Account Name</th>
                  <th className="px-3 py-2 font-medium text-left w-[100px]">Type</th>
                  <th className="px-3 py-2 font-medium text-right w-[140px]">Cash & Cash Investments</th>
                  <th className="px-3 py-2 font-medium text-right w-[130px]">Account Value</th>
                  <th className="px-3 py-2 font-medium text-right w-[110px]">Day Change $</th>
                  <th className="px-3 py-2 font-medium text-right w-[100px]">Day Change %</th>
                  <th className="px-3 py-2 font-medium text-center w-[50px]"></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <AccountGroupRows
                    key={group.name}
                    group={group}
                    expanded={expandedGroups[group.name] ?? true}
                    holdings={holdings}
                    onToggle={() => setExpandedGroups((p) => ({ ...p, [group.name]: !p[group.name] }))}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-[13px]">
                  <td className="px-4 py-2 text-slate-900" colSpan={2}>All Accounts Total</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {fmt(accounts.reduce((s, a) => s + (a.cash_balance || 0), 0))}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-900">{fmt(totalValue)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">–</td>
                  <td className="px-3 py-2 text-right text-slate-500">–</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ============ POSITIONS ============ */}
      {totalHoldingsCount > 0 && (
        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900">Positions</h2>
          </div>

          {/* Equities sub-header */}
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50">
            <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1">
              <span className="text-slate-400">&#9660;</span> Equities <sup className="text-slate-400 normal-case text-[10px]">{totalHoldingsCount}</sup>
            </span>
          </div>

          {/* Per-account positions */}
          {accountsWithHoldings.map((acct) => (
            <PositionsAccountBlock
              key={acct.id}
              account={acct}
              holdings={holdings[acct.id] || []}
              expanded={expandedPositionAccounts[acct.id] ?? true}
              onToggle={() => setExpandedPositionAccounts((p) => ({ ...p, [acct.id]: !(p[acct.id] ?? true) }))}
            />
          ))}
        </div>
      )}

      {/* ============ BOTTOM STATUS BAR ============ */}
      <div className="mt-4 border border-slate-200 rounded-lg bg-emerald-700 text-white px-4 py-2 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-4">
          <span className="font-medium">{accounts.length} Accounts</span>
          <span>Assets: {fmt(totalValue)}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Total Value: <strong>{fmt(totalValue)}</strong></span>
          <span>Positions: <strong>{totalHoldingsCount}</strong></span>
        </div>
      </div>

      {/* ============ CUSTOMIZE SETTINGS MODAL ============ */}
      {showSettings && (
        <CustomizeSettingsModal
          accounts={accounts}
          groups={groupAccounts(accounts)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Account Group Rows
// ============================================================

function AccountGroupRows({
  group, expanded, holdings, onToggle,
}: {
  group: AccountGroup;
  expanded: boolean;
  holdings: Record<string, Holding[]>;
  onToggle: () => void;
}) {
  const groupValue = group.accounts.reduce((s, a) => s + (a.total_value || a.balance_current || 0), 0);
  const groupCash = group.accounts.reduce((s, a) => s + (a.cash_balance || 0), 0);

  return (
    <>
      {/* Group header */}
      <tr className="border-b border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 select-none" onClick={onToggle}>
        <td className="px-4 py-2 font-bold text-slate-800 text-[13px]" colSpan={7}>
          <span className="inline-block w-3 mr-1.5 text-[10px] text-slate-400">{expanded ? "▼" : "▶"}</span>
          {group.name}
        </td>
      </tr>

      {expanded && group.accounts.map((acct) => {
        const value = acct.total_value || acct.balance_current || 0;
        const hasHoldings = (holdings[acct.id]?.length || 0) > 0;
        return (
          <tr key={acct.id} className="border-b border-slate-100 hover:bg-emerald-50/30">
            <td className="px-4 py-2">
              <div className="flex items-start gap-2">
                {acct.connection_type === "api" ? (
                  <span className="mt-0.5 w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="API-synced" />
                ) : (
                  <span className="mt-0.5 w-2 h-2 rounded-full bg-slate-300 flex-shrink-0" title="Manual" />
                )}
                <div>
                  <div className="font-medium text-slate-900">{acct.display_name || acct.account_number_masked}</div>
                  <div className="text-[11px] text-slate-400">
                    {acct.account_number_masked}
                    {acct.account_holder ? ` · ${acct.account_holder}` : ""}
                  </div>
                </div>
              </div>
            </td>
            <td className="px-3 py-2 text-slate-600">{typeLabel(acct.account_type)}</td>
            <td className="px-3 py-2 text-right text-slate-700">{acct.cash_balance != null ? fmt(acct.cash_balance) : "–"}</td>
            <td className="px-3 py-2 text-right font-medium text-slate-900">{value ? fmt(value) : "–"}</td>
            <td className="px-3 py-2 text-right text-slate-500">–</td>
            <td className="px-3 py-2 text-right text-slate-500">–</td>
            <td className="px-3 py-2 text-center">
              {hasHoldings && <span className="text-[11px] text-emerald-600 font-medium cursor-pointer hover:underline">More</span>}
            </td>
          </tr>
        );
      })}

      {/* Group subtotal rows — Schwab style */}
      {expanded && (
        <>
          <tr className="bg-slate-50/70 text-[12px]">
            <td className="px-4 py-1 font-semibold text-slate-500 pl-9" colSpan={3}>{group.name} Total</td>
            <td className="px-3 py-1 text-right font-semibold text-slate-900">{fmt(groupValue)}</td>
            <td className="px-3 py-1 text-right text-slate-400">–</td>
            <td className="px-3 py-1 text-right text-slate-400">–</td>
            <td></td>
          </tr>
        </>
      )}
    </>
  );
}

// ============================================================
// Positions Account Block
// ============================================================

function PositionsAccountBlock({
  account, holdings, expanded, onToggle,
}: {
  account: Account;
  holdings: Holding[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalMV = holdings.reduce((s, h) => s + (h.market_value || 0), 0);
  const totalCB = holdings.reduce((s, h) => s + (h.cost_basis || 0), 0);
  const totalGL = holdings.reduce((s, h) => s + (h.unrealized_gain_loss || 0), 0);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* Account header in positions */}
      <div className="px-4 py-2 bg-white flex items-center justify-between cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{expanded ? "▼" : "▶"}</span>
          <span className="font-semibold text-[13px] text-slate-900">
            {account.display_name || account.account_number_masked}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[12px]">
          <span className="text-slate-500">{holdings.length} positions</span>
          <span className="font-medium text-slate-900">{fmt(totalMV)}</span>
          {totalGL !== 0 && (
            <span className={`font-medium ${totalGL >= 0 ? "text-green-700" : "text-red-600"}`}>
              {fmt(totalGL)}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-1.5 font-medium text-left">Symbol / Name</th>
                <th className="px-3 py-1.5 font-medium text-right">Quantity</th>
                <th className="px-3 py-1.5 font-medium text-right">Price</th>
                <th className="px-3 py-1.5 font-medium text-right">Price Change</th>
                <th className="px-3 py-1.5 font-medium text-right">$ Market Value</th>
                <th className="px-3 py-1.5 font-medium text-right">Day Change</th>
                <th className="px-3 py-1.5 font-medium text-right">Cost Basis</th>
                <th className="px-3 py-1.5 font-medium text-right">Gain/Loss $</th>
                <th className="px-3 py-1.5 font-medium text-right">Gain/Loss %</th>
                <th className="px-3 py-1.5 font-medium text-right">% of Holdings</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const pctOfHoldings = totalMV > 0 && h.market_value ? (h.market_value / totalMV) * 100 : null;
                const gl = h.unrealized_gain_loss;
                const glPct = h.unrealized_gain_loss_pct;
                return (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-emerald-700">{h.security?.ticker_symbol || "–"}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{h.security?.name || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmtQty(h.quantity)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmt(h.price)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">–</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">{fmt(h.market_value)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">–</td>
                    <td className="px-3 py-2 text-right text-slate-700">{fmt(h.cost_basis)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${changeColor(gl)}`}>
                      {fmt(gl)}
                    </td>
                    <td className={`px-3 py-2 text-right ${changeColor(glPct)}`}>
                      {fmtPct(glPct)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {pctOfHoldings != null ? `${pctOfHoldings.toFixed(1)}%` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/50 text-[11px] font-semibold">
                <td className="px-4 py-1.5 text-slate-600">Account Total</td>
                <td></td><td></td><td></td>
                <td className="px-3 py-1.5 text-right text-slate-900">{fmt(totalMV)}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">–</td>
                <td className="px-3 py-1.5 text-right text-slate-700">{fmt(totalCB)}</td>
                <td className={`px-3 py-1.5 text-right ${changeColor(totalGL)}`}>{fmt(totalGL)}</td>
                <td className={`px-3 py-1.5 text-right ${changeColor(totalGL)}`}>
                  {totalCB > 0 ? fmtPct((totalGL / totalCB) * 100) : "–"}
                </td>
                <td className="px-3 py-1.5 text-right text-slate-600">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Customize Settings Modal
// ============================================================

function CustomizeSettingsModal({
  accounts, groups, onClose,
}: {
  accounts: Account[];
  groups: AccountGroup[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"accounts" | "grouped" | "ungrouped">("grouped");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Customize Settings</h3>
          <div className="flex gap-4 mt-3">
            {(["accounts", "grouped", "ungrouped"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-[12px] font-medium pb-1 border-b-2 ${
                  tab === t ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"
                }`}>
                {t === "accounts" ? "Hide Accounts" : t === "grouped" ? "Grouped" : "Ungrouped"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {tab === "grouped" && groups.map((g) => (
            <div key={g.name} className="mb-4">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">{g.name}</div>
              {g.accounts.map((acct) => (
                <div key={acct.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50">
                  <span className="text-slate-400 cursor-grab">&#9776;</span>
                  <span className={`w-2 h-2 rounded-full ${acct.connection_type === "api" ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <span className="text-[12px] text-slate-800 flex-1">
                    {acct.display_name || acct.account_number_masked}
                  </span>
                  <span className="text-[10px] text-slate-400">{typeLabel(acct.account_type)}</span>
                </div>
              ))}
            </div>
          ))}

          {tab === "accounts" && (
            <div className="space-y-1">
              {accounts.map((acct) => (
                <div key={acct.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50">
                  <input type="checkbox" defaultChecked className="accent-emerald-600 w-3.5 h-3.5" />
                  <span className="text-[12px] text-slate-800 flex-1">
                    {acct.display_name || acct.account_number_masked}
                  </span>
                  <span className="text-[10px] text-slate-400">{acct.account_number_masked}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "ungrouped" && (
            <div className="space-y-1">
              {accounts.map((acct) => (
                <div key={acct.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50">
                  <span className="text-slate-400 cursor-grab">&#9776;</span>
                  <span className="text-[12px] text-slate-800 flex-1">
                    {acct.display_name || acct.account_number_masked}
                  </span>
                  <span className="text-[10px] text-slate-400">{typeLabel(acct.account_type)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Add a Group section */}
          {tab === "grouped" && (
            <div className="mt-4 pt-3 border-t border-slate-200">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Add a Group</div>
              <div className="flex gap-2">
                <input type="text" placeholder="Group Name"
                  className="flex-1 px-2 py-1 text-[12px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <button className="px-3 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700">
                  Create Group
                </button>
              </div>
            </div>
          )}

          {/* External accounts */}
          <div className="mt-4 pt-3 border-t border-slate-200">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">External Accounts</div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <input type="checkbox" defaultChecked className="accent-emerald-600 w-3.5 h-3.5" />
              <span>Show &quot;Add non-Schwab account&quot; row</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
