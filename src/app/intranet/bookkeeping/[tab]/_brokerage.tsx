"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const SCHWAB_OAUTH_WORKER = "https://schwab-oauth.finleg.workers.dev";
const FONT = 'Arial, Helvetica, sans-serif';

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

interface BalanceSnapshot {
  snapshot_date: string;
  total_value: number | null;
  account_id: string;
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

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true,
    month: "2-digit", day: "2-digit", year: "numeric",
  }) : "";

// ============================================================
// Color helpers
// ============================================================

function changeColor(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "color: #067a46" : "color: #d32f2f";
}

function changeColorClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "pos" : "neg";
}

// ============================================================
// Shared inline styles (Schwab-exact measurements)
// ============================================================

const S = {
  // Table header cell
  th: {
    padding: "8px 12px",
    fontSize: "11px",
    fontWeight: 600 as const,
    color: "#555",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    borderBottom: "2px solid #ddd",
    fontFamily: FONT,
    lineHeight: "16px",
    whiteSpace: "nowrap" as const,
  },
  // Table data cell
  td: {
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 400 as const,
    color: "#333",
    fontFamily: FONT,
    lineHeight: "18px",
    borderBottom: "1px solid #eee",
    verticalAlign: "top" as const,
  },
  // Group header row
  groupHeader: {
    padding: "10px 12px",
    fontSize: "14px",
    fontWeight: 700 as const,
    color: "#1a1a1a",
    fontFamily: FONT,
    borderBottom: "1px solid #ddd",
    cursor: "pointer",
    backgroundColor: "#fff",
  },
  // Group subtotal row
  groupSubtotal: {
    padding: "8px 12px",
    fontSize: "13px",
    fontWeight: 600 as const,
    color: "#333",
    fontFamily: FONT,
    borderBottom: "2px solid #ddd",
    backgroundColor: "#fafafa",
  },
  // Footer total row
  footerTotal: {
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 700 as const,
    color: "#1a1a1a",
    fontFamily: FONT,
    borderTop: "2px solid #bbb",
    backgroundColor: "#f5f5f5",
  },
  // Section title
  sectionTitle: {
    fontSize: "20px",
    fontWeight: 700 as const,
    color: "#1a1a1a",
    fontFamily: FONT,
    margin: 0,
    lineHeight: "28px",
  },
  // Small info text
  infoText: {
    fontSize: "11px",
    color: "#888",
    fontFamily: FONT,
    lineHeight: "16px",
  },
};

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
  const [showSettings, setShowSettings] = useState(false);
  const [totalValueExpanded, setTotalValueExpanded] = useState(true);
  const [chartRange, setChartRange] = useState("1M");
  const [chartView, setChartView] = useState<"chart" | "table">("table");
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnapshot[]>([]);

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

    // Fetch balance history for chart/table
    if (accts?.length) {
      const { data: balances } = await supabase
        .from("account_balances")
        .select("snapshot_date, total_value, account_id")
        .in("account_id", accts.map((a: Account) => a.id))
        .order("snapshot_date", { ascending: true });
      if (balances) setBalanceHistory(balances as BalanceSnapshot[]);
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
    return <div style={{ padding: 32, textAlign: "center", color: "#888", fontFamily: FONT, fontSize: 14 }}>Loading...</div>;
  }

  const totalValue = accounts.reduce((s, a) => s + (a.total_value || a.balance_current || 0), 0);
  const totalCash = accounts.reduce((s, a) => s + (a.cash_balance || 0), 0);
  const groups = groupAccounts(accounts);
  const totalHoldingsCount = Object.values(holdings).reduce((s, h) => s + h.length, 0);
  const accountsWithHoldings = accounts.filter((a) => holdings[a.id]?.length);
  const includedCount = accounts.length;

  return (
    <div style={{ maxWidth: 1400, fontFamily: FONT, fontFeatureSettings: "'tnum'", color: "#333" }}>

      {/* ============ PAGE TITLE + SYNC CONTROLS ============ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ ...S.sectionTitle, fontSize: 24, marginBottom: 0 }}>Summary</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastSync?.at && <span style={{ fontSize: 12, color: "#999" }}>Updated: {fmtDate(lastSync.at)}</span>}
          {status?.connected ? (
            <>
              <button onClick={handleSync} disabled={syncing} style={{
                width: 24, height: 24, borderRadius: "50%", border: "1px solid #ccc", background: "#fff",
                cursor: syncing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: syncing ? "#999" : "#555",
              }} title="Refresh">
                &#8635;
              </button>
              <button onClick={handleConnect} style={{
                padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 3,
                background: "#0d7a3e", color: "#fff", border: "none", cursor: "pointer",
              }}>
                Connect Schwab
              </button>
            </>
          ) : (
            <button onClick={handleConnect} style={{
              padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 3,
              background: "#0d7a3e", color: "#fff", border: "none", cursor: "pointer",
            }}>
              Connect Schwab
            </button>
          )}
        </div>
      </div>

      {/* Expiry warning */}
      {status?.connected && status.refreshTokenExpiresAt && (() => {
        const daysLeft = Math.ceil((new Date(status.refreshTokenExpiresAt).getTime() - Date.now()) / 86400000);
        return daysLeft <= 2 ? (
          <div style={{ padding: "8px 12px", borderRadius: 3, border: "1px solid #f59e0b", background: "#fffbeb", fontSize: 12, color: "#92400e", marginBottom: 8 }}>
            Schwab connection expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}. Re-authenticate to maintain sync.
          </div>
        ) : null;
      })()}

      {/* ============ TOTAL VALUE + CHART ============ */}
      <div style={{ border: "1px solid #ddd", borderRadius: 4, background: "#fff", marginBottom: 16 }}>
        {/* Collapsible header */}
        <div
          onClick={() => setTotalValueExpanded((p) => !p)}
          style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderBottom: totalValueExpanded ? "1px solid #eee" : "none" }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1a", fontFamily: FONT }}>Total Value</span>
          <span style={{ fontSize: 12, color: "#888" }}>{totalValueExpanded ? "▲" : "▼"}</span>
        </div>

        {totalValueExpanded && (
          <div style={{ padding: "16px 20px" }}>
            {/* Metrics row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 40, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#666", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  Total Value
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "#0d7a3e", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>i</span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a", lineHeight: "36px" }}>{fmt(totalValue)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#666", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
                  Day Change
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "#0d7a3e", color: "#fff", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>i</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#888" }}>–</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#666", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                  1-Month Change
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#888" }}>–</div>
              </div>
            </div>

            {/* Time period buttons + Table/Chart toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
              <button
                onClick={() => setChartView(chartView === "table" ? "chart" : "table")}
                style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 4, marginRight: 8, border: chartView === "table" ? "2px solid #0d7a3e" : "1px solid #ccc", color: chartView === "table" ? "#0d7a3e" : "#555" }}
              >
                <span style={{ fontSize: 11 }}>{chartView === "table" ? "▤" : "◻"}</span>
                {chartView === "table" ? "Table View" : "Chart View"}
              </button>
              {(["1M", "3M", "6M", "YTD", "1Y", "2Y"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  style={{
                    width: 36, height: 28, borderRadius: 14, fontSize: 11, fontWeight: 600,
                    fontFamily: FONT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    border: chartRange === r ? "2px solid #0d7a3e" : "1px solid #ccc",
                    background: "#fff",
                    color: chartRange === r ? "#0d7a3e" : "#555",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* Chart or Table — real data from account_balances */}
            <TotalValueDisplay
              accounts={accounts}
              balanceHistory={balanceHistory}
              chartRange={chartRange}
              chartView={chartView}
              totalValue={totalValue}
            />
          </div>
        )}
      </div>

      {/* ============ NOT CONNECTED ============ */}
      {!status?.connected && accounts.length === 0 && (
        <div style={{ border: "1px solid #ddd", borderRadius: 4, background: "#fff", padding: "48px 24px", textAlign: "center" }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>Connect Your Schwab Account</h3>
          <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>Link your Charles Schwab brokerage to view accounts, positions, and balances.</p>
          <button onClick={handleConnect} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 3, background: "#0d7a3e", color: "#fff", border: "none", cursor: "pointer" }}>
            Connect Schwab
          </button>
        </div>
      )}

      {/* ============ ACCOUNTS TABLE ============ */}
      {accounts.length > 0 && (
        <div style={{ border: "1px solid #ddd", borderRadius: 4, background: "#fff", marginBottom: 16, overflow: "hidden" }}>
          {/* Section header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ ...S.sectionTitle, fontSize: 16 }}>Accounts</h2>
              <div style={S.infoText}>{includedCount} of {accounts.length} accounts included in Total Value</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#0d7a3e", fontSize: 14 }}>&#9432;</span> FDIC Disclosures
              </button>
              <button style={btnStyle}>Additional Info</button>
              <button onClick={() => setShowSettings(true)} style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 3 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Accounts table */}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left", minWidth: 220 }}>Account Name</th>
                <th style={{ ...S.th, textAlign: "left", width: 110 }}>Type</th>
                <th style={{ ...S.th, textAlign: "right", width: 160 }}>Cash &amp; Cash Investments</th>
                <th style={{ ...S.th, textAlign: "right", width: 140 }}>Account Value</th>
                <th style={{ ...S.th, textAlign: "right", width: 120 }}>Day Change $</th>
                <th style={{ ...S.th, textAlign: "right", width: 110 }}>Day Change %</th>
                <th style={{ ...S.th, textAlign: "center", width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const expanded = expandedGroups[group.name] ?? true;
                const groupValue = group.accounts.reduce((s, a) => s + (a.total_value || a.balance_current || 0), 0);
                const groupCash = group.accounts.reduce((s, a) => s + (a.cash_balance || 0), 0);

                return (
                  <GroupRows
                    key={group.name}
                    group={group}
                    expanded={expanded}
                    groupValue={groupValue}
                    groupCash={groupCash}
                    holdings={holdings}
                    onToggle={() => setExpandedGroups((p) => ({ ...p, [group.name]: !p[group.name] }))}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...S.footerTotal, textAlign: "left" }} colSpan={2}>All Accounts Total</td>
                <td style={{ ...S.footerTotal, textAlign: "right" }}>{fmt(totalCash)}</td>
                <td style={{ ...S.footerTotal, textAlign: "right" }}>{fmt(totalValue)}</td>
                <td style={{ ...S.footerTotal, textAlign: "right", color: "#888" }}>–</td>
                <td style={{ ...S.footerTotal, textAlign: "right", color: "#888" }}>–</td>
                <td style={S.footerTotal}></td>
              </tr>
            </tfoot>
          </table>

          {/* Add a Non-Schwab Account link */}
          <div style={{ padding: "10px 16px", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16, color: "#0d7a3e", fontWeight: 700 }}>+</span>
            <span style={{ fontSize: 13, color: "#0d7a3e", fontWeight: 600, cursor: "pointer" }}>Add a Non-Schwab Account</span>
          </div>
        </div>
      )}

      {/* ============ POSITIONS SECTION ============ */}
      {totalHoldingsCount > 0 && (
        <div style={{ border: "1px solid #ddd", borderRadius: 4, background: "#fff", marginBottom: 16, overflow: "hidden" }}>
          {/* Section header */}
          <div style={{ padding: "16px 16px 12px" }}>
            <h2 style={{ ...S.sectionTitle, fontSize: 18, marginBottom: 8 }}>Positions</h2>
            {/* Equities sub-section */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#1a1a1a", cursor: "pointer" }}>
              <span style={{ fontSize: 10, color: "#666" }}>&#9660;</span>
              Equities
              <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>({totalHoldingsCount})</span>
            </div>
          </div>

          {/* Positions table */}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left", minWidth: 160 }}>Symbol / Name</th>
                <th style={{ ...S.th, textAlign: "right", width: 90 }}>Quantity</th>
                <th style={{ ...S.th, textAlign: "right", width: 90 }}>Price</th>
                <th style={{ ...S.th, textAlign: "right", width: 100 }}>Price Change</th>
                <th style={{ ...S.th, textAlign: "right", width: 120 }}>$ Market Value</th>
                <th style={{ ...S.th, textAlign: "right", width: 110 }}>Day Change</th>
                <th style={{ ...S.th, textAlign: "right", width: 110 }}>Cost Basis</th>
                <th style={{ ...S.th, textAlign: "right", width: 100 }}>Gain/Loss $</th>
                <th style={{ ...S.th, textAlign: "right", width: 100 }}>Gain/Loss %</th>
                <th style={{ ...S.th, textAlign: "right", width: 80 }}>% of Acct</th>
                <th style={{ ...S.th, textAlign: "center", width: 60 }}>Reinvest?</th>
              </tr>
            </thead>
            <tbody>
              {accountsWithHoldings.map((acct) => {
                const acctHoldings = holdings[acct.id] || [];
                const expanded = expandedPositionAccounts[acct.id] ?? true;
                const totalMV = acctHoldings.reduce((s, h) => s + (h.market_value || 0), 0);
                const totalCB = acctHoldings.reduce((s, h) => s + (h.cost_basis || 0), 0);
                const totalGL = acctHoldings.reduce((s, h) => s + (h.unrealized_gain_loss || 0), 0);

                return (
                  <PositionRows
                    key={acct.id}
                    account={acct}
                    holdings={acctHoldings}
                    expanded={expanded}
                    totalMV={totalMV}
                    totalCB={totalCB}
                    totalGL={totalGL}
                    onToggle={() => setExpandedPositionAccounts((p) => ({ ...p, [acct.id]: !(p[acct.id] ?? true) }))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ BOTTOM STATUS BAR (Schwab-style dark footer) ============ */}
      <div style={{
        background: "#1a3a2a", color: "#fff", borderRadius: 4, padding: "8px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 12, fontFamily: FONT, fontWeight: 500,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span>{accounts.length} Accounts</span>
          <span>Assets: {fmt(totalValue)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span>Cash: {fmt(totalCash)}</span>
          <span>Loans/Margin: –</span>
          <span style={{ fontWeight: 700 }}>Total Value: {fmt(totalValue)}</span>
          <span>Positions: {totalHoldingsCount}</span>
        </div>
      </div>

      {/* ============ SETTINGS MODAL ============ */}
      {showSettings && (
        <SettingsModal
          accounts={accounts}
          groups={groups}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Button style helper
// ============================================================

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 3,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#555",
  cursor: "pointer",
  fontFamily: FONT,
};

// ============================================================
// Group Rows (accounts table)
// ============================================================

function GroupRows({
  group, expanded, groupValue, groupCash, holdings, onToggle,
}: {
  group: AccountGroup;
  expanded: boolean;
  groupValue: number;
  groupCash: number;
  holdings: Record<string, Holding[]>;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Group header */}
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td colSpan={7} style={{ ...S.groupHeader, borderLeft: "3px solid #0d7a3e" }}>
          <span style={{ display: "inline-block", width: 14, fontSize: 9, color: "#666", marginRight: 4 }}>
            {expanded ? "▼" : "▶"}
          </span>
          {group.name}
        </td>
      </tr>

      {/* Account rows */}
      {expanded && group.accounts.map((acct, idx) => {
        const value = acct.total_value || acct.balance_current || 0;
        const hasHoldings = (holdings[acct.id]?.length || 0) > 0;
        const rowBg = idx % 2 === 1 ? "#f8f8f8" : "#fff";
        return (
          <tr key={acct.id} style={{ background: rowBg }} onMouseOver={(e) => (e.currentTarget.style.background = "#f0f7f2")} onMouseOut={(e) => (e.currentTarget.style.background = rowBg)}>
            <td style={S.td}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                {acct.connection_type === "api" ? (
                  <span style={{ marginTop: 4, width: 7, height: 7, borderRadius: "50%", background: "#0d7a3e", flexShrink: 0 }} />
                ) : (
                  <span style={{ marginTop: 4, width: 7, height: 7, borderRadius: "50%", background: "#ccc", flexShrink: 0 }} />
                )}
                <div>
                  <div style={{ fontWeight: 400, color: "#1a1a1a" }}>
                    {acct.display_name || acct.account_number_masked}
                    {" "}
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 13, height: 13, borderRadius: "50%", background: "#0d7a3e", color: "#fff", fontSize: 8, fontWeight: 700, cursor: "pointer", verticalAlign: "middle" }}>i</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>
                    {acct.account_number_masked}
                    {acct.account_holder ? ` · ${acct.account_holder}` : ""}
                  </div>
                </div>
              </div>
            </td>
            <td style={{ ...S.td, color: "#555" }}>{typeLabel(acct.account_type)}</td>
            <td style={{ ...S.td, textAlign: "right", color: "#555" }}>{acct.cash_balance != null ? fmt(acct.cash_balance) : "–"}</td>
            <td style={{ ...S.td, textAlign: "right", fontWeight: 500, color: "#1a1a1a" }}>{value ? fmt(value) : "–"}</td>
            <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
            <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
            <td style={{ ...S.td, textAlign: "center" }}>
              {hasHoldings && <span style={{ fontSize: 12, color: "#0d7a3e", fontWeight: 600, cursor: "pointer" }}>More</span>}
            </td>
          </tr>
        );
      })}

      {/* Group subtotal */}
      {expanded && (
        <tr>
          <td style={{ ...S.groupSubtotal, paddingLeft: 28 }} colSpan={2}>{group.name} Total</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>{fmt(groupCash)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#1a1a1a" }}>{fmt(groupValue)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#888" }}>–</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#888" }}>–</td>
          <td style={S.groupSubtotal}></td>
        </tr>
      )}
    </>
  );
}

// ============================================================
// Position Rows (positions table)
// ============================================================

function PositionRows({
  account, holdings, expanded, totalMV, totalCB, totalGL, onToggle,
}: {
  account: Account;
  holdings: Holding[];
  expanded: boolean;
  totalMV: number;
  totalCB: number;
  totalGL: number;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Account header row in positions */}
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td colSpan={11} style={{ ...S.groupHeader, fontSize: 13 }}>
          <span style={{ display: "inline-block", width: 14, fontSize: 9, color: "#666", marginRight: 4 }}>
            {expanded ? "▼" : "▶"}
          </span>
          <span style={{ fontWeight: 600 }}>{account.display_name || account.account_number_masked}</span>
          <span style={{ marginLeft: 16, fontSize: 12, fontWeight: 400, color: "#888" }}>{holdings.length} positions</span>
          <span style={{ marginLeft: 16, fontSize: 13, fontWeight: 600 }}>{fmt(totalMV)}</span>
          {totalGL !== 0 && (
            <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 600, ...(totalGL >= 0 ? { color: "#067a46" } : { color: "#d32f2f" }) }}>
              {fmt(totalGL)}
            </span>
          )}
        </td>
      </tr>

      {/* Holding rows */}
      {expanded && holdings.map((h, idx) => {
        const pctOfAcct = totalMV > 0 && h.market_value ? (h.market_value / totalMV) * 100 : null;
        const gl = h.unrealized_gain_loss;
        const glPct = h.unrealized_gain_loss_pct;
        const rowBg = idx % 2 === 1 ? "#f8f8f8" : "#fff";
        return (
          <tr key={h.id} style={{ background: rowBg }} onMouseOver={(e) => (e.currentTarget.style.background = "#f0f7f2")} onMouseOut={(e) => (e.currentTarget.style.background = rowBg)}>
            <td style={{ ...S.td, paddingLeft: 28 }}>
              <div style={{ fontWeight: 600, color: "#0d7a3e", fontSize: 13 }}>{h.security?.ticker_symbol || "–"}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 1, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.security?.name || ""}</div>
            </td>
            <td style={{ ...S.td, textAlign: "right" }}>{fmtQty(h.quantity)}</td>
            <td style={{ ...S.td, textAlign: "right" }}>{fmt(h.price)}</td>
            <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
            <td style={{ ...S.td, textAlign: "right", fontWeight: 500 }}>{fmt(h.market_value)}</td>
            <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
            <td style={{ ...S.td, textAlign: "right" }}>{fmt(h.cost_basis)}</td>
            <td style={{ ...S.td, textAlign: "right", fontWeight: 500, ...(gl != null && gl !== 0 ? (gl > 0 ? { color: "#067a46" } : { color: "#d32f2f" }) : {}) }}>
              {fmt(gl)}
            </td>
            <td style={{ ...S.td, textAlign: "right", ...(glPct != null && glPct !== 0 ? (glPct > 0 ? { color: "#067a46" } : { color: "#d32f2f" }) : {}) }}>
              {fmtPct(glPct)}
            </td>
            <td style={{ ...S.td, textAlign: "right", color: "#555" }}>
              {pctOfAcct != null ? `${pctOfAcct.toFixed(1)}%` : "–"}
            </td>
            <td style={{ ...S.td, textAlign: "center", color: "#888", fontSize: 12 }}>No</td>
          </tr>
        );
      })}

      {/* Account total row in positions */}
      {expanded && (
        <tr>
          <td style={{ ...S.groupSubtotal, paddingLeft: 28 }}>Account Total</td>
          <td style={S.groupSubtotal}></td>
          <td style={S.groupSubtotal}></td>
          <td style={S.groupSubtotal}></td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>{fmt(totalMV)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#888" }}>–</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>{fmt(totalCB)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", ...(totalGL >= 0 ? { color: "#067a46" } : { color: "#d32f2f" }) }}>{fmt(totalGL)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", ...(totalGL >= 0 ? { color: "#067a46" } : { color: "#d32f2f" }) }}>
            {totalCB > 0 ? fmtPct((totalGL / totalCB) * 100) : "–"}
          </td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>100%</td>
          <td style={S.groupSubtotal}></td>
        </tr>
      )}
    </>
  );
}

// ============================================================
// Total Value Display — Table or Chart with real data
// ============================================================

const RANGE_DAYS: Record<string, number> = { "1M": 30, "3M": 90, "6M": 180, "YTD": 0, "1Y": 365, "2Y": 730 };

function getRangeDays(range: string): number {
  if (range === "YTD") {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.ceil((now.getTime() - jan1.getTime()) / 86400000);
  }
  return RANGE_DAYS[range] || 30;
}

function filterByRange(snapshots: BalanceSnapshot[], range: string): BalanceSnapshot[] {
  const days = getRangeDays(range);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  return snapshots.filter((s) => s.snapshot_date >= cutoffStr);
}

function TotalValueDisplay({
  accounts,
  balanceHistory,
  chartRange,
  chartView,
  totalValue,
}: {
  accounts: Account[];
  balanceHistory: BalanceSnapshot[];
  chartRange: string;
  chartView: "chart" | "table";
  totalValue: number;
}) {
  const filtered = filterByRange(balanceHistory, chartRange);

  // Group by date, summing total_value across all accounts
  const dateMap = new Map<string, { total: number; byAccount: Map<string, number> }>();
  for (const snap of filtered) {
    if (!dateMap.has(snap.snapshot_date)) {
      dateMap.set(snap.snapshot_date, { total: 0, byAccount: new Map() });
    }
    const entry = dateMap.get(snap.snapshot_date)!;
    const val = snap.total_value || 0;
    entry.total += val;
    entry.byAccount.set(snap.account_id, val);
  }

  const sortedDates = [...dateMap.keys()].sort();

  // Build account lookup for display names — only include accounts with balance data
  const accountsWithData = accounts.filter((a) => {
    return filtered.some((s) => s.account_id === a.id && s.total_value != null);
  });

  if (sortedDates.length === 0) {
    // No historical data — show current snapshot as single row
    const today = new Date().toISOString().split("T")[0];
    return (
      <div>
        {chartView === "table" ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left" }}>Date</th>
                {accounts.filter((a) => (a.total_value || a.balance_current || 0) > 0).map((a) => (
                  <th key={a.id} style={{ ...S.th, textAlign: "right" }}>
                    {a.display_name || a.account_number_masked}
                  </th>
                ))}
                <th style={{ ...S.th, textAlign: "right", fontWeight: 700 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.td}>{today}</td>
                {accounts.filter((a) => (a.total_value || a.balance_current || 0) > 0).map((a) => (
                  <td key={a.id} style={{ ...S.td, textAlign: "right" }}>
                    {fmt(a.total_value || a.balance_current)}
                  </td>
                ))}
                <td style={{ ...S.td, textAlign: "right", fontWeight: 700 }}>{fmt(totalValue)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: "#999", fontSize: 13 }}>
            No historical data yet. Run daily syncs to build chart history.
          </div>
        )}
      </div>
    );
  }

  if (chartView === "table") {
    return (
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...S.th, textAlign: "left", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>Date</th>
              {accountsWithData.map((a) => (
                <th key={a.id} style={{ ...S.th, textAlign: "right", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
                  {a.display_name || a.account_number_masked}
                </th>
              ))}
              <th style={{ ...S.th, textAlign: "right", fontWeight: 700, position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {[...sortedDates].reverse().map((date, idx) => {
              const entry = dateMap.get(date)!;
              const rowBg = idx % 2 === 1 ? "#f8f8f8" : "#fff";
              return (
                <tr key={date} style={{ background: rowBg }}>
                  <td style={S.td}>{new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                  {accountsWithData.map((a) => (
                    <td key={a.id} style={{ ...S.td, textAlign: "right" }}>
                      {entry.byAccount.has(a.id) ? fmt(entry.byAccount.get(a.id)!) : "–"}
                    </td>
                  ))}
                  <td style={{ ...S.td, textAlign: "right", fontWeight: 600 }}>{fmt(entry.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Chart view — SVG with real data points
  const chartW = 900;
  const chartH = 200;
  const marginR = 60;
  const marginB = 30;
  const values = sortedDates.map((d) => dateMap.get(d)!.total);
  const minVal = Math.min(...values) * 0.998;
  const maxVal = Math.max(...values) * 1.002;
  const range = maxVal - minVal || 1;

  const points = sortedDates.map((_, i) => {
    const x = (i / Math.max(sortedDates.length - 1, 1)) * (chartW - marginR);
    const y = (chartH - marginB) - ((values[i] - minVal) / range) * (chartH - marginB - 10);
    return [x, y] as [number, number];
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const fillPath = `${linePath} V${chartH - marginB} H0 Z`;

  // Y-axis labels
  const yLabels = [0, 0.33, 0.66, 1].map((frac) => {
    const val = minVal + frac * range;
    if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  });

  // X-axis: show ~8 evenly spaced date labels
  const xTickCount = Math.min(sortedDates.length, 8);
  const xStep = Math.max(1, Math.floor(sortedDates.length / xTickCount));

  return (
    <svg viewBox={`0 0 ${chartW} ${chartH + 5}`} style={{ width: "100%", height: 250, display: "block" }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d7a3e" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#0d7a3e" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((frac, i) => (
        <line key={i} x1={0} y1={(chartH - marginB) * frac} x2={chartW - marginR} y2={(chartH - marginB) * frac} stroke="#eee" strokeWidth="1" strokeDasharray="4 3" />
      ))}
      <line x1={0} y1={chartH - marginB} x2={chartW - marginR} y2={chartH - marginB} stroke="#ddd" strokeWidth="1" />
      <path d={fillPath} fill="url(#chartFill)" />
      <path d={linePath} fill="none" stroke="#0d7a3e" strokeWidth="1.5" />
      {sortedDates.filter((_, i) => i % xStep === 0 || i === sortedDates.length - 1).map((date, i) => {
        const idx = sortedDates.indexOf(date);
        const x = (idx / Math.max(sortedDates.length - 1, 1)) * (chartW - marginR);
        return (
          <text key={i} x={x} y={chartH - marginB + 18} textAnchor="middle" style={{ fontSize: 10, fill: "#999", fontFamily: FONT }}>
            {new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>
        );
      })}
      {yLabels.map((label, i) => (
        <text key={i} x={chartW - marginR + 8} y={(chartH - marginB) * (1 - i / (yLabels.length - 1)) + 3} textAnchor="start" style={{ fontSize: 10, fill: "#999", fontFamily: FONT }}>
          {label}
        </text>
      ))}
    </svg>
  );
}

// ============================================================
// Settings Modal
// ============================================================

function SettingsModal({
  accounts, groups, onClose,
}: {
  accounts: Account[];
  groups: AccountGroup[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"accounts" | "grouped" | "ungrouped">("grouped");

  const modalBg: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 50,
    display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 80,
    background: "rgba(0,0,0,0.4)",
  };
  const modalBox: React.CSSProperties = {
    background: "#fff", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    width: 480, maxHeight: "70vh", display: "flex", flexDirection: "column", fontFamily: FONT,
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #ddd" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>Customize Settings</h3>
          <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
            {(["accounts", "grouped", "ungrouped"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                fontSize: 12, fontWeight: 600, padding: "0 0 8px", background: "none", border: "none", cursor: "pointer",
                borderBottom: tab === t ? "2px solid #0d7a3e" : "2px solid transparent",
                color: tab === t ? "#0d7a3e" : "#888", fontFamily: FONT,
              }}>
                {t === "accounts" ? "Hide Accounts" : t === "grouped" ? "Grouped" : "Ungrouped"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {tab === "grouped" && groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{g.name}</div>
              {g.accounts.map((acct) => (
                <div key={acct.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 3, cursor: "grab" }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f5f5f5")} onMouseOut={(e) => (e.currentTarget.style.background = "")}>
                  <span style={{ color: "#bbb", fontSize: 14 }}>&#9776;</span>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: acct.connection_type === "api" ? "#0d7a3e" : "#ccc" }} />
                  <span style={{ fontSize: 12, color: "#333", flex: 1 }}>{acct.display_name || acct.account_number_masked}</span>
                  <span style={{ fontSize: 10, color: "#999" }}>{typeLabel(acct.account_type)}</span>
                </div>
              ))}
            </div>
          ))}

          {tab === "accounts" && accounts.map((acct) => (
            <div key={acct.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 3 }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#f5f5f5")} onMouseOut={(e) => (e.currentTarget.style.background = "")}>
              <input type="checkbox" defaultChecked style={{ accentColor: "#0d7a3e", width: 14, height: 14 }} />
              <span style={{ fontSize: 12, color: "#333", flex: 1 }}>{acct.display_name || acct.account_number_masked}</span>
              <span style={{ fontSize: 10, color: "#999" }}>{acct.account_number_masked}</span>
            </div>
          ))}

          {tab === "ungrouped" && accounts.map((acct) => (
            <div key={acct.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 3, cursor: "grab" }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#f5f5f5")} onMouseOut={(e) => (e.currentTarget.style.background = "")}>
              <span style={{ color: "#bbb", fontSize: 14 }}>&#9776;</span>
              <span style={{ fontSize: 12, color: "#333", flex: 1 }}>{acct.display_name || acct.account_number_masked}</span>
              <span style={{ fontSize: 10, color: "#999" }}>{typeLabel(acct.account_type)}</span>
            </div>
          ))}

          {/* Add a Group */}
          {tab === "grouped" && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Add a Group</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="text" placeholder="Group Name" style={{
                  flex: 1, padding: "5px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 3,
                  fontFamily: FONT, outline: "none",
                }} />
                <button style={{ ...btnStyle, background: "#0d7a3e", color: "#fff", border: "none" }}>Create Group</button>
              </div>
            </div>
          )}

          {/* External accounts */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>External Accounts</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#555" }}>
              <input type="checkbox" defaultChecked style={{ accentColor: "#0d7a3e", width: 14, height: 14 }} />
              Show &ldquo;Add non-Schwab account&rdquo; row
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #ddd", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnStyle}>Cancel</button>
          <button onClick={onClose} style={{ ...btnStyle, background: "#0d7a3e", color: "#fff", border: "none" }}>Save</button>
        </div>
      </div>
    </div>
  );
}
