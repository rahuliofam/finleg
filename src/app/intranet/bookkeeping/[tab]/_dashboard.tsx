"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface SpendingMonth {
  month: string;
  total: number;
}

interface CategoryBreakdown {
  category: string;
  total: number;
}

interface DashboardStats {
  totalTransactions: number;
  pendingReview: number;
  autoCategorizePct: number;
  activeRules: number;
  openTodos: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  aiAccuracy: number | null;
}

export default function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [spending, setSpending] = useState<SpendingMonth[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);

    // Fetch all stats in parallel
    const [
      totalTxns,
      pendingTxns,
      autoCatTxns,
      rulesCount,
      openTodos,
      lastSync,
      latestMetric,
      monthlySpending,
      categoryData,
    ] = await Promise.all([
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("is_deleted", false),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).in("review_status", ["auto_categorized", "approved"]),
      supabase.from("category_rules").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("todos").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
      supabase.from("sync_runs").select("completed_at, status").eq("status", "success").order("completed_at", { ascending: false }).limit(1).single(),
      supabase.from("ai_metrics").select("accuracy_pct").order("period_end", { ascending: false }).limit(1).single(),
      // Monthly spending — computed client-side below
      Promise.resolve({ data: null as any }),
      // Top categories — computed client-side below
      Promise.resolve({ data: null as any }),
    ]);

    const total = totalTxns.count || 0;
    const autoCat = autoCatTxns.count || 0;

    setStats({
      totalTransactions: total,
      pendingReview: pendingTxns.count || 0,
      autoCategorizePct: total > 0 ? Math.round((autoCat / total) * 100) : 0,
      activeRules: rulesCount.count || 0,
      openTodos: openTodos.count || 0,
      lastSyncAt: lastSync.data?.completed_at || null,
      lastSyncStatus: lastSync.data?.status || null,
      aiAccuracy: latestMetric.data?.accuracy_pct || null,
    });

    // If RPC functions aren't available yet, compute client-side
    if (monthlySpending.data) {
      setSpending(monthlySpending.data);
    } else {
      // Fallback: fetch raw transactions and aggregate
      const { data: txns } = await supabase
        .from("qb_transactions")
        .select("txn_date, amount, qb_type")
        .eq("qb_type", "Purchase")
        .eq("is_deleted", false)
        .gte("txn_date", new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0])
        .order("txn_date", { ascending: true });

      if (txns) {
        const monthMap = new Map<string, number>();
        for (const t of txns) {
          const month = t.txn_date.slice(0, 7); // YYYY-MM
          monthMap.set(month, (monthMap.get(month) || 0) + Number(t.amount));
        }
        setSpending(
          Array.from(monthMap.entries())
            .map(([month, total]) => ({ month, total }))
            .sort((a, b) => a.month.localeCompare(b.month))
        );
      }
    }

    if (categoryData.data) {
      setCategories(categoryData.data);
    } else {
      const { data: catTxns } = await supabase
        .from("qb_transactions")
        .select("our_category, amount")
        .eq("qb_type", "Purchase")
        .eq("is_deleted", false)
        .not("our_category", "is", null);

      if (catTxns) {
        const catMap = new Map<string, number>();
        for (const t of catTxns) {
          const cat = t.our_category || "Uncategorized";
          catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(Number(t.amount)));
        }
        setCategories(
          Array.from(catMap.entries())
            .map(([category, total]) => ({ category, total }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
        );
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Financial overview and system health</p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KPICard label="Transactions" value={stats.totalTransactions.toLocaleString()} />
          <KPICard
            label="Pending Review"
            value={stats.pendingReview.toString()}
            accent={stats.pendingReview > 0 ? "amber" : "green"}
          />
          <KPICard label="Auto-Categorized" value={`${stats.autoCategorizePct}%`} accent="purple" />
          <KPICard label="Active Rules" value={stats.activeRules.toString()} accent="teal" />
        </div>
      )}

      {/* System Health Row */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500 mb-1">Last Sync</div>
            <div className="text-sm font-medium text-slate-900">
              {stats.lastSyncAt ? formatDate(stats.lastSyncAt) : "Never"}
            </div>
            {stats.lastSyncStatus && (
              <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${
                stats.lastSyncStatus === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}>
                {stats.lastSyncStatus}
              </span>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500 mb-1">AI Accuracy</div>
            <div className="text-sm font-medium text-slate-900">
              {stats.aiAccuracy !== null ? `${stats.aiAccuracy}%` : "No data yet"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500 mb-1">Open Tasks</div>
            <div className={`text-sm font-medium ${stats.openTodos > 0 ? "text-amber-700" : "text-green-700"}`}>
              {stats.openTodos}
            </div>
          </div>
        </div>
      )}

      {/* Monthly Spending */}
      {spending.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Monthly Spending</h2>
          <div className="space-y-1.5">
            {spending.slice(-12).map((m) => {
              const maxSpend = Math.max(...spending.map((s) => s.total));
              const pct = maxSpend > 0 ? (m.total / maxSpend) * 100 : 0;
              const monthLabel = new Date(m.month + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" });

              return (
                <div key={m.month} className="flex items-center gap-2 text-sm">
                  <span className="w-16 text-xs text-slate-500 text-right flex-shrink-0">{monthLabel}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="w-20 text-xs text-slate-600 text-right flex-shrink-0">
                    {formatCurrency(m.total)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Categories */}
      {categories.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Top Spending Categories</h2>
          <div className="space-y-2">
            {categories.map((cat, i) => {
              const totalAll = categories.reduce((sum, c) => sum + c.total, 0);
              const pct = totalAll > 0 ? Math.round((cat.total / totalAll) * 100) : 0;

              return (
                <div key={cat.category} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-xs text-slate-400 text-right">{i + 1}.</span>
                  <span className="flex-1 text-slate-700 truncate">{cat.category}</span>
                  <span className="text-xs text-slate-400">{pct}%</span>
                  <span className="w-24 text-right text-slate-900 font-medium">
                    {formatCurrency(cat.total)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "purple" | "amber" | "teal";
}) {
  const accentColors = {
    green: "text-green-700",
    purple: "text-purple-700",
    amber: "text-amber-700",
    teal: "text-teal-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className={`text-2xl font-bold ${accent ? accentColors[accent] : "text-slate-900"}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
