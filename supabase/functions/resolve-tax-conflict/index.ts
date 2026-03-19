import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Resolve Tax Conflict — Handles signed URL clicks from conflict emails.
 *
 * When the user clicks "Use Gemini" or "Use Claude" for a conflict field,
 * this records the choice, updates the tax_returns table, and when all
 * conflicts for that return are resolved, sends a summary email.
 */

const FROM_EMAIL = "agent@finleg.net";
const NOTIFY_TO = "rahchak@gmail.com";

function getSupabase() {
  const url =
    Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

async function hmacSign(payload: string, secret: string): Promise<string> {
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
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function austinNow(): string {
  return (
    new Date().toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " CT"
  );
}

function fmtVal(v: string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!isNaN(n)) {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  }
  return v;
}

// Map dotted field paths to the column name in tax_returns (for summary fields)
const SUMMARY_FIELD_TO_COLUMN: Record<string, string> = {
  "summary.total_income": "total_income",
  "summary.adjusted_gross_income": "adjusted_gross_income",
  "summary.taxable_income": "taxable_income",
  "summary.total_tax": "total_tax",
  "summary.total_payments": "total_payments",
  "summary.amount_owed": "amount_owed",
  "summary.refund_amount": "refund_amount",
};

serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const field = url.searchParams.get("field");
  const source = url.searchParams.get("source"); // gemini | claude
  const sig = url.searchParams.get("sig");

  if (!token || !field || !source || !sig) {
    return new Response("Missing parameters", { status: 400 });
  }

  // Verify HMAC signature
  const secret =
    Deno.env.get("QUICK_ACTION_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";
  const payload = `resolve:${token}:${field}:${source}`;
  const expectedSig = await hmacSign(payload, secret);

  if (sig !== expectedSig) {
    return new Response("Invalid signature", { status: 403 });
  }

  const supabase = getSupabase();

  try {
    // Get the conflict row
    const { data: conflict, error: fetchErr } = await supabase
      .from("tax_conflict_resolutions")
      .select("*")
      .eq("token", token)
      .eq("field", field)
      .single();

    if (fetchErr || !conflict) {
      return new Response("Conflict not found", { status: 404 });
    }

    // Determine chosen value
    const chosenValue =
      source === "gemini" ? conflict.gemini_value : conflict.claude_value;

    // Record the resolution
    await supabase
      .from("tax_conflict_resolutions")
      .update({
        chosen_source: source,
        chosen_value: chosenValue,
        resolved_at: new Date().toISOString(),
      })
      .eq("token", token)
      .eq("field", field);

    // Update the tax_returns table if this is a summary field
    const column = SUMMARY_FIELD_TO_COLUMN[field];
    if (column) {
      const numVal = Number(chosenValue);
      if (!isNaN(numVal)) {
        await supabase
          .from("tax_returns")
          .update({ [column]: numVal })
          .eq("id", conflict.return_id);
      }
    }

    // Check if all conflicts for this token are now resolved
    const { data: allConflicts } = await supabase
      .from("tax_conflict_resolutions")
      .select("field, chosen_source, chosen_value, gemini_value, claude_value")
      .eq("token", token);

    const pending = allConflicts?.filter((c) => !c.chosen_source) || [];
    const resolved = allConflicts?.filter((c) => c.chosen_source) || [];
    const allDone = pending.length === 0;

    // If all resolved, send summary email
    if (allDone && resolved.length > 0) {
      await sendSummaryEmail(supabase, conflict.return_id, token, resolved);
    }

    // Build response HTML
    const fieldLabel = field.replace(/\./g, " > ");
    const html = buildResponseHtml(
      fieldLabel,
      source,
      chosenValue,
      resolved.length,
      (allConflicts || []).length,
      allDone,
      conflict.return_id
    );

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    console.error("Resolve conflict error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

function buildResponseHtml(
  fieldLabel: string,
  source: string,
  chosenValue: string | null,
  resolvedCount: number,
  totalCount: number,
  allDone: boolean,
  _returnId: string
): string {
  const progressPct = Math.round((resolvedCount / totalCount) * 100);
  const statusMsg = allDone
    ? `All ${totalCount} conflict(s) resolved! Summary email sent.`
    : `${resolvedCount} of ${totalCount} resolved. Check your email for remaining conflicts.`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
  .card { background: white; border-radius: 16px; padding: 40px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.1); max-width: 440px; width: 90%; }
  .check { font-size: 48px; margin-bottom: 12px; }
  h2 { margin: 0 0 8px; color: #1a1a1a; }
  .field { font-family: monospace; font-size: 13px; color: #666; background: #f1f5f9; padding: 4px 10px; border-radius: 6px; display: inline-block; margin: 8px 0; }
  .choice { color: ${source === "gemini" ? "#2563eb" : "#7c3aed"}; font-weight: 600; }
  .value { font-size: 18px; font-weight: 600; margin: 8px 0 16px; }
  .progress { background: #e2e8f0; border-radius: 99px; height: 8px; margin: 16px 0 8px; overflow: hidden; }
  .bar { background: ${allDone ? "#16a34a" : "#2563eb"}; height: 100%; border-radius: 99px; width: ${progressPct}%; transition: width 0.3s; }
  .status { color: #666; font-size: 14px; }
  .done { color: #16a34a; font-weight: 600; }
</style></head>
<body><div class="card">
  <div class="check">${allDone ? "🎉" : "✓"}</div>
  <h2>Conflict Resolved</h2>
  <div class="field">${fieldLabel}</div>
  <div>Set to <span class="choice">${source === "gemini" ? "Gemini" : "Claude"}</span> value:</div>
  <div class="value">${fmtVal(chosenValue)}</div>
  <div class="progress"><div class="bar"></div></div>
  <div class="${allDone ? "done" : "status"}">${statusMsg}</div>
</div></body></html>`;
}

async function sendSummaryEmail(
  supabase: ReturnType<typeof createClient>,
  returnId: string,
  token: string,
  resolved: Array<{
    field: string;
    chosen_source: string;
    chosen_value: string;
    gemini_value: string;
    claude_value: string;
  }>
) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;

  // Get return info
  const { data: taxReturn } = await supabase
    .from("tax_returns")
    .select("*, tax_entities(display_name)")
    .eq("id", returnId)
    .single();

  const entityName =
    taxReturn?.tax_entities?.display_name || "Unknown Entity";
  const taxYear = taxReturn?.tax_year || "?";
  const returnType = taxReturn?.return_type || "?";

  // Build change-link base URL for the summary email
  const supabaseUrl =
    Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const fnUrl = `${supabaseUrl}/functions/v1/resolve-tax-conflict`;
  const secret =
    Deno.env.get("QUICK_ACTION_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";

  let html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:700px;margin:0 auto;color:#1a1a1a;">`;
  html += `<h2 style="margin-bottom:4px;color:#16a34a;">✅ All Conflicts Resolved</h2>`;
  html += `<p style="color:#666;margin-top:0;">${entityName} — ${taxYear} Form ${returnType}</p>`;

  html += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;">`;
  html += `<div style="font-weight:600;margin-bottom:8px;">Resolution Summary</div>`;
  html += `<p style="font-size:13px;color:#666;margin-top:0;">All ${resolved.length} conflict(s) have been resolved. The database has been updated with your selections.</p>`;
  html += `</div>`;

  // Results table
  html += `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">`;
  html += `<tr style="background:#f0fdf4;text-align:left;">`;
  html += `<th style="padding:6px 8px;">Field</th>`;
  html += `<th style="padding:6px 8px;text-align:right;">Selected Value</th>`;
  html += `<th style="padding:6px 8px;text-align:center;">Source</th>`;
  html += `<th style="padding:6px 8px;text-align:center;">Change</th>`;
  html += `</tr>`;

  for (const r of resolved) {
    const sourceLabel = r.chosen_source === "gemini" ? "Gemini" : "Claude";
    const sourceColor =
      r.chosen_source === "gemini" ? "#2563eb" : "#7c3aed";
    const altSource = r.chosen_source === "gemini" ? "claude" : "gemini";

    // Build signed "change" link to swap to the other source
    const changePayload = `resolve:${token}:${r.field}:${altSource}`;
    const changeSig = await hmacSign(changePayload, secret);
    const changeUrl = `${fnUrl}?token=${encodeURIComponent(token)}&field=${encodeURIComponent(r.field)}&source=${altSource}&sig=${changeSig}`;

    html += `<tr style="border-bottom:1px solid #eee;">`;
    html += `<td style="padding:6px 8px;font-family:monospace;font-size:12px;">${r.field}</td>`;
    html += `<td style="padding:6px 8px;text-align:right;font-weight:600;">${fmtVal(r.chosen_value)}</td>`;
    html += `<td style="padding:6px 8px;text-align:center;"><span style="color:${sourceColor};font-weight:600;">${sourceLabel}</span></td>`;
    html += `<td style="padding:6px 8px;text-align:center;"><a href="${changeUrl}" style="color:#dc2626;font-size:12px;text-decoration:underline;">Switch to ${altSource === "gemini" ? "Gemini" : "Claude"}</a></td>`;
    html += `</tr>`;
  }
  html += `</table>`;

  html += `<p style="font-size:12px;color:#999;">Resolved at ${austinNow()}. Click "Switch" on any row to change your selection — you'll receive an updated summary.</p>`;
  html += `</div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [NOTIFY_TO],
        subject: `Resolved: ${entityName} ${taxYear} Form ${returnType} — ${resolved.length} conflict(s) fixed`,
        html,
      }),
    });
  } catch (err) {
    console.error("Summary email error:", err);
  }

  // Update tax_returns verification status
  await supabase
    .from("tax_returns")
    .update({ verification_status: "resolved" })
    .eq("id", returnId);
}
