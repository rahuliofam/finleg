import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Quick Action — Handles signed URL actions from email digest.
 *
 * Supports:
 * - Categorize a transaction (from email link)
 * - Approve an AI categorization
 * - Dismiss a finding
 *
 * URLs are signed with HMAC to prevent tampering.
 */

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const entityId = url.searchParams.get("id");
  const value = url.searchParams.get("value");
  const sig = url.searchParams.get("sig");

  if (!action || !entityId) {
    return new Response("Missing parameters", { status: 400 });
  }

  // Verify signature
  const secret = Deno.env.get("QUICK_ACTION_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const payload = `${action}:${entityId}:${value || ""}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const expectedSig = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (sig !== expectedSig) {
    return new Response("Invalid signature", { status: 403 });
  }

  const supabase = getSupabase();

  try {
    switch (action) {
      case "categorize": {
        if (!value) return new Response("Missing category", { status: 400 });
        await supabase
          .from("qb_transactions")
          .update({
            our_category: value,
            category_source: "human",
            category_confidence: 1.0,
            review_status: "approved",
            reviewed_by: "owner",
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", entityId);

        await supabase.from("bookkeeping_activity_log").insert({
          action: "manual_categorized",
          entity_type: "qb_transaction",
          entity_id: entityId,
          actor: "owner",
          details: { category: value, source: "email_quick_action" },
        });
        break;
      }

      case "approve": {
        await supabase
          .from("qb_transactions")
          .update({
            review_status: "approved",
            reviewed_by: "owner",
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", entityId);
        break;
      }

      case "dismiss_finding": {
        await supabase
          .from("integrity_findings")
          .update({
            resolved_at: new Date().toISOString(),
            resolved_by: "owner",
            resolution_notes: "Dismissed via email quick action",
            updated_at: new Date().toISOString(),
          })
          .eq("id", entityId);
        break;
      }

      default:
        return new Response("Unknown action", { status: 400 });
    }

    // Return a simple success page
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta http-equiv="refresh" content="2;url=https://finleg.net/intranet/bookkeeping/categorize">
      <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc}
      .card{background:white;border-radius:12px;padding:32px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}
      .check{font-size:48px;margin-bottom:12px}</style></head>
      <body><div class="card"><div class="check">✓</div><h2>Done!</h2><p>Redirecting to Finleg...</p></div></body></html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    console.error("Quick action error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
