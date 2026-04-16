/**
 * Tiny CLI arg parser for scripts/.
 *
 * Not trying to be yargs. Just the conventions the existing scripts already use:
 *   --dry-run           boolean flag
 *   --verbose / -v      boolean flag
 *   --help / -h         boolean flag (prints --help text and exits 0)
 *   --limit 50          number
 *   --limit=50          number (= form)
 *   --institution amex  string
 *   --bucket=legal      string (= form)
 *
 * Usage:
 *   import { parseArgs } from './lib/cli.mjs';
 *   const args = parseArgs(process.argv.slice(2), {
 *     booleans: ['dry-run', 'sample', 'force'],
 *     numbers:  { limit: 50, concurrency: 2 },
 *     strings:  ['account-type', 'institution', 'id'],
 *     help: `Usage: node scripts/foo.mjs [--dry-run] [--limit N]`,
 *   });
 *   if (args.dryRun) { ... }
 *   if (args.limit) { ... }         // already a number
 *   if (args.accountType) { ... }   // camelCased
 *
 * Unknown flags don't error — they're collected in args._unknown so scripts
 * can decide whether to warn. Positional args go in args._.
 */

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {string[]} argv  typically process.argv.slice(2)
 * @param {object} [spec]
 * @param {string[]} [spec.booleans]  flag names (kebab-case)
 * @param {Record<string, number>} [spec.numbers]  { name: default }
 * @param {string[]|Record<string,string>} [spec.strings]
 * @param {string} [spec.help]  help text; --help / -h prints it and exits 0
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set((spec.booleans || []).concat(['dry-run', 'verbose', 'help']));
  const numbers = spec.numbers || {};
  const stringSpec = Array.isArray(spec.strings)
    ? Object.fromEntries(spec.strings.map(s => [s, null]))
    : (spec.strings || {});

  const out = { _: [], _unknown: [] };

  // Apply defaults
  for (const name of booleans) out[kebabToCamel(name)] = false;
  for (const [name, def] of Object.entries(numbers)) out[kebabToCamel(name)] = def;
  for (const [name, def] of Object.entries(stringSpec)) out[kebabToCamel(name)] = def;

  const shortMap = { v: 'verbose', h: 'help' };

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    // Positional
    if (!tok.startsWith('-')) {
      out._.push(tok);
      continue;
    }

    // --key=value or --key / -v
    let key, val;
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) { key = tok.slice(2, eq); val = tok.slice(eq + 1); }
      else { key = tok.slice(2); }
    } else {
      // single-char short flag
      const short = tok.slice(1);
      key = shortMap[short] || short;
    }

    const camel = kebabToCamel(key);

    if (booleans.has(key)) {
      out[camel] = true;
      continue;
    }
    if (numbers[key] !== undefined) {
      const raw = val !== undefined ? val : argv[++i];
      const n = parseInt(raw, 10);
      out[camel] = Number.isFinite(n) ? n : numbers[key];
      continue;
    }
    if (stringSpec[key] !== undefined) {
      const raw = val !== undefined ? val : argv[++i];
      out[camel] = raw ?? null;
      continue;
    }

    // Unknown: still capture value if given as --foo bar
    if (val === undefined && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      out._unknown.push({ key, value: argv[++i] });
    } else {
      out._unknown.push({ key, value: val ?? true });
    }
  }

  if (out.help && spec.help) {
    process.stdout.write(spec.help.replace(/\s+$/, '') + '\n');
    process.exit(0);
  }

  return out;
}

/**
 * Tiny helper scripts like qb-refresh-token.mjs don't want a full spec — they
 * just want to read a single flag. This returns the string value or null.
 */
export function getFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith('-')) return true; // boolean flag present
  return next;
}
