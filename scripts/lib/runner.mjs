/**
 * Small helper that wraps a script's main() function with uniform error
 * handling, so every migrated script doesn't have to re-implement
 * `.catch(err => { console.error('Fatal:', err); process.exit(1); })`.
 *
 * Usage:
 *   import { run } from './lib/runner.mjs';
 *   async function main() { ... }
 *   run(main);
 *
 * Behavior:
 *   - Awaits main(). On success, exits 0.
 *   - FatalError     → print clean message, exit 1.
 *   - ValidationError → print clean message, exit 2 (skippable).
 *   - Other errors   → print stack, exit 1.
 *   - SIGINT/SIGTERM → flush stderr and exit 130/143 so cron jobs capture it.
 */

import { FatalError, ValidationError } from './errors.mjs';

export function run(main, opts = {}) {
  const log = opts.logger || console;

  const exitOnSignal = (signal, code) => {
    process.once(signal, () => {
      log.error(`\nReceived ${signal} — aborting.`);
      process.exit(code);
    });
  };
  exitOnSignal('SIGINT', 130);
  exitOnSignal('SIGTERM', 143);

  Promise.resolve()
    .then(() => main())
    .then(() => process.exit(0))
    .catch(err => {
      if (err instanceof FatalError) {
        log.error(`Fatal: ${err.message}`);
        if (err.context) log.error('Context:', err.context);
        process.exit(1);
      }
      if (err instanceof ValidationError) {
        log.error(`Validation: ${err.message}`);
        process.exit(2);
      }
      log.error('Unhandled error:', err);
      process.exit(1);
    });
}
