import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Uses PlaidPlus schema: institutions, accounts, holdings, securities,
// transactions, account_balances, oauth_tokens, brokerage_sync_runs

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const SCHWAB_TRADER_URL = "https://api.schwabapi.com/trader/v1";
const SCHWAB_INSTITUTION_NAME = "Charles Schwab";

interface SyncOptions {
  syncType: "scheduled" | "manual";
  triggeredBy: string;
  includeTransactions?: boolean;
  transactionDays?: number;
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

// ============================================================
// Encryption — AES-256-GCM via Web Crypto (matches Worker format)
// ============================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importEncryptionKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function decrypt(blob: string, key: CryptoKey): Promise<string> {
  const [ivB64, ciphertextB64] = blob.split(".");
  if (!ivB64 || !ciphertextB64) throw new Error("Invalid encrypted format");
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

// ============================================================
// Token management
// ============================================================

async function ensureValidToken(
  supabase: any,
  tokenRecord: any,
  encKey: CryptoKey
): Promise<string> {
  const expiresAt = new Date(tokenRecord.access_token_expires_at);
  const now = new Date();

  if (expiresAt.getTime() - now.getTime() > 2 * 60 * 1000) {
    return decrypt(tokenRecord.access_token, encKey);
  }

  console.log("Access token expired, refreshing...");

  const refreshToken = await decrypt(tokenRecord.refresh_token, encKey);
  const appKey = Deno.env.get("SCHWAB_APP_KEY");
  const appSecret = Deno.env.get("SCHWAB_APP_SECRET");
  if (!appKey || !appSecret) throw new Error("SCHWAB_APP_KEY/SECRET not set");

  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await supabase
      .from("oauth_tokens")
      .update({ status: "expired", error_message: `Refresh failed: ${res.status}` })
      .eq("id", tokenRecord.id);
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const nowMs = Date.now();

  await supabase
    .from("oauth_tokens")
    .update({
      access_token: await encrypt(data.access_token, encKey),
      refresh_token: await encrypt(data.refresh_token, encKey),
      access_token_expires_at: new Date(nowMs + data.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "active",
      last_refreshed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", tokenRecord.id);

  console.log("Token refreshed successfully");
  return data.access_token;
}

// ============================================================
// Schwab API helpers
// ============================================================

async function schwabFetch<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${SCHWAB_TRADER_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Schwab API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ============================================================
// Security upsert helper
// ============================================================

async function upsertSecurity(
  supabase: any,
  instrument: { symbol?: string; cusip?: string; assetType?: string; description?: string }
): Promise<string | null> {
  if (!instrument.symbol) return null;

  const securityType = mapAssetType(instrument.assetType);

  const { data } = await supabase
    .from("securities")
    .upsert(
      {
        ticker_symbol: instrument.symbol,
        cusip: instrument.cusip || null,
        name: instrument.description || instrument.symbol,
        security_type: securityType,
      },
      { onConflict: "ticker_symbol", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  return data?.id || null;
}

function mapAssetType(schwabType?: string): string {
  const map: Record<string, string> = {
    EQUITY: "equity",
    MUTUAL_FUND: "mutual_fund",
    ETF: "etf",
    FIXED_INCOME: "bond",
    OPTION: "option",
    CASH_EQUIVALENT: "money_market",
    CURRENCY: "cash",
  };
  return map[schwabType || ""] || "other";
}

function mapTransactionType(schwabType?: string): string {
  const map: Record<string, string> = {
    TRADE: "buy",
    RECEIVE_AND_DELIVER: "transfer",
    DIVIDEND_OR_INTEREST: "dividend",
    ACH_RECEIPT: "deposit",
    ACH_DISBURSEMENT: "withdrawal",
    CASH_RECEIPT: "deposit",
    CASH_DISBURSEMENT: "withdrawal",
    ELECTRONIC_FUND: "transfer",
    WIRE_IN: "deposit",
    WIRE_OUT: "withdrawal",
    JOURNAL: "adjustment",
  };
  return map[schwabType || ""] || "other";
}

function mapAccountType(schwabType?: string): string {
  const map: Record<string, string> = {
    BROKERAGE: "brokerage",
    IRA: "ira",
    ROTH_IRA: "roth_ira",
    "401K": "401k",
    "403B": "403b",
    TRUST: "trust",
    CHECKING: "checking",
    SAVINGS: "savings",
  };
  return map[schwabType || ""] || "brokerage";
}

// ============================================================
// Main sync handler
// ============================================================

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = getSupabase();

  let options: SyncOptions = { syncType: "manual", triggeredBy: "admin", includeTransactions: true, transactionDays: 30 };
  try {
    const body = await req.json();
    if (body.syncType) options.syncType = body.syncType;
    if (body.triggeredBy) options.triggeredBy = body.triggeredBy;
    if (body.includeTransactions !== undefined) options.includeTransactions = body.includeTransactions;
    if (body.transactionDays) options.transactionDays = body.transactionDays;
  } catch {
    // Empty body is fine
  }

  // Look up Schwab institution
  const { data: institution } = await supabase
    .from("institutions")
    .select("id")
    .eq("name", SCHWAB_INSTITUTION_NAME)
    .single();

  if (!institution) {
    return new Response(JSON.stringify({ error: "Charles Schwab institution not found" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const institutionId = institution.id;

  // Create sync run
  const { data: syncRun } = await supabase
    .from("brokerage_sync_runs")
    .insert({
      institution_id: institutionId,
      sync_type: options.syncType,
      triggered_by: options.triggeredBy,
      status: "running",
    })
    .select()
    .single();

  try {
    // Get stored tokens
    const { data: tokenRecord, error: tokenError } = await supabase
      .from("oauth_tokens")
      .select("*")
      .eq("institution_id", institutionId)
      .single();

    if (tokenError || !tokenRecord) {
      throw new Error("No Schwab tokens found. Complete OAuth flow first.");
    }

    if (tokenRecord.status !== "active") {
      throw new Error(`Schwab connection is ${tokenRecord.status}. Re-authenticate via OAuth.`);
    }

    if (tokenRecord.refresh_token_expires_at && new Date() >= new Date(tokenRecord.refresh_token_expires_at)) {
      throw new Error("SCHWAB_REFRESH_EXPIRED — re-authenticate via OAuth");
    }

    const encKeyHex = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKeyHex) throw new Error("TOKEN_ENCRYPTION_KEY not set");
    const encKey = await importEncryptionKey(encKeyHex);

    const accessToken = await ensureValidToken(supabase, tokenRecord, encKey);

    // 1. Fetch account numbers
    const accountNumbers: Array<{ accountNumber: string; hashValue: string }> =
      await schwabFetch(accessToken, "/accounts/accountNumbers");

    console.log(`Found ${accountNumbers.length} Schwab accounts`);

    // 2. Fetch accounts with positions
    const accounts: any[] = await schwabFetch(accessToken, "/accounts?fields=positions");

    let totalHoldings = 0;
    let totalTransactions = 0;

    for (const acct of accounts) {
      const sa = acct.securitiesAccount;
      if (!sa) continue;

      const acctNum = sa.accountNumber;
      const hashEntry = accountNumbers.find((a: any) => a.accountNumber === acctNum);
      if (!hashEntry) continue;

      const accountType = mapAccountType(sa.type);

      // Upsert account
      const { data: dbAccount } = await supabase
        .from("accounts")
        .upsert(
          {
            institution_id: institutionId,
            account_number_masked: `****${acctNum.slice(-4)}`,
            account_type: accountType,
            external_account_id: hashEntry.hashValue,
            connection_type: "api",
            is_active: true,
            last_synced_at: new Date().toISOString(),
            total_value: sa.currentBalances?.liquidationValue ?? null,
            cash_balance: sa.currentBalances?.cashBalance ?? null,
            buying_power: sa.currentBalances?.buyingPower ?? null,
            balance_current: sa.currentBalances?.liquidationValue ?? null,
            balance_available: sa.currentBalances?.availableFunds ?? null,
          },
          { onConflict: "institution_id,external_account_id" }
        )
        .select("id")
        .single();

      if (!dbAccount) continue;
      const accountId = dbAccount.id;

      // Upsert holdings
      if (sa.positions?.length) {
        const currentSecurityIds: string[] = [];

        for (const pos of sa.positions) {
          if (!pos.instrument?.symbol) continue;

          const securityId = await upsertSecurity(supabase, pos.instrument);
          if (!securityId) continue;
          currentSecurityIds.push(securityId);

          await supabase.from("holdings").upsert(
            {
              account_id: accountId,
              security_id: securityId,
              quantity: pos.longQuantity || 0,
              cost_basis: pos.averagePrice ? (pos.longQuantity || 0) * pos.averagePrice : null,
              market_value: pos.marketValue || null,
              price: pos.averagePrice || null,
              price_as_of: new Date().toISOString(),
              unrealized_gain_loss: pos.longOpenProfitLoss || null,
              unrealized_gain_loss_pct: pos.currentDayProfitLossPercentage || null,
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: "account_id,security_id" }
          );
          totalHoldings++;
        }

        // Remove stale holdings
        if (currentSecurityIds.length > 0) {
          await supabase
            .from("holdings")
            .delete()
            .eq("account_id", accountId)
            .not("security_id", "in", `(${currentSecurityIds.join(",")})`);
        }
      }

      // Snapshot daily balances
      const today = new Date().toISOString().split("T")[0];
      if (sa.currentBalances) {
        const bal = sa.currentBalances;
        await supabase.from("account_balances").upsert(
          {
            account_id: accountId,
            snapshot_date: today,
            balance_current: bal.liquidationValue ?? null,
            balance_available: bal.availableFunds ?? null,
            total_value: bal.liquidationValue ?? null,
            cash_balance: bal.cashBalance ?? null,
            long_market_value: bal.longMarketValue ?? null,
            buying_power: bal.buyingPower ?? null,
          },
          { onConflict: "account_id,snapshot_date" }
        );
      }

      // 3. Fetch transactions
      if (options.includeTransactions) {
        const days = options.transactionDays || 30;
        const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
        const endDate = new Date().toISOString().split("T")[0];

        try {
          const txnData: any = await schwabFetch(
            accessToken,
            `/accounts/${hashEntry.hashValue}/transactions?startDate=${startDate}&endDate=${endDate}`
          );

          const txns = Array.isArray(txnData) ? txnData : txnData?.transactions || [];

          for (const txn of txns) {
            const externalId = String(txn.activityId || txn.transactionId || `${txn.type}-${txn.tradeDate}-${txn.netAmount}`);
            const symbol = txn.transferItems?.[0]?.instrument?.symbol;

            let securityId: string | null = null;
            if (symbol) {
              securityId = await upsertSecurity(supabase, {
                symbol,
                cusip: txn.transferItems?.[0]?.instrument?.cusip,
                assetType: txn.transferItems?.[0]?.instrument?.assetType,
                description: txn.transferItems?.[0]?.instrument?.description,
              });
            }

            await supabase.from("transactions").upsert(
              {
                account_id: accountId,
                security_id: securityId,
                external_id: externalId,
                transaction_type: mapTransactionType(txn.type),
                transaction_subtype: txn.type || null,
                transaction_date: txn.tradeDate ? txn.tradeDate.split("T")[0] : today,
                settlement_date: txn.settlementDate ? txn.settlementDate.split("T")[0] : null,
                amount: txn.netAmount || 0,
                quantity: txn.transferItems?.[0]?.amount || null,
                price: txn.transferItems?.[0]?.price || null,
                fees: txn.totalFees || 0,
                net_amount: txn.netAmount || null,
                description: txn.description || null,
                source: "api",
                synced_at: new Date().toISOString(),
              },
              { onConflict: "account_id,external_id" }
            );
            totalTransactions++;
          }
        } catch (txnErr) {
          console.warn(`Transaction fetch failed for ****${acctNum.slice(-4)}:`, txnErr);
        }
      }
    }

    // Update sync run
    if (syncRun) {
      await supabase
        .from("brokerage_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "success",
          accounts_synced: accounts.length,
          holdings_synced: totalHoldings,
          transactions_synced: totalTransactions,
        })
        .eq("id", syncRun.id);
    }

    const result = {
      success: true,
      sync_run_id: syncRun?.id,
      accounts: accounts.length,
      holdings: totalHoldings,
      transactions: totalTransactions,
    };

    console.log("Schwab sync completed:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Schwab sync error:", err);

    if (syncRun) {
      await supabase
        .from("brokerage_sync_runs")
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
