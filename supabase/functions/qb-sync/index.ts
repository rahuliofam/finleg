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

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

/**
 * Refresh QB access token if expired.
 */
async function ensureValidToken(supabase: any, token: QBToken): Promise<QBToken> {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();

  // Refresh if expiring within 5 minutes
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

  // Save refreshed token
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

/**
 * Make an authenticated QB API request.
 */
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

/**
 * Fetch all purchases (expenses) from QB since a given date.
 */
async function fetchPurchases(token: QBToken, sinceDate: string, isSandbox: boolean): Promise<any[]> {
  const query = encodeURIComponent(
    `SELECT * FROM Purchase WHERE MetaData.LastUpdatedTime >= '${sinceDate}' ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 1000`
  );
  const data = await qbRequest(token, `query?query=${query}`, isSandbox);
  return data?.QueryResponse?.Purchase || [];
}

/**
 * Fetch all deposits from QB since a given date.
 */
async function fetchDeposits(token: QBToken, sinceDate: string, isSandbox: boolean): Promise<any[]> {
  const query = encodeURIComponent(
    `SELECT * FROM Deposit WHERE MetaData.LastUpdatedTime >= '${sinceDate}' ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 1000`
  );
  const data = await qbRequest(token, `query?query=${query}`, isSandbox);
  return data?.QueryResponse?.Deposit || [];
}

/**
 * Fetch all transfers from QB since a given date.
 */
async function fetchTransfers(token: QBToken, sinceDate: string, isSandbox: boolean): Promise<any[]> {
  const query = encodeURIComponent(
    `SELECT * FROM Transfer WHERE MetaData.LastUpdatedTime >= '${sinceDate}' ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 1000`
  );
  const data = await qbRequest(token, `query?query=${query}`, isSandbox);
  return data?.QueryResponse?.Transfer || [];
}

/**
 * Apply category rules to a vendor name.
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
      // Update hit count
      await supabase
        .from("category_rules")
        .update({ hit_count: (rule.hit_count || 0) + 1, last_hit_at: new Date().toISOString() })
        .eq("id", rule.id);

      return { category: rule.category, ruleId: rule.id };
    }
  }

  return null;
}

/**
 * Transform a QB Purchase into our qb_transactions format.
 */
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

/**
 * Transform a QB Deposit into our qb_transactions format.
 */
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

/**
 * Transform a QB Transfer into our qb_transactions format.
 */
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

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = getSupabase();
  const isSandbox = (Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox") === "sandbox";

  try {
    // Get stored token
    const { data: tokens, error: tokenError } = await supabase
      .from("qb_tokens")
      .select("*")
      .limit(1)
      .single();

    if (tokenError || !tokens) {
      return new Response(
        JSON.stringify({ error: "No QB token found. Complete OAuth flow first." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Refresh if needed
    const validToken = await ensureValidToken(supabase, tokens);

    // Determine sync window — last 30 days or since last sync
    const { data: lastSync } = await supabase
      .from("qb_transactions")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    const sinceDate = lastSync?.synced_at
      ? new Date(new Date(lastSync.synced_at).getTime() - 2 * 86400000).toISOString().split("T")[0]
      : new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    console.log(`Syncing transactions since ${sinceDate}...`);

    // Fetch all transaction types
    const [purchases, deposits, transfers] = await Promise.all([
      fetchPurchases(validToken, sinceDate, isSandbox),
      fetchDeposits(validToken, sinceDate, isSandbox),
      fetchTransfers(validToken, sinceDate, isSandbox),
    ]);

    console.log(`Fetched: ${purchases.length} purchases, ${deposits.length} deposits, ${transfers.length} transfers`);

    // Transform all transactions
    const allTxns = [
      ...purchases.map(transformPurchase),
      ...deposits.map(transformDeposit),
      ...transfers.map(transformTransfer),
    ];

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

      // Upsert (update if exists, insert if new)
      const { data: existing } = await supabase
        .from("qb_transactions")
        .select("id")
        .eq("qb_id", txn.qb_id)
        .eq("qb_type", txn.qb_type)
        .single();

      if (existing) {
        await supabase
          .from("qb_transactions")
          .update({
            ...txn,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("qb_transactions").insert({
          ...txn,
          synced_at: new Date().toISOString(),
        });
        inserted++;
      }
    }

    // Log activity
    await supabase.from("bookkeeping_activity_log").insert({
      action: "txn_synced",
      entity_type: "qb_transaction",
      actor: "system",
      details: {
        since_date: sinceDate,
        fetched: allTxns.length,
        inserted,
        updated,
        auto_categorized: categorized,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        synced: allTxns.length,
        inserted,
        updated,
        auto_categorized: categorized,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("QB sync error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
