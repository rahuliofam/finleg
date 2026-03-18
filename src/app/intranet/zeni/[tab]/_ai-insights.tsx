"use client";

/**
 * Feature 2: AI-Generated Natural Language Insights
 * Auto-generates plain-English summaries of financial changes.
 * Self-contained — remove this import from _overview.tsx to back out.
 */

interface CategoryChange {
  category: string;
  thisMonth: number;
  lastMonth: number;
  change: number;
  changePct: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
}

function generateInsights(changes: CategoryChange[], totalThis: number, totalLast: number): string[] {
  const insights: string[] = [];

  // Overall spending insight
  if (totalLast > 0) {
    const totalChange = totalThis - totalLast;
    const totalPct = Math.round(Math.abs((totalChange / totalLast) * 100));
    const direction = totalChange >= 0 ? "increase" : "decrease";
    insights.push(
      `Total spending was ${formatCurrency(totalThis)}, a${totalPct === 0 ? " flat" : `n ${direction} of ${totalPct}%`} or ${formatCurrency(Math.abs(totalChange))} from last month.`
    );
  } else if (totalThis > 0) {
    insights.push(`Total spending was ${formatCurrency(totalThis)} this month (no prior month data).`);
  }

  // Top movers (sorted by absolute change)
  const movers = [...changes]
    .filter((c) => Math.abs(c.change) > 0 && c.category !== "Uncategorized")
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 3);

  for (const m of movers) {
    const direction = m.change >= 0 ? "increased" : "decreased";
    const pct = Math.abs(m.changePct);
    insights.push(
      `${m.category} ${direction} by ${formatCurrency(m.change)}${pct < 1000 ? ` (${pct}%)` : ""}, from ${formatCurrency(m.lastMonth)} to ${formatCurrency(m.thisMonth)}.`
    );
  }

  if (insights.length === 0) {
    insights.push("Not enough data to generate insights for this period.");
  }

  return insights;
}

export default function AIInsights({
  changes,
  totalThisMonth,
  totalLastMonth,
  monthLabel,
}: {
  changes: CategoryChange[];
  totalThisMonth: number;
  totalLastMonth: number;
  monthLabel: string;
}) {
  const insights = generateInsights(changes, totalThisMonth, totalLastMonth);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{"\u{1F4A1}"}</span>
        <h2 className="text-sm font-semibold text-slate-700">Spending Insights for {monthLabel}</h2>
      </div>
      <div className="space-y-2">
        {insights.map((text, i) => (
          <p key={i} className={`text-sm ${i === 0 ? "text-slate-900 font-medium" : "text-slate-600"}`}>
            {i > 0 && <span className="text-slate-400 mr-1">&bull;</span>}
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}

export type { CategoryChange };
