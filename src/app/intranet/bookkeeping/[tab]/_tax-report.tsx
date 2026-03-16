"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface TaxCategory {
  category: string;
  total: number;
  count: number;
  deductible: boolean;
}

interface GainLossSummary {
  short_term_gains: number;
  short_term_losses: number;
  long_term_gains: number;
  long_term_losses: number;
}

// Categories that are typically tax-deductible
const DEDUCTIBLE_CATEGORIES = new Set([
  "Charitable Donations",
  "Medical & Health",
  "Business Expense",
  "Home Office",
  "Professional Services",
  "Education",
  "Property Tax",
  "Mortgage Interest",
]);

export default function TaxReportTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [categories, setCategories] = useState<TaxCategory[]>([]);
  const [gainLoss, setGainLoss] = useState<GainLossSummary | null>(null);
  const [incomeTotal, setIncomeTotal] = useState(0);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchTaxData = useCallback(async () => {
    setLoading(true);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // Fetch expense categories
    const { data: expenses } = await supabase
      .from("qb_transactions")
      .select("our_category, amount")
      .eq("qb_type", "Purchase")
      .eq("is_deleted", false)
      .gte("txn_date", yearStart)
      .lte("txn_date", yearEnd);

    if (expenses) {
      const catMap = new Map<string, { total: number; count: number }>();
      let totalExp = 0;
      for (const t of expenses) {
        const cat = t.our_category || "Uncategorized";
        const amt = Math.abs(Number(t.amount));
        const existing = catMap.get(cat) || { total: 0, count: 0 };
        catMap.set(cat, { total: existing.total + amt, count: existing.count + 1 });
        totalExp += amt;
      }
      setExpenseTotal(totalExp);

      setCategories(
        Array.from(catMap.entries())
          .map(([category, { total, count }]) => ({
            category,
            total,
            count,
            deductible: DEDUCTIBLE_CATEGORIES.has(category),
          }))
          .sort((a, b) => b.total - a.total)
      );
    }

    // Fetch income total
    const { data: income } = await supabase
      .from("qb_transactions")
      .select("amount")
      .eq("qb_type", "Deposit")
      .eq("is_deleted", false)
      .gte("txn_date", yearStart)
      .lte("txn_date", yearEnd);

    if (income) {
      setIncomeTotal(income.reduce((sum, t) => sum + Number(t.amount), 0));
    }

    // Fetch realized gains/losses from investment tables
    const { data: gains } = await supabase
      .from("realized_gain_loss")
      .select("gain_loss, term")
      .gte("sold_date", yearStart)
      .lte("sold_date", yearEnd);

    if (gains && gains.length > 0) {
      const summary: GainLossSummary = {
        short_term_gains: 0,
        short_term_losses: 0,
        long_term_gains: 0,
        long_term_losses: 0,
      };
      for (const g of gains) {
        const amt = Number(g.gain_loss);
        if (g.term === "short") {
          if (amt >= 0) summary.short_term_gains += amt;
          else summary.short_term_losses += Math.abs(amt);
        } else {
          if (amt >= 0) summary.long_term_gains += amt;
          else summary.long_term_losses += Math.abs(amt);
        }
      }
      setGainLoss(summary);
    } else {
      setGainLoss(null);
    }

    setLoading(false);
  }, [year]);

  useEffect(() => {
    fetchTaxData();
  }, [fetchTaxData]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const deductibleTotal = categories.filter((c) => c.deductible).reduce((sum, c) => sum + c.total, 0);

  const availableYears = [];
  for (let y = new Date().getFullYear(); y >= 2020; y--) {
    availableYears.push(y);
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        Loading tax data...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tax Report</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tax-relevant financial summary for {year}
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Total Income" value={formatCurrency(incomeTotal)} accent="green" />
        <SummaryCard label="Total Expenses" value={formatCurrency(expenseTotal)} accent="red" />
        <SummaryCard label="Net" value={formatCurrency(incomeTotal - expenseTotal)} accent={incomeTotal >= expenseTotal ? "green" : "red"} />
        <SummaryCard label="Deductible" value={formatCurrency(deductibleTotal)} accent="purple" />
      </div>

      {/* Capital Gains/Losses */}
      {gainLoss && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Capital Gains & Losses</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-slate-500 mb-2">Short-Term</div>
              <div className="text-sm">
                <span className="text-green-700">Gains: {formatCurrency(gainLoss.short_term_gains)}</span>
                <br />
                <span className="text-red-700">Losses: ({formatCurrency(gainLoss.short_term_losses)})</span>
                <br />
                <span className="font-medium text-slate-900">
                  Net: {formatCurrency(gainLoss.short_term_gains - gainLoss.short_term_losses)}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-2">Long-Term</div>
              <div className="text-sm">
                <span className="text-green-700">Gains: {formatCurrency(gainLoss.long_term_gains)}</span>
                <br />
                <span className="text-red-700">Losses: ({formatCurrency(gainLoss.long_term_losses)})</span>
                <br />
                <span className="font-medium text-slate-900">
                  Net: {formatCurrency(gainLoss.long_term_gains - gainLoss.long_term_losses)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expense Categories */}
      {categories.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Expense Categories</h2>
          <div className="space-y-1.5">
            {categories.map((cat) => (
              <div key={cat.category} className="flex items-center gap-3 text-sm py-1">
                {cat.deductible && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 flex-shrink-0">
                    Deductible
                  </span>
                )}
                <span className={`flex-1 truncate ${cat.deductible ? "text-purple-900 font-medium" : "text-slate-700"}`}>
                  {cat.category}
                </span>
                <span className="text-xs text-slate-400">{cat.count} txns</span>
                <span className="w-24 text-right font-medium text-slate-900">
                  {formatCurrency(cat.total)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-sm font-medium">
            <span className="text-slate-700">Total</span>
            <span className="text-slate-900">{formatCurrency(expenseTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "green" | "red" | "purple";
}) {
  const colors = {
    green: "text-green-700",
    red: "text-red-700",
    purple: "text-purple-700",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className={`text-xl font-bold ${colors[accent]}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
