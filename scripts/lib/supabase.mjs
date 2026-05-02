/**
 * Authenticated Supabase client factory for scripts/.
 *
 * Wraps @supabase/supabase-js's createClient() with finleg defaults:
 *   - URL defaults to the finleg project.
 *   - Uses SUPABASE_SERVICE_ROLE_KEY (never the anon key) — these scripts run
 *     server-side and need bypass-RLS access.
 *   - Disables auth token persistence (irrelevant for service-role scripts).
 *
 * Usage:
 *   import { createSupabaseClient } from './lib/supabase.mjs';
 *   const supabase = createSupabaseClient();
 *   // or:
 *   const supabase = createSupabaseClient({ env });  // pass a loadEnv() snapshot
 *
 * Also exports fetchAllPages() — a helper for the common "paginate until empty"
 * pattern used by fix-missing-index.mjs, ingest-statements.mjs, etc.
 */

import { createClient } from '@supabase/supabase-js';
import { FatalError } from './errors.mjs';

const DEFAULT_URL = 'https://gjdvzzxsrzuorguwkaih.supabase.co';

/**
 * @param {object} [opts]
 * @param {Record<string, any>} [opts.env]  Env snapshot (from loadEnv); falls back to process.env.
 * @param {string} [opts.url]               Override URL.
 * @param {string} [opts.key]               Override service-role key.
 */
export function createSupabaseClient(opts = {}) {
  const env = opts.env || process.env;
  const url = opts.url || env.SUPABASE_URL || DEFAULT_URL;
  const key = opts.key || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new FatalError(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env or export it, ' +
      'or call loadEnv({ required: ["SUPABASE_SERVICE_ROLE_KEY"] }) first.'
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Page through a Supabase query in chunks of pageSize, returning all rows.
 *
 * Usage:
 *   const rows = await fetchAllPages((offset, limit) =>
 *     supabase.from('document_index').select('r2_key').range(offset, offset + limit - 1)
 *   );
 *
 * @param {(offset: number, limit: number) => Promise<{ data: any[]|null, error: any }>} fetchPage
 * @param {object} [opts]
 * @param {number} [opts.pageSize=1000]
 * @returns {Promise<any[]>}
 */
export async function fetchAllPages(fetchPage, opts = {}) {
  const pageSize = opts.pageSize ?? 1000;
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) throw new FatalError(`Supabase pagination failed: ${error.message}`, { cause: error });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

/**
 * Insert rows in batches — safer than one giant insert, and writes log updates
 * between batches via an optional progress callback.
 *
 * Returns the total number of rows successfully inserted.
 */
export async function batchInsert(supabase, table, rows, opts = {}) {
  const size = opts.batchSize ?? 200;
  const onProgress = opts.onProgress; // (done, total) => void
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const query = supabase.from(table).insert(batch);
    const { error } = opts.upsert ? await query.upsert(batch) : await query;
    if (error) {
      throw new FatalError(`Insert into ${table} failed at batch ${i / size}: ${error.message}`, {
        cause: error,
        context: { table, batchStart: i, batchSize: batch.length },
      });
    }
    done += batch.length;
    if (onProgress) onProgress(done, rows.length);
  }
  return done;
}
