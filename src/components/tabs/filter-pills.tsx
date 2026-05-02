import type { ReactNode } from "react";

/**
 * Horizontal row of rounded-full filter buttons used for switching between
 * subsets of a list (status filters, source filters, etc).
 *
 * Call sites using this pattern today:
 *  - bookkeeping/_receipts.tsx (status filter: all/pending/parsed/...)
 *  - bookkeeping/_categorize.tsx (review status)
 *  - howto/_autoactions.tsx (event source)
 *
 * Intentionally NOT used for:
 *  - bookkeeping/_tasks.tsx — uses a segmented-control style that looks
 *    substantially different and is only one call site.
 */

export type FilterPillVariant = "green" | "slate";

export interface FilterPillOption<V extends string> {
  key: V;
  label: ReactNode;
  /** Optional count rendered in parentheses/subscript. */
  count?: number | null;
}

export interface FilterPillsProps<V extends string> {
  options: ReadonlyArray<FilterPillOption<V>>;
  value: V;
  onChange: (next: V) => void;
  /**
   * Colour used for the selected pill.
   *  - "green" → the brand green (#228B4A) — matches _receipts, _categorize.
   *  - "slate" → dark slate — matches _autoactions.
   */
  variant?: FilterPillVariant;
  /** Whether to render counts as `(n)` or hide them even when provided. */
  showCounts?: boolean;
  className?: string;
}

const SELECTED_BG: Record<FilterPillVariant, string> = {
  green: "bg-[#228B4A] text-white",
  slate: "bg-slate-800 text-white",
};

export function FilterPills<V extends string>({
  options,
  value,
  onChange,
  variant = "green",
  showCounts = true,
  className,
}: FilterPillsProps<V>) {
  return (
    <div className={`flex gap-2 flex-wrap${className ? ` ${className}` : ""}`}>
      {options.map((opt) => {
        const active = opt.key === value;
        const hasCount = showCounts && typeof opt.count === "number";
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              active ? SELECTED_BG[variant] : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {opt.label}
            {hasCount && opt.count! > 0 && (
              <span className="ml-1.5 text-xs opacity-75">({opt.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
