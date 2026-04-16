/**
 * Environment loader + validator for scripts/.
 *
 * Usage:
 *   import { loadEnv } from './lib/env.mjs';
 *   const env = loadEnv({ required: ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'] });
 *   // env.SUPABASE_URL is guaranteed set (defaults to the finleg URL if unset)
 *
 * Behavior:
 *   1. Loads `.env` via dotenv (silent if file missing)
 *   2. Also loads `local.env` if present (for secrets that shouldn't hit git)
 *   3. Fills in SUPABASE_URL default when missing
 *   4. Throws FatalError listing ALL missing required vars (not just the first)
 *
 * The returned object is a plain snapshot of process.env plus the defaults —
 * mutating it does not affect process.env.
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { FatalError } from './errors.mjs';

const DEFAULT_SUPABASE_URL = 'https://gjdvzzxsrzuorguwkaih.supabase.co';

// Scripts live in <repo>/scripts, so local.env is one directory up.
const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = resolve(dirname(__filename), '..');
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');

let loaded = false;

function loadDotenvOnce() {
  if (loaded) return;
  loaded = true;

  // Standard .env — silent if not found
  dotenvConfig();

  // local.env for overrides (e.g. rotating QB tokens) — also silent
  const localEnvPath = resolve(REPO_ROOT, 'local.env');
  if (existsSync(localEnvPath)) {
    dotenvConfig({ path: localEnvPath, override: true });
  }
}

/**
 * Load .env + local.env and validate required variables.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.required]       Vars that must be set (non-empty).
 * @param {Record<string,string>} [opts.defaults]  Applied when unset.
 * @param {boolean} [opts.noSupabaseDefault]  Skip the SUPABASE_URL default.
 * @returns {Record<string,string|undefined>} snapshot of env vars
 */
export function loadEnv(opts = {}) {
  loadDotenvOnce();

  const required = opts.required || [];
  const defaults = { ...(opts.defaults || {}) };

  if (!opts.noSupabaseDefault && !process.env.SUPABASE_URL && !defaults.SUPABASE_URL) {
    defaults.SUPABASE_URL = DEFAULT_SUPABASE_URL;
  }

  for (const [k, v] of Object.entries(defaults)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v;
    }
  }

  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new FatalError(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      `Set them in .env, local.env, or your shell.`,
      { context: { missing } }
    );
  }

  // Return a snapshot — tests and callers shouldn't mutate process.env via us.
  return { ...process.env };
}

/**
 * Shorthand: load env, requiring SUPABASE_SERVICE_ROLE_KEY.
 * Most scripts want exactly this.
 */
export function loadSupabaseEnv(extraRequired = []) {
  return loadEnv({
    required: ['SUPABASE_SERVICE_ROLE_KEY', ...extraRequired],
  });
}
