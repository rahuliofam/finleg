/**
 * Exponential backoff retry wrapper.
 *
 * Usage:
 *   import { retry } from './lib/retry.mjs';
 *   const result = await retry(() => fetch(url), {
 *     maxAttempts: 4,
 *     baseDelayMs: 1000,       // 1s, 2s, 4s, 8s
 *     onRetry: (err, attempt, waitMs) => log.warn('retrying', { attempt, waitMs }),
 *   });
 *
 * Semantics:
 *   - Attempts the fn up to maxAttempts times (default 3).
 *   - Backs off baseDelayMs * 2^(attempt-1), capped at maxDelayMs.
 *   - Adds jitter (±25%) by default to avoid thundering herd.
 *   - If shouldRetry returns false (or err instanceof FatalError/ValidationError),
 *     the error is rethrown immediately — no more attempts.
 *   - FatalError and ValidationError from ./errors.mjs are never retried.
 *
 * Design choice: zero dependencies. Node's setTimeout promisified inline.
 */

import { FatalError, ValidationError } from './errors.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @template T
 * @param {() => Promise<T> | T} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=500]
 * @param {number} [opts.maxDelayMs=30000]
 * @param {number} [opts.jitter=0.25]   fraction, e.g. 0.25 = ±25%
 * @param {(err: unknown, attempt: number) => boolean} [opts.shouldRetry]
 * @param {(err: unknown, attempt: number, waitMs: number) => void} [opts.onRetry]
 * @returns {Promise<T>}
 */
export async function retry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const jitter = opts.jitter ?? 0.25;
  const shouldRetry = opts.shouldRetry || defaultShouldRetry;
  const onRetry = opts.onRetry;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof FatalError || err instanceof ValidationError) throw err;
      if (attempt >= maxAttempts) break;
      if (!shouldRetry(err, attempt)) break;

      const exp = baseDelayMs * Math.pow(2, attempt - 1);
      const capped = Math.min(exp, maxDelayMs);
      const noise = capped * jitter;
      const waitMs = Math.max(0, Math.round(capped + (Math.random() * 2 - 1) * noise));

      if (onRetry) {
        try { onRetry(err, attempt, waitMs); } catch { /* onRetry must not throw */ }
      }
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/**
 * Default: retry on network errors, rate limits, and 5xx. Skip 4xx.
 */
function defaultShouldRetry(err) {
  if (!err) return true;
  // node-fetch style status on error object
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (typeof status === 'number') {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }
  // network / timeout codes
  const code = err.code || err.cause?.code;
  if (code && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ECONNRESET/.test(code)) return true;
  if (/timeout|timed out|rate limit|ETIMEDOUT|ECONNRESET/i.test(err.message || '')) return true;
  // Default: retry once — caller can tighten with a custom shouldRetry.
  return true;
}
