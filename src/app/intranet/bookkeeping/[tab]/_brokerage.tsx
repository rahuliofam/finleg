"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const SCHWAB_OAUTH_WORKER = "https://schwab-oauth.finleg.workers.dev";

interface Account {
  id: string;
  account_number_masked: string | null;
  account_type: string;
  display_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  total_value: number | null;
  cash_balance: number | null;
  buying_power: number | null;
  balance_current: number | null;
  balance_available: number | null;
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

export default function BrokerageTab() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holdings, setHoldings] = useState<Record<string, Holding[]>>({});
  const [lastSync, setLastSync] = useState<{ at: string; status: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Look up Schwab institution
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

    // Check connection status from oauth_tokens
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

    // Fetch Schwab accounts
    const { data: accts } = await supabase
      .from("accounts")
      .select("*")
      .eq("institution_id", institution.id)
      .eq("is_active", true)
      .order("account_type");

    if (accts?.length) {
      setAccounts(accts);
      if (!selectedAccount) setSelectedAccount(accts[0].id);

      // Fetch holdings with security info for all accounts
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

    // Last sync
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
  }, [selectedAccount]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Check URL params for OAuth callback result
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

  const fmt = (n: number | null) =>
    n != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n) : "—";

  const fmtPct = (n: number | null) =>
    n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        Loading brokerage data...
      </div>
    );
  }

  const totalValue = accounts.reduce((sum, a) => sum + (a.total_value || 0), 0);

  const activeHoldings = selectedAccount ? (holdings[selectedAccount] || []) : [];
  const activeAccount = accounts.find((a) => a.id === selectedAccount);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Brokerage</h1>
          <p className="text-sm text-slate-500 mt-1">Schwab accounts, positions, and balances</p>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 mb-1">Status</div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${status?.connected ? "bg-green-500" : "bg-red-400"}`} />
            <span className="text-sm font-medium text-slate-900">
              {status?.connected ? "Connected" : "Not Connected"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 mb-1">Total Value</div>
          <div className="text-sm font-medium text-slate-900">{fmt(totalValue)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 mb-1">Accounts</div>
          <div className="text-sm font-medium text-slate-900">{accounts.length}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500 mb-1">Last Sync</div>
          <div className="text-sm font-medium text-slate-900">{fmtDate(lastSync?.at || null)}</div>
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

      {!status?.connected && accounts.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <div className="text-4xl mb-3">📊</div>
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

      {accounts.length > 0 && (
        <>
          {/* Account Tabs */}
          {accounts.length > 1 && (
            <div className="flex gap-1 mb-4 border-b border-slate-200">
              {accounts.map((acct) => (
                <button
                  key={acct.id}
                  onClick={() => setSelectedAccount(acct.id)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    selectedAccount === acct.id
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {acct.display_name || `${acct.account_type} ${acct.account_number_masked || ""}`}
                </button>
              ))}
            </div>
          )}

          {/* Account Summary */}
          {activeAccount && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <SummaryCard label="Total Value" value={fmt(activeAccount.total_value)} />
              <SummaryCard label="Available" value={fmt(activeAccount.balance_available)} />
              <SummaryCard label="Cash" value={fmt(activeAccount.cash_balance)} />
              <SummaryCard label="Buying Power" value={fmt(activeAccount.buying_power)} />
              <SummaryCard label="Holdings" value={String(activeHoldings.length)} />
            </div>
          )}

          {/* Holdings Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Holdings {activeHoldings.length > 0 && `(${activeHoldings.length})`}
              </h3>
              {activeAccount?.last_synced_at && (
                <span className="text-xs text-slate-400">Updated {fmtDate(activeAccount.last_synced_at)}</span>
              )}
            </div>
            {activeHoldings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="px-4 py-2 font-medium">Symbol</th>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium text-right">Qty</th>
                      <th className="px-4 py-2 font-medium text-right">Price</th>
                      <th className="px-4 py-2 font-medium text-right">Market Value</th>
                      <th className="px-4 py-2 font-medium text-right">Cost Basis</th>
                      <th className="px-4 py-2 font-medium text-right">Gain/Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeHoldings.map((h) => (
                      <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-25">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {h.security?.ticker_symbol || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate">
                          {h.security?.name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {h.quantity?.toLocaleString() || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{fmt(h.price)}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-slate-900">{fmt(h.market_value)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{fmt(h.cost_basis)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${
                          (h.unrealized_gain_loss || 0) >= 0 ? "text-green-600" : "text-red-600"
                        }`}>
                          {fmt(h.unrealized_gain_loss)}
                          {h.unrealized_gain_loss_pct != null && (
                            <span className="text-xs ml-1">({fmtPct(h.unrealized_gain_loss_pct)})</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                No holdings found. Run a sync to fetch data.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
