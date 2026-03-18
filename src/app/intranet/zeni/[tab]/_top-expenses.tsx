"use client";

/**
 * Feature 5: Top Expenses Ranked Table
 * Shows the biggest spending categories for the current month.
 * Self-contained — remove this import from _overview.tsx to back out.
 */

interface ExpenseCategory {
  category: string;
  total: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function TopExpenses({
  expenses,
  monthLabel,
}: {
  expenses: ExpenseCategory[];
  monthLabel: string;
}) {
  if (expenses.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Top Expenses &mdash; {monthLabel}</h2>
        <p className="text-sm text-slate-400">No expense data for this period.</p>
      </div>
    );
  }

  const maxAmount = expenses[0]?.total || 1;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Top Expenses &mdash; {monthLabel}</h2>
      <div className="space-y-2">
        {expenses.slice(0, 10).map((exp, i) => {
          const barPct = (exp.total / maxAmount) * 100;
          return (
            <div key={exp.category} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-xs text-slate-400 text-right flex-shrink-0">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-slate-700 truncate">{exp.category}</span>
                  <span className="text-slate-900 font-medium ml-2 flex-shrink-0">
                    {formatCurrency(exp.total)}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5">
                  <div
                    className="h-full bg-indigo-400 rounded-full"
                    style={{ width: `${Math.max(barPct, 2)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
