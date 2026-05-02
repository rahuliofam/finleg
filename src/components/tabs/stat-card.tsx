import type { ReactNode } from "react";

/**
 * Compact numeric tile used on dashboards and activity feeds.
 *
 * Replaces locally-defined `StatCard`/`KPICard`/`SummaryCard` duplicates in
 * _activity.tsx, _dashboard.tsx, and _tax-report.tsx. Each of those redefined
 * the same accent colour map and white rounded box.
 */
export type StatCardAccent = "green" | "red" | "purple" | "amber" | "teal" | "blue" | "indigo";

const ACCENT_CLASSES: Record<StatCardAccent, string> = {
  green: "text-green-700",
  red: "text-red-700",
  purple: "text-purple-700",
  amber: "text-amber-700",
  teal: "text-teal-700",
  blue: "text-blue-700",
  indigo: "text-indigo-700",
};

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  accent?: StatCardAccent;
  /** Optional sub-label rendered below the value (e.g. "Last sync: 2m ago"). */
  hint?: ReactNode;
  /** Tailwind size override for the value (defaults to `text-2xl`). */
  valueSize?: "text-xl" | "text-2xl";
  className?: string;
}

export function StatCard({
  label,
  value,
  accent,
  hint,
  valueSize = "text-2xl",
  className,
}: StatCardProps) {
  const valueColor = accent ? ACCENT_CLASSES[accent] : "text-slate-900";
  const base = "rounded-xl border border-slate-200 bg-white p-3 text-center";
  return (
    <div className={className ? `${base} ${className}` : base}>
      <div className={`${valueSize} font-bold ${valueColor}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      {hint && <div className="mt-1">{hint}</div>}
    </div>
  );
}
