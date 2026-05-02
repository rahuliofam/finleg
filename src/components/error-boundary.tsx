"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Custom fallback UI. Receives the error + a reset callback that clears the
   * error state and re-renders children.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional label used in the default fallback heading (e.g. "Intranet"). */
  label?: string;
  /** Optional hook to report errors to telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Shared error boundary with a sensible Tailwind fallback.
 *
 * Usage:
 *   <ErrorBoundary label="Intranet">
 *     <App />
 *   </ErrorBoundary>
 *
 * Or with a custom fallback:
 *   <ErrorBoundary fallback={(err, reset) => <MyFallback error={err} onReset={reset} />}>
 *     ...
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always log so the error is discoverable in devtools and Sentry-likes.
    console.error("ErrorBoundary caught:", error, info);
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="text-lg font-semibold text-red-800 mb-2">
            Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}
          </h2>
          <p className="text-sm text-red-700 mb-4">
            An unexpected error occurred. You can try again, or reload the page if the
            problem persists.
          </p>
          <details className="mb-4 text-xs text-red-900/80">
            <summary className="cursor-pointer font-medium">Technical details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
              {error.message || String(error)}
            </pre>
          </details>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 hover:bg-red-100 rounded-lg transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
