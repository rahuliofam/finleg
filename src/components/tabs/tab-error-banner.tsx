/**
 * Dismissible error banner used across bookkeeping and howto sub-views.
 *
 * Replaces the copy-pasted block:
 *   {error && (
 *     <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
 *       {error}
 *       <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
 *     </div>
 *   )}
 *
 * Usage: `<TabErrorBanner error={error} onDismiss={() => setError(null)} />`
 * Returns null when `error` is null/undefined/empty so callers don't need their own
 * conditional wrapper.
 */
export interface TabErrorBannerProps {
  error: string | null | undefined;
  onDismiss?: () => void;
  className?: string;
}

export function TabErrorBanner({ error, onDismiss, className }: TabErrorBannerProps) {
  if (!error) return null;
  return (
    <div
      className={`mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700${
        className ? ` ${className}` : ""
      }`}
      role="alert"
    >
      {error}
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 font-medium underline">
          Dismiss
        </button>
      )}
    </div>
  );
}
