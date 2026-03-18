"use client";

/**
 * Feature 3: KPI Cards with Period Comparison
 * Shows key financial metrics with % change vs prior period.
 * Self-contained — remove this import from _overview.tsx to back out.
 */

interface KPIData {
  totalSpendingThisMonth: number;
  totalSpendingLastMonth: number;
  totalIncomeThisMonth: number;
  totalIncomeLastMonth: number;
  transactionCountThisMonth: number;
  transactionCountLastMonth: number;
  netCashFlow: number;
  netCashFlowLastMonth: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function SentimentBadge({ pct, inverted = false }: { pct: number | null; inverted?: boolean }) {
  if (pct === null) return <span className="text-xs text-slate-400">N/A</span>;
  // For spending, increase = bad (inverted=true). For income, increase = good.
  const isPositiveChange = pct >= 0;
  const isGood = inverted ? !isPositiveChange : isPositiveChange;
  const emoji = isGood ? "\u{1F60A}" : "\u{1F61F}";
  const color = isGood ? "text-green-600" : "text-red-600";

  return (
    <span className={`text-xs ${color} font-medium`}>
      {emoji} {pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

export default function KPICards({ data, periodLabel }: { data: KPIData; periodLabel: string }) {
  const cards = [
    {
      label: "Spending",
      value: formatCurrency(data.totalSpendingThisMonth),
      pct: pctChange(data.totalSpendingThisMonth, data.totalSpendingLastMonth),
      inverted: true,
    },
    {
      label: "Income",
      value: formatCurrency(data.totalIncomeThisMonth),
      pct: pctChange(data.totalIncomeThisMonth, data.totalIncomeLastMonth),
      inverted: false,
    },
    {
      label: "Transactions",
      value: data.transactionCountThisMonth.toLocaleString(),
      pct: pctChange(data.transactionCountThisMonth, data.transactionCountLastMonth),
      inverted: false,
    },
    {
      label: "Net Cash Flow",
      value: formatCurrency(data.netCashFlow),
      pct: pctChange(data.netCashFlow, data.netCashFlowLastMonth),
      inverted: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center">
          <div className="text-2xl font-bold text-slate-900">{card.value}</div>
          <div className="text-xs text-slate-500 mt-0.5">{card.label}</div>
          <div className="mt-1">
            <SentimentBadge pct={card.pct} inverted={card.inverted} />
            <span className="text-[10px] text-slate-400 ml-1">vs {periodLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
