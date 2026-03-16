import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * QB Writeback — Executes approved changes by pushing data back to QuickBooks.
 *
 * Processes entries from qb_writeback_queue where status = 'approved'.
 * Uses QB sparse update API to modify specific fields on existing entities.
 */

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

async function ensureValidToken(supabase: any, token: QBToken): Promise<QBToken> {
  const expiresAt = new Date(token.expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return token;

  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("QB client credentials not set");

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();

  const newToken: QBToken = {
    realm_id: token.realm_id,
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + (data.x_refresh_token_expires_in || 8726400) * 1000).toISOString(),
  };

  await supabase.from("qb_tokens").update({
    access_token: newToken.access_token,
    refresh_token: newToken.refresh_token,
    expires_at: newToken.expires_at,
    refresh_expires_at: newToken.refresh_expires_at,
    updated_at: new Date().toISOString(),
  }).eq("realm_id", token.realm_id);

  return newToken;
}

async function qbSparseUpdate(
  token: QBToken,
  entityType: string,
  entityId: string,
  updateFields: Record<string, any>,
  isSandbox: boolean
): Promise<any> {
  const base = isSandbox ? QB_SANDBOX_URL : QB_BASE_URL;

  // First, read the current entity to get SyncToken
  const readUrl = `${base}/v3/company/${token.realm_id}/${entityType.toLowerCase()}/${entityId}?minorversion=73`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
  });

  if (!readRes.ok) {
    const text = await readRes.text();
    throw new Error(`Failed to read ${entityType} ${entityId}: ${readRes.status} ${text}`);
  }

  const readData = await readRes.json();
  const entity = readData[entityType];
  if (!entity) throw new Error(`Entity ${entityType} ${entityId} not found`);

  // Sparse update
  const updateUrl = `${base}/v3/company/${token.realm_id}/${entityType.toLowerCase()}?operation=update&minorversion=73`;
  const updateBody = {
    Id: entityId,
    SyncToken: entity.SyncToken,
    sparse: true,
    ...updateFields,
  };

  const updateRes = await fetch(updateUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(updateBody),
  });

  if (!updateRes.ok) {
    const text = await updateRes.text();
    throw new Error(`Failed to update ${entityType} ${entityId}: ${updateRes.status} ${text}`);
  }

  return updateRes.json();
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = getSupabase();
  const isSandbox = (Deno.env.get("QUICKBOOKS_ENVIRONMENT") || "sandbox") === "sandbox";

  try {
    // Get QB token
    const { data: tokens } = await supabase.from("qb_tokens").select("*").limit(1).single();
    if (!tokens) throw new Error("No QB token found");
    const validToken = await ensureValidToken(supabase, tokens);

    // Get approved writeback entries
    const { data: queue } = await supabase
      .from("qb_writeback_queue")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .limit(20);

    if (!queue?.length) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No approved writebacks" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let executed = 0;
    let failed = 0;

    for (const entry of queue) {
      try {
        // Build the update fields based on field_name
        const updateFields: Record<string, any> = {};

        switch (entry.field_name) {
          case "PrivateNote":
            updateFields.PrivateNote = entry.new_value;
            break;
          case "AccountRef":
            updateFields.AccountRef = JSON.parse(entry.new_value);
            break;
          case "Line":
            updateFields.Line = JSON.parse(entry.new_value);
            break;
          default:
            updateFields[entry.field_name] = entry.new_value;
        }

        await qbSparseUpdate(validToken, entry.qb_entity_type, entry.qb_entity_id, updateFields, isSandbox);

        // Mark as executed
        await supabase
          .from("qb_writeback_queue")
          .update({
            status: "executed",
            executed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.id);

        executed++;
      } catch (err) {
        // Mark as failed
        await supabase
          .from("qb_writeback_queue")
          .update({
            status: "failed",
            error_message: String(err),
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.id);

        failed++;
        console.error(`Writeback failed for ${entry.id}:`, err);
      }
    }

    // Log activity
    await supabase.from("bookkeeping_activity_log").insert({
      action: "qb_writeback",
      entity_type: "qb_writeback_queue",
      actor: "system",
      details: { processed: queue.length, executed, failed },
    });

    return new Response(
      JSON.stringify({ success: true, processed: queue.length, executed, failed }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Writeback error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
