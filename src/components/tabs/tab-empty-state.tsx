import type { ReactNode } from "react";

/**
 * Framed card used for loading, empty, and "tab not found" states.
 *
 * Replaces many copy-pasted instances of:
 *   <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
 *     ...
 *   </div>
 *
 * Accepts either a single `message` (for loading spinners) or a `title`+`children`
 * pair for richer empty states.
 */
export interface TabEmptyStateProps {
  /** Short message rendered as a single centered line. Used for loading states. */
  message?: ReactNode;
  /** Larger title rendered above `children`. */
  title?: ReactNode;
  /** Supplementary text rendered beneath `title`. */
  children?: ReactNode;
  className?: string;
}

export function TabEmptyState({ message, title, children, className }: TabEmptyStateProps) {
  const base = "rounded-xl border border-slate-200 p-8 text-center text-slate-500";
  return (
    <div className={className ? `${base} ${className}` : base}>
      {title && <p className="text-lg mb-2">{title}</p>}
      {children && <div className="text-sm">{children}</div>}
      {message && !title && !children && <>{message}</>}
    </div>
  );
}

/**
 * Reusable "tab not found" fallback — used verbatim by every `_tab-content.tsx`
 * dispatcher when the URL slug doesn't match any known sub-view.
 */
export function TabNotFound() {
  return (
    <div className="text-center py-12 text-slate-400">
      <p>Tab not found.</p>
    </div>
  );
}
