/**
 * QB Sync — pulls Purchase/Deposit/Transfer/JournalEntry entities from the
 * QuickBooks Online API into `qb_transactions`, applies vendor-based
 * `category_rules`, detects soft-deletes, and records a `sync_runs` row.
 * Expects a POST body (optional) with `{syncType, triggeredBy, sinceDate?}`.
 * Uses sandbox vs production API based on `QUICKBOOKS_ENVIRONMENT`.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_SANDBOX_URL = "https://sandbox-quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

interface QBToken {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
}

interface SyncOptions {
  syncType: "scheduled_weekly" | "scheduled_daily" | "manual";
  triggeredBy: string;
  sinceDate?: string; // Override auto-calculated since date
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

// ============================================================
// Token management
// ============================================================

/**
 * Returns a token guaranteed valid for the next ~5 min. Refreshes via the QB
 * OAuth2 refresh grant when the current access token is within that window of
 * expiry; persists the rotated `refresh_token` (QB may issue a new one) and
 * updated expiry timestamps back to `qb_tokens`.
 * @throws if client credentials are missing or the refresh call fails.
 */
async function ensureValidToken(supabase: any, token: QBToken): Promise<QBToken> {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();

  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return token;
  }

  console.log("Access token expired, refreshing...");

  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("QB client credentials not set");

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const newToken: QBToken = {
    realm_id: token.realm_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(
      Date.now() + (data.x_refresh_token_expires_in || 8726400) * 1000
    ).toISOString(),
  };

  await supabase
    .from("qb_tokens")
    .update({
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
      expires_at: newToken.expires_at,
      refresh_expires_at: newToken.refresh_expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("realm_id", token.realm_id);

  console.log("Token refreshed successfully");
  return newToken;
}

// ============================================================
// QB API helpers
// ============================================================

async function qbRequest(token: QBToken, endpoint: string, isSandbox: boolean): Promise<any> {
  const base = isSandbox ? QB_SANDBOX_URL : QB_BASE_URL;
  const url = `${base}/v3/company/${token.realm_id}/${endpoint}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QB API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchQBEntity(
  token: QBToken,
  entityName: string,
  sinceDate: string,
  isSandbox: boolean
): Promise<any[]> {
  const query = encodeURIComponent(
    `SELECT * FROM ${entityName} WHERE MetaData.LastUpdatedTime >= '${sinceDate}' ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 1000`
  );
  const data = await qbRequest(token, `query?query=${query}`, isSandbox);
  return data?.QueryResponse?.[entityName] || [];
}

async function fetchAccounts(token: QBToken, isSandbox: boolean): Promise<any[]> {
  const query = encodeURIComponent(`SELECT * FROM Account MAXRESULTS 1000`);
  const data = await qbRequest(token, `query?query=${query}`, isSandbox);
  return data?.QueryResponse?.Account || [];
}

// ============================================================
// Category rules
// ============================================================

/**
 * Finds the first active `category_rules` row whose pattern matches the
 * vendor (exact/contains/starts_with/regex, case-insensitive). Rules are
 * ordered by descending priority, so more specific rules win. Invalid regex
 * patterns are silently skipped. On a match, bumps `hit_count` and
 * `last_hit_at` for the rule.
 */
async function applyCategoryRules(
  supabase: any,
  vendorName: string
): Promise<{ category: string; ruleId: string } | null> {
  if (!vendorName) return null;

  const { data: rules } = await supabase
    .from("category_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (!rules?.length) return null;

  const vendorLower = vendorName.toLowerCase();

  for (const rule of rules) {
    const pattern = rule.match_pattern.toLowerCase();
    let matched = false;

    switch (rule.match_type) {
      case "exact":
        matched = vendorLower === pattern;
        break;
      case "contains":
        matched = vendorLower.includes(pattern);
        break;
      case "starts_with":
        matched = vendorLower.startsWith(pattern);
        break;
      case "regex":
        try {
          matched = new RegExp(rule.match_pattern, "i").test(vendorName);
        } catch { /* invalid regex */ }
        break;
    }

    if (matched) {
      await supabase
        .from("category_rules")
        .update({ hit_count: (rule.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
        .eq("id", rule.id);

      return { category: rule.category, ruleId: rule.id };
    }
  }

  return null;
}

// ============================================================
// Transform QB entities → qb_transactions format
// ============================================================

function transformPurchase(purchase: any): any {
  const line = purchase.Line?.[0];
  const accountRef = purchase.AccountRef;
  const entityRef = purchase.EntityRef;

  return {
    qb_id: purchase.Id,
    qb_type: "Purchase",
    qb_account_name: accountRef?.name || null,
    qb_account_id: accountRef?.value || null,
    txn_date: purchase.TxnDate,
    amount: purchase.TotalAmt || 0,
    vendor_name: entityRef?.name || null,
    description: line?.Description || purchase.PrivateNote || null,
    memo: purchase.PrivateNote || null,
    qb_category_name: line?.AccountBasedExpenseLineDetail?.AccountRef?.name || null,
    qb_category_id: line?.AccountBasedExpenseLineDetail?.AccountRef?.value || null,
    qb_last_modified: purchase.MetaData?.LastUpdatedTime || null,
  };
}

function transformDeposit(deposit: any): any {
  const line = deposit.Line?.[0];
  const accountRef = deposit.DepositToAccountRef;

  return {
    qb_id: deposit.Id,
    qb_type: "Deposit",
    qb_account_name: accountRef?.name || null,
    qb_account_id: accountRef?.value || null,
    txn_date: deposit.TxnDate,
    amount: deposit.TotalAmt || 0,
    vendor_name: line?.DepositLineDetail?.Entity?.name || null,
    description: line?.Description || deposit.PrivateNote || null,
    memo: deposit.PrivateNote || null,
    qb_category_name: null,
    qb_category_id: null,
    qb_last_modified: deposit.MetaData?.LastUpdatedTime || null,
  };
}

function transformTransfer(transfer: any): any {
  return {
    qb_id: transfer.Id,
    qb_type: "Transfer",
    qb_account_name: transfer.FromAccountRef?.name || null,
    qb_account_id: transfer.FromAccountRef?.value || null,
    txn_date: transfer.TxnDate,
    amount: transfer.Amount || 0,
    vendor_name: `Transfer to ${transfer.ToAccountRef?.name || "?"}`,
    description: transfer.PrivateNote || null,
    memo: transfer.PrivateNote || null,
    qb_category_name: "Transfer",
    qb_category_id: null,
    qb_last_modified: transfer.MetaData?.LastUpdatedTime || null,
  };
}

function transformJournalEntry(je: any): any {
  const creditLine = je.Line?.find((l: any) => l.JournalEntryLineDetail?.PostingType === "Credit");
  const debitLine = je.Line?.find((l: any) => l.JournalEntryLineDetail?.PostingType === "Debit");

  return {
    qb_id: je.Id,
    qb_type: "JournalEntry",
    qb_account_name: debitLine?.JournalEntryLineDetail?.AccountRef?.name || null,
    qb_account_id: debitLine?.JournalEntryLineDetail?.AccountRef?.value || null,
    txn_date: je.TxnDate,
    amount: creditLine?.Amount || debitLine?.Amount || 0,
    vendor_name: je.Line?.[0]?.JournalEntryLineDetail?.Entity?.EntityRef?.name || null,
    description: creditLine?.Description || debitLine?.Description || je.PrivateNote || null,
    memo: je.PrivateNote || null,
    qb_category_name: creditLine?.JournalEntryLineDetail?.AccountRef?.name || null,
    qb_category_id: creditLine?.JournalEntryLineDetail?.AccountRef?.value || null,
    qb_last_modified: je.MetaData?.LastUpdatedTime || null,
  };
}

// ============================================================
// Soft-delete detection
// ============================================================

/**
 * Soft-deletes local transactions that no longer appear in the QB fetch for
 * the sync window. `fetchedQBIds` must use composite `qb_id:qb_type` keys —
 * the same Id can legitimately reuse across entity types in QB. Returns the
 * count of rows newly marked `is_deleted=true`.
 */
async function detectDeletedTransactions(
  supabase: any,
  sinceDate: string,
  fetchedQBIds: Set<string>
) {
  // Get all non-deleted DB transactions in the sync date range
  const { data: dbTxns } = await supabase
    .from("qb_transactions")
    .select("id, qb_id, qb_type")
    .eq("is_deleted", false)
    .gte("txn_date", sinceDate);

  if (!dbTxns?.length) return 0;

  let deletedCount = 0;
  for (const txn of dbTxns) {
    const compositeKey = `${txn.qb_id}:${txn.qb_type}`;
    if (!fetchedQBIds.has(compositeKey)) {
      await supabase
        .from("qb_transactions")
        .update({
          is_deleted: true,
          deleted_detected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", txn.id);
      deletedCount++;
    }
  }

  return deletedCount;
}

// ============================================================
// Main sync handler
// ============================================================

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = getSupabase();
  const isSandbox = (Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox") === "sandbox";

  // Parse request options
  let options: SyncOptions = { syncType: "manual", triggeredBy: "admin" };
  try {
    const body = await req.json();
    if (body.syncType) options.syncType = body.syncType;
    if (body.triggeredBy) options.triggeredBy = body.triggeredBy;
    if (body.sinceDate) options.sinceDate = body.sinceDate;
  } catch {
    // Empty body is fine for manual triggers
  }

  // Create sync run record
  const { data: syncRun, error: syncRunError } = await supabase
    .from("sync_runs")
    .insert({
      sync_type: options.syncType,
      triggered_by: options.triggeredBy,
      status: "running",
    })
    .select()
    .single();

  if (syncRunError) {
    console.error("Failed to create sync run:", syncRunError);
  }

  try {
    // Get stored token
    const { data: tokens, error: tokenError } = await supabase
      .from("qb_tokens")
      .select("*")
      .limit(1)
      .single();

    if (tokenError || !tokens) {
      throw new Error("No QB token found. Complete OAuth flow first.");
    }

    // Refresh if needed
    const validToken = await ensureValidToken(supabase, tokens);

    // Determine sync window
    let sinceDate: string;
    if (options.sinceDate) {
      sinceDate = options.sinceDate;
    } else {
      // Look at last successful sync run
      const { data: lastRun } = await supabase
        .from("sync_runs")
        .select("completed_at, since_date")
        .eq("status", "success")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single();

      if (lastRun?.completed_at) {
        // Overlap by 2 days from last sync to catch any delayed updates
        sinceDate = new Date(new Date(lastRun.completed_at).getTime() - 2 * 86400000)
          .toISOString()
          .split("T")[0];
      } else {
        // First sync or no successful runs — pull last 30 days
        sinceDate = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      }

      // Weekly full syncs pull 35 days to ensure complete coverage
      if (options.syncType === "scheduled_weekly") {
        sinceDate = new Date(Date.now() - 35 * 86400000).toISOString().split("T")[0];
      }
    }

    // Update sync run with since_date
    if (syncRun) {
      await supabase
        .from("sync_runs")
        .update({ since_date: sinceDate })
        .eq("id", syncRun.id);
    }

    console.log(`Syncing transactions since ${sinceDate} (type: ${options.syncType})...`);

    // Fetch all transaction types in parallel
    const [purchases, deposits, transfers, journalEntries] = await Promise.all([
      fetchQBEntity(validToken, "Purchase", sinceDate, isSandbox),
      fetchQBEntity(validToken, "Deposit", sinceDate, isSandbox),
      fetchQBEntity(validToken, "Transfer", sinceDate, isSandbox),
      fetchQBEntity(validToken, "JournalEntry", sinceDate, isSandbox),
    ]);

    const entityCounts = {
      purchases: purchases.length,
      deposits: deposits.length,
      transfers: transfers.length,
      journal_entries: journalEntries.length,
    };

    console.log(`Fetched: ${JSON.stringify(entityCounts)}`);

    // Also fetch account list for integrity tracking (non-blocking)
    fetchAccounts(validToken, isSandbox).then(accounts => {
      console.log(`Fetched ${accounts.length} QB accounts (for reference)`);
      // Could store in a qb_accounts table in a future phase
    }).catch(err => {
      console.warn("Failed to fetch accounts (non-critical):", err.message);
    });

    // Transform all transactions
    const allTxns = [
      ...purchases.map(transformPurchase),
      ...deposits.map(transformDeposit),
      ...transfers.map(transformTransfer),
      ...journalEntries.map(transformJournalEntry),
    ];

    // Track fetched QB IDs for soft-delete detection
    const fetchedQBIds = new Set<string>();
    for (const txn of allTxns) {
      fetchedQBIds.add(`${txn.qb_id}:${txn.qb_type}`);
    }

    let inserted = 0;
    let updated = 0;
    let categorized = 0;

    for (const txn of allTxns) {
      // Apply category rules
      const ruleMatch = await applyCategoryRules(supabase, txn.vendor_name);
      if (ruleMatch) {
        txn.our_category = ruleMatch.category;
        txn.category_confidence = 1.0;
        txn.category_source = "rule";
        txn.review_status = "auto_categorized";
        categorized++;
      } else if (txn.qb_category_name) {
        txn.our_category = txn.qb_category_name;
        txn.category_source = "qb";
        txn.category_confidence = 0.7;
        txn.review_status = "auto_categorized";
      } else {
        txn.review_status = "pending";
      }

      // Proper upsert using ON CONFLICT — no race conditions
      const { data: upserted, error: upsertErr } = await supabase
        .from("qb_transactions")
        .upsert(
          {
            ...txn,
            is_deleted: false,
            deleted_detected_at: null,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "qb_id,qb_type", ignoreDuplicates: false }
        )
        .select("id");

      if (upsertErr) {
        console.error(`Upsert error for ${txn.qb_id}/${txn.qb_type}:`, upsertErr.message);
        continue;
      }

      // Track insert vs update (upsert always returns data, check created_at vs updated_at)
      // Simpler: just count total, break out in activity log
      inserted++; // Simplified — the ON CONFLICT handles dedup
    }

    // Soft-delete detection for weekly syncs
    let deletedCount = 0;
    if (options.syncType === "scheduled_weekly") {
      deletedCount = await detectDeletedTransactions(supabase, sinceDate, fetchedQBIds);
      if (deletedCount > 0) {
        console.log(`Detected ${deletedCount} deleted transactions`);
      }
    }

    // Update sync run as success
    if (syncRun) {
      await supabase
        .from("sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "success",
          entities_fetched: entityCounts,
          entities_new: inserted,
          entities_updated: updated,
        })
        .eq("id", syncRun.id);
    }

    // Log activity
    await supabase.from("bookkeeping_activity_log").insert({
      action: "txn_synced",
      entity_type: "qb_transaction",
      actor: "system",
      details: {
        sync_run_id: syncRun?.id,
        sync_type: options.syncType,
        since_date: sinceDate,
        fetched: entityCounts,
        upserted: allTxns.length,
        auto_categorized: categorized,
        soft_deleted: deletedCount,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        sync_run_id: syncRun?.id,
        sync_type: options.syncType,
        since_date: sinceDate,
        fetched: entityCounts,
        upserted: allTxns.length,
        auto_categorized: categorized,
        soft_deleted: deletedCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("QB sync error:", err);

    // Update sync run as error
    if (syncRun) {
      await supabase
        .from("sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error_message: String(err),
        })
        .eq("id", syncRun.id);
    }

    return new Response(JSON.stringify({ error: String(err), sync_run_id: syncRun?.id }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
