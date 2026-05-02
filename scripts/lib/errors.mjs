/**
 * Shared error classes for scripts/.
 *
 * Scripts can throw these to signal how the caller should handle the failure:
 *   - FatalError       → abort the entire batch, exit non-zero
 *   - RetriableError   → wrap with retry() and try again with backoff
 *   - ValidationError  → skip this item (input was bad), keep going
 *
 * The base ScriptError carries an optional `cause` and `context` object so
 * log messages retain the original stack trace and relevant metadata.
 */

export class ScriptError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, context?: Record<string, unknown> }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = this.constructor.name;
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.context) this.context = opts.context;
  }
}

/**
 * Unrecoverable failure — caller should abort.
 * Examples: missing credentials, permission denied, schema mismatch.
 */
export class FatalError extends ScriptError {}

/**
 * Transient failure — caller should retry with backoff.
 * Examples: network timeout, 5xx, rate limit, deadlock.
 */
export class RetriableError extends ScriptError {}

/**
 * Bad input — caller should skip this record but keep processing others.
 * Examples: malformed JSON response, missing required field, invalid PDF.
 */
export class ValidationError extends ScriptError {}

/**
 * Convenience: wrap an unknown thrown value as a RetriableError.
 * Useful inside retry() when you want to force a retry of a non-standard error.
 */
export function asRetriable(err, message) {
  if (err instanceof RetriableError) return err;
  return new RetriableError(message ?? (err?.message || String(err)), { cause: err });
}
