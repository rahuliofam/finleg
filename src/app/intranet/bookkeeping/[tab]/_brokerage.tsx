"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import GroupRows from "./_brokerage/GroupRows";
import PositionRows from "./_brokerage/PositionRows";
import SettingsModal from "./_brokerage/SettingsModal";
import TotalValueDisplay from "./_brokerage/TotalValueDisplay";
import { fmt, fmtDate, groupAccounts } from "./_brokerage/helpers";
import { FONT, S, btnStyle } from "./_brokerage/styles";
import type {
  Account,
  BalanceSnapshot,
  ConnectionStatus,
  Holding,
} from "./_brokerage/types";

const SCHWAB_OAUTH_WORKER = "https://schwab-oauth.finleg.workers.dev";

export default function BrokerageTab() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Record<string, Holding[]>>({});
  const [lastSync, setLastSync] = useState<{ at: string; status: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedPositionAccounts, setExpandedPositionAccounts] = useState<
    Record<string, boolean>
  >({});
  const [showSettings, setShowSettings] = useState(false);
  const [totalValueExpanded, setTotalValueExpanded] = useState(true);
  const [chartRange, setChartRange] = useState("1M");
  const [chartView, setChartView] = useState<"chart" | "table">("table");
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnapshot[]>([]);

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
      const refreshExpires = tokenRow.refresh_token_expires_at
        ? new Date(tokenRow.refresh_token_expires_at)
        : null;
      setStatus({
        connected: !refreshExpires || new Date() < refreshExpires,
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
      .eq("institution_id", institution.id)
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    if (syncData) setLastSync({ at: syncData.completed_at, status: syncData.status });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.functions.invoke("schwab-sync", {
        body: {
          syncType: "manual",
          triggeredBy: `admin:${session.user.email}`,
          includeTransactions: true,
        },
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
    if (!confirm("Disconnect Schwab? Existing data will be preserved but no new syncs will run."))
      return;
    const { data: institution } = await supabase
      .from("institutions")
      .select("id")
      .eq("name", "Charles Schwab")
      .single();
    if (institution)
      await supabase.from("oauth_tokens").update({ status: "revoked" }).eq("institution_id", institution.id);
    setStatus({ connected: false });
  };
  void handleDisconnect; // preserved for future UI; not currently wired

  if (loading) {
    return (
      <div
        style={{ padding: 32, textAlign: "center", color: "#888", fontFamily: FONT, fontSize: 14 }}
      >
        Loading...
      </div>
    );
  }

  const totalValue = accounts.reduce(
    (s, a) => s + (a.total_value || a.balance_current || 0),
    0,
  );
  const totalCash = accounts.reduce((s, a) => s + (a.cash_balance || 0), 0);
  const groups = groupAccounts(accounts);
  const totalHoldingsCount = Object.values(holdings).reduce((s, h) => s + h.length, 0);
  const accountsWithHoldings = accounts.filter((a) => holdings[a.id]?.length);
  const includedCount = accounts.length;

  return (
    <div
      style={{
        maxWidth: 1400,
        fontFamily: FONT,
        fontFeatureSettings: "'tnum'",
        color: "#333",
      }}
    >
      {/* ============ PAGE TITLE + SYNC CONTROLS ============ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h1 style={{ ...S.sectionTitle, fontSize: 24, marginBottom: 0 }}>Summary</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastSync?.at && (
            <span style={{ fontSize: 12, color: "#999" }}>Updated: {fmtDate(lastSync.at)}</span>
          )}
          {status?.connected ? (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "1px solid #ccc",
                  background: "#fff",
                  cursor: syncing ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  color: syncing ? "#999" : "#555",
                }}
                title="Refresh"
              >
                &#8635;
              </button>
              <button
                onClick={handleConnect}
                style={{
                  padding: "5px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 3,
                  background: "#0d7a3e",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Connect Schwab
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              style={{
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 3,
                background: "#0d7a3e",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              Connect Schwab
            </button>
          )}
        </div>
      </div>

      {/* Expiry warning */}
      {status?.connected && status.refreshTokenExpiresAt && (() => {
        const daysLeft = Math.ceil(
          (new Date(status.refreshTokenExpiresAt).getTime() - Date.now()) / 86400000,
        );
        return daysLeft <= 2 ? (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 3,
              border: "1px solid #f59e0b",
              background: "#fffbeb",
              fontSize: 12,
              color: "#92400e",
              marginBottom: 8,
            }}
          >
            Schwab connection expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}. Re-authenticate
            to maintain sync.
          </div>
        ) : null;
      })()}

      {/* ============ TOTAL VALUE + CHART ============ */}
      <div style={{ border: "1px solid #ddd", borderRadius: 4, background: "#fff", marginBottom: 16 }}>
        <div
          onClick={() => setTotalValueExpanded((p) => !p)}
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            borderBottom: totalValueExpanded ? "1px solid #eee" : "none",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1a", fontFamily: FONT }}>
            Total Value
          </span>
          <span style={{ fontSize: 12, color: "#888" }}>{totalValueExpanded ? "▲" : "▼"}</span>
        </div>

        {totalValueExpanded && (
          <div style={{ padding: "16px 20px" }}>
            {/* Metrics row */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 40, marginBottom: 16 }}>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#666",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Total Value
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#0d7a3e",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    i
                  </span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a", lineHeight: "36px" }}>
                  {fmt(totalValue)}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#666",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Day Change
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#0d7a3e",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    i
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#888" }}>–</div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#666",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 2,
                  }}
                >
                  1-Month Change
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#888" }}>–</div>
              </div>
            </div>

            {/* Time period buttons + Table/Chart toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 4,
                marginBottom: 12,
              }}
            >
              <button
                onClick={() => setChartView(chartView === "table" ? "chart" : "table")}
                style={{
                  ...btnStyle,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  marginRight: 8,
                  border: chartView === "table" ? "2px solid #0d7a3e" : "1px solid #ccc",
                  color: chartView === "table" ? "#0d7a3e" : "#555",
                }}
              >
                <span style={{ fontSize: 11 }}>{chartView === "table" ? "▤" : "◻"}</span>
                {chartView === "table" ? "Table View" : "Chart View"}
              </button>
              {(["1M", "3M", "6M", "YTD", "1Y", "2Y"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  style={{
                    width: 36,
                    height: 28,
                    borderRadius: 14,
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: FONT,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: chartRange === r ? "2px solid #0d7a3e" : "1px solid #ccc",
                    background: "#fff",
                    color: chartRange === r ? "#0d7a3e" : "#555",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

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
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 4,
            background: "#fff",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <h3 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
            Connect Your Schwab Account
          </h3>
          <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
            Link your Charles Schwab brokerage to view accounts, positions, and balances.
          </p>
          <button
            onClick={handleConnect}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 3,
              background: "#0d7a3e",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Connect Schwab
          </button>
        </div>
      )}

      {/* ============ ACCOUNTS TABLE ============ */}
      {accounts.length > 0 && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 4,
            background: "#fff",
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          {/* Section header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #ddd",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2 style={{ ...S.sectionTitle, fontSize: 16 }}>Accounts</h2>
              <div style={S.infoText}>
                {includedCount} of {accounts.length} accounts included in Total Value
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#0d7a3e", fontSize: 14 }}>&#9432;</span> FDIC Disclosures
              </button>
              <button style={btnStyle}>Additional Info</button>
              <button
                onClick={() => setShowSettings(true)}
                style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 3 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
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
                const groupValue = group.accounts.reduce(
                  (s, a) => s + (a.total_value || a.balance_current || 0),
                  0,
                );
                const groupCash = group.accounts.reduce((s, a) => s + (a.cash_balance || 0), 0);

                return (
                  <GroupRows
                    key={group.name}
                    group={group}
                    expanded={expanded}
                    groupValue={groupValue}
                    groupCash={groupCash}
                    holdings={holdings}
                    onToggle={() =>
                      setExpandedGroups((p) => ({ ...p, [group.name]: !p[group.name] }))
                    }
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...S.footerTotal, textAlign: "left" }} colSpan={2}>
                  All Accounts Total
                </td>
                <td style={{ ...S.footerTotal, textAlign: "right" }}>{fmt(totalCash)}</td>
                <td style={{ ...S.footerTotal, textAlign: "right" }}>{fmt(totalValue)}</td>
                <td style={{ ...S.footerTotal, textAlign: "right", color: "#888" }}>–</td>
                <td style={{ ...S.footerTotal, textAlign: "right", color: "#888" }}>–</td>
                <td style={S.footerTotal}></td>
              </tr>
            </tfoot>
          </table>

          {/* Add a Non-Schwab Account link */}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid #eee",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16, color: "#0d7a3e", fontWeight: 700 }}>+</span>
            <span style={{ fontSize: 13, color: "#0d7a3e", fontWeight: 600, cursor: "pointer" }}>
              Add a Non-Schwab Account
            </span>
          </div>
        </div>
      )}

      {/* ============ POSITIONS SECTION ============ */}
      {totalHoldingsCount > 0 && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 4,
            background: "#fff",
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          {/* Section header */}
          <div style={{ padding: "16px 16px 12px" }}>
            <h2 style={{ ...S.sectionTitle, fontSize: 18, marginBottom: 8 }}>Positions</h2>
            {/* Equities sub-section */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: "#1a1a1a",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 10, color: "#666" }}>&#9660;</span>
              Equities
              <span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}>
                ({totalHoldingsCount})
              </span>
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
                const totalGL = acctHoldings.reduce(
                  (s, h) => s + (h.unrealized_gain_loss || 0),
                  0,
                );

                return (
                  <PositionRows
                    key={acct.id}
                    account={acct}
                    holdings={acctHoldings}
                    expanded={expanded}
                    totalMV={totalMV}
                    totalCB={totalCB}
                    totalGL={totalGL}
                    onToggle={() =>
                      setExpandedPositionAccounts((p) => ({
                        ...p,
                        [acct.id]: !(p[acct.id] ?? true),
                      }))
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ============ BOTTOM STATUS BAR (Schwab-style dark footer) ============ */}
      <div
        style={{
          background: "#1a3a2a",
          color: "#fff",
          borderRadius: 4,
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          fontFamily: FONT,
          fontWeight: 500,
        }}
      >
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
