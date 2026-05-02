/**
 * Structured logger with levels, timestamps, and optional file output.
 *
 * Design goals:
 *   - Zero dependencies (no pino/winston).
 *   - Backwards compatible — default output looks similar to `console.log`
 *     so migrated scripts keep their familiar shape.
 *   - Opt-in features: --verbose to unlock debug(), log file path via env,
 *     and a tiny progress reporter for batch loops.
 *
 * Usage:
 *   import { createLogger } from './lib/logger.mjs';
 *   const log = createLogger({ verbose: true });
 *   log.info('Found %d items', items.length);
 *   log.warn('Rate limited, backing off');
 *   log.error('DB insert failed', { id, error: err.message });
 *   log.debug('Raw response:', raw);
 *
 *   const progress = log.progress('Ingesting statements', total);
 *   for (const item of items) { await work(item); progress.tick(); }
 *   progress.done();
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { format, inspect } from 'util';

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function ts() {
  return new Date().toISOString();
}

function formatArgs(args) {
  if (args.length === 0) return '';
  const [first, ...rest] = args;
  if (typeof first === 'string' && rest.length > 0 && /%[sdjoO]/.test(first)) {
    // printf-style
    return format(...args);
  }
  return args
    .map(a => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: 120 })))
    .join(' ');
}

/**
 * @param {object} [opts]
 * @param {'debug'|'info'|'warn'|'error'|'silent'} [opts.level]
 * @param {boolean} [opts.verbose]    shortcut for level='debug'
 * @param {boolean} [opts.timestamps] prefix each line with ISO timestamp
 * @param {string}  [opts.file]       also append plain lines to this file
 * @param {string}  [opts.prefix]     prepend every line with this tag
 */
export function createLogger(opts = {}) {
  const levelName = opts.level || (opts.verbose ? 'debug' : 'info');
  const threshold = LEVELS[levelName] ?? LEVELS.info;
  const showTs = opts.timestamps === true;
  const prefix = opts.prefix ? `[${opts.prefix}] ` : '';
  const filePath = opts.file || process.env.SCRIPT_LOG_FILE || null;

  if (filePath) {
    try { mkdirSync(dirname(filePath), { recursive: true }); } catch {}
  }

  function emit(levelNum, levelTag, args, stream) {
    if (levelNum < threshold) return;
    const body = formatArgs(args);
    const line = `${showTs ? ts() + ' ' : ''}${prefix}${levelTag}${body}`;
    stream.write(line + '\n');
    if (filePath) {
      try { appendFileSync(filePath, `${ts()} ${levelTag.trim() || 'INFO'} ${body}\n`); } catch {}
    }
  }

  return {
    level: levelName,
    debug: (...a) => emit(LEVELS.debug, '[debug] ', a, process.stderr),
    info:  (...a) => emit(LEVELS.info,  '',         a, process.stdout),
    warn:  (...a) => emit(LEVELS.warn,  '[warn] ',  a, process.stderr),
    error: (...a) => emit(LEVELS.error, '[error] ', a, process.stderr),

    /** Create a child logger with an additional prefix. */
    child(childPrefix) {
      return createLogger({
        ...opts,
        prefix: opts.prefix ? `${opts.prefix}:${childPrefix}` : childPrefix,
      });
    },

    /**
     * Simple in-place progress reporter for batch loops.
     * Prints "label: N/total (pct%) | elapsed Ms" and updates on tick().
     */
    progress(label, total) {
      const start = Date.now();
      let done = 0;
      const isTTY = process.stderr.isTTY;
      const render = () => {
        const pct = total ? Math.round((done / total) * 100) : 0;
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const line = `${label}: ${done}/${total} (${pct}%) | ${elapsed}s`;
        if (isTTY) {
          process.stderr.write(`\r${line}`);
        } else {
          // Non-TTY: only log every 10 items to avoid log spam.
          if (done === total || done % 10 === 0) process.stderr.write(line + '\n');
        }
      };
      return {
        tick(n = 1) { done += n; render(); },
        done() {
          if (isTTY) process.stderr.write('\n');
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          process.stderr.write(`${label}: done ${done}/${total} in ${elapsed}s\n`);
        },
      };
    },
  };
}

/** Convenience default logger (info level, no timestamps). */
export const logger = createLogger();
