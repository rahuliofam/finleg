"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import KPICards from "./_kpi-cards";
import AIInsights, { type CategoryChange } from "./_ai-insights";
import MyTasks from "./_my-tasks";
import TopExpenses from "./_top-expenses";

/**
 * Zeni Overview — composes features 2-5.
 * Each feature is a separate component. To back out a feature,
 * remove its import and JSX below.
 */

interface MonthlyBreakdown {
  spending: number;
  income: number;
  txnCount: number;
  categories: Map<string, number>;
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [thisMonth, setThisMonth] = useState<MonthlyBreakdown | null>(null);
  const [lastMonth, setLastMonth] = useState<MonthlyBreakdown | null>(null);
  const [monthKey, setMonthKey] = useState("");
  const [lastMonthKey, setLastMonthKey] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);

    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = getMonthKey(prevDate);

    setMonthKey(currentMonthKey);
    setLastMonthKey(prevMonthKey);

    // Fetch transactions for current and previous month
    const startOfLastMonth = `${prevMonthKey}-01`;
    const endOfThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];

    const { data: txns } = await supabase
      .from("qb_transactions")
      .select("txn_date, amount, qb_type, our_category")
      .eq("is_deleted", false)
      .gte("txn_date", startOfLastMonth)
      .lte("txn_date", endOfThisMonth)
      .order("txn_date", { ascending: true });

    const months: Record<string, MonthlyBreakdown> = {};

    for (const t of txns || []) {
      const mk = t.txn_date.slice(0, 7);
      if (!months[mk]) {
        months[mk] = { spending: 0, income: 0, txnCount: 0, categories: new Map() };
      }
      const m = months[mk];
      const amt = Math.abs(Number(t.amount));
      m.txnCount++;

      if (t.qb_type === "Purchase" || t.qb_type === "Bill Payment (Check)") {
        m.spending += amt;
        const cat = t.our_category || "Uncategorized";
        m.categories.set(cat, (m.categories.get(cat) || 0) + amt);
      } else {
        // Deposits, Sales Receipts, etc.
        m.income += amt;
      }
    }

    setThisMonth(months[currentMonthKey] || { spending: 0, income: 0, txnCount: 0, categories: new Map() });
    setLastMonth(months[prevMonthKey] || { spending: 0, income: 0, txnCount: 0, categories: new Map() });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Financial Overview</h1>
        {/* Skeleton cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 h-20 animate-pulse">
              <div className="h-6 bg-slate-100 rounded w-20 mx-auto mb-2" />
              <div className="h-3 bg-slate-100 rounded w-16 mx-auto" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 h-32 animate-pulse" />
      </div>
    );
  }

  const tm = thisMonth!;
  const lm = lastMonth!;

  // Build category changes for AI insights
  const allCategories = new Set([...tm.categories.keys(), ...lm.categories.keys()]);
  const categoryChanges: CategoryChange[] = Array.from(allCategories).map((cat) => {
    const thisAmt = tm.categories.get(cat) || 0;
    const lastAmt = lm.categories.get(cat) || 0;
    const change = thisAmt - lastAmt;
    const changePct = lastAmt > 0 ? Math.round((change / lastAmt) * 100) : thisAmt > 0 ? 100 : 0;
    return { category: cat, thisMonth: thisAmt, lastMonth: lastAmt, change, changePct };
  });

  // Top expenses for current month
  const topExpenses: { category: string; total: number }[] = [];
  tm.categories.forEach((total, category) => topExpenses.push({ category, total }));
  topExpenses.sort((a, b) => b.total - a.total);

  const lastMonthLabel = getMonthLabel(lastMonthKey);
  const thisMonthLabel = getMonthLabel(monthKey);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Financial Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Insights and key metrics — {thisMonthLabel}
        </p>
      </div>

      {/* Feature 3: KPI Cards */}
      <KPICards
        data={{
          totalSpendingThisMonth: tm.spending,
          totalSpendingLastMonth: lm.spending,
          totalIncomeThisMonth: tm.income,
          totalIncomeLastMonth: lm.income,
          transactionCountThisMonth: tm.txnCount,
          transactionCountLastMonth: lm.txnCount,
          netCashFlow: tm.income - tm.spending,
          netCashFlowLastMonth: lm.income - lm.spending,
        }}
        periodLabel={lastMonthLabel}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Feature 2: AI Insights */}
        <AIInsights
          changes={categoryChanges}
          totalThisMonth={tm.spending}
          totalLastMonth={lm.spending}
          monthLabel={thisMonthLabel}
        />

        {/* Feature 4: My Tasks */}
        <MyTasks />
      </div>

      {/* Feature 5: Top Expenses */}
      <TopExpenses expenses={topExpenses} monthLabel={thisMonthLabel} />
    </div>
  );
}
