import type { ReactNode } from "react";

/**
 * Standard page header used at the top of every intranet [tab] sub-view.
 *
 * Replaces the copy-pasted block:
 *   <div className="mb-6">
 *     <h1 className="text-2xl font-bold text-slate-900">Title</h1>
 *     <p className="text-sm text-slate-500 mt-1">Description</p>
 *   </div>
 *
 * When `actions` is provided, the header switches to a flex row so the
 * actions sit on the right (pattern used in _activity, _tax-report,
 * _autoactions, _categorize).
 */
export interface TabHeaderProps {
  title: string;
  description?: ReactNode;
  /** Optional right-aligned slot (buttons, selects, etc). */
  actions?: ReactNode;
  /**
   * Vertical alignment of the actions slot relative to the title.
   * Defaults to `"start"` which matches most existing call sites. Use `"center"`
   * when the actions row is a single-line control (pill, small button) and the
   * description is short enough to fit on one line.
   */
  actionsAlign?: "start" | "center";
  className?: string;
}

export function TabHeader({
  title,
  description,
  actions,
  actionsAlign = "start",
  className,
}: TabHeaderProps) {
  const wrapper = `mb-6${className ? ` ${className}` : ""}`;

  if (actions) {
    const alignClass = actionsAlign === "center" ? "items-center" : "items-start";
    return (
      <div className={`${wrapper} flex ${alignClass} justify-between gap-4 flex-wrap`}>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">{actions}</div>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
    </div>
  );
}
