import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Weekly Digest Email — Sends a summary email to the admin.
 *
 * Triggered by Supabase cron (Sunday 9AM local) or manually.
 *
 * Includes:
 * - Quick stats (synced, auto-categorized, pending)
 * - Top 5 uncategorized transactions with quick-categorize links
 * - Integrity alerts (critical/warning findings)
 * - AI accuracy trend
 * - Open todos count
 *
 * Uses Resend API (already configured).
 */

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

const APP_URL = "https://finleg.net";
const FROM_EMAIL = "bookkeeping@finleg.net";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "rahul@finleg.net";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = getSupabase();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // Gather stats in parallel
    const [
      totalSynced,
      autoCategorized,
      pendingCount,
      approvedCount,
      openTodos,
      criticalFindings,
      pendingTxns,
      lastMetric,
      prevMetric,
      lastSync,
    ] = await Promise.all([
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).gte("synced_at", weekAgo),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "auto_categorized").gte("updated_at", weekAgo),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "approved").gte("reviewed_at", weekAgo),
      supabase.from("todos").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
      supabase.from("integrity_findings").select("title, severity, finding_type").is("resolved_at", null).in("severity", ["critical", "warning"]).limit(10),
      supabase.from("qb_transactions").select("id, vendor_name, amount, txn_date, qb_account_name").eq("review_status", "pending").eq("is_deleted", false).order("amount", { ascending: false }).limit(5),
      supabase.from("ai_metrics").select("accuracy_pct").order("period_end", { ascending: false }).limit(1).single(),
      supabase.from("ai_metrics").select("accuracy_pct").order("period_end", { ascending: false }).limit(1).range(1, 1).single(),
      supabase.from("sync_runs").select("completed_at, status").eq("status", "success").order("completed_at", { ascending: false }).limit(1).single(),
    ]);

    const accuracy = lastMetric.data?.accuracy_pct;
    const prevAccuracy = prevMetric.data?.accuracy_pct;
    const accuracyTrend = accuracy && prevAccuracy
      ? accuracy > prevAccuracy ? "up" : accuracy < prevAccuracy ? "down" : "flat"
      : null;

    // Build email HTML
    const uncategorizedRows = (pendingTxns.data || []).map((txn: any) =>
      `<tr>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${txn.vendor_name || "Unknown"}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">$${Number(txn.amount).toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${txn.txn_date}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">
          <a href="${APP_URL}/intranet/bookkeeping/categorize" style="color: #4f46e5; text-decoration: none;">Categorize →</a>
        </td>
      </tr>`
    ).join("");

    const findingsRows = (criticalFindings.data || []).map((f: any) =>
      `<li style="margin-bottom: 4px;">
        <span style="color: ${f.severity === "critical" ? "#dc2626" : "#d97706"}; font-weight: 600;">
          ${f.severity === "critical" ? "🔴" : "🟡"} ${f.title}
        </span>
      </li>`
    ).join("");

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <div style="background: #4f46e5; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">Finleg Weekly Digest</h1>
        <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">
          Week of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div style="padding: 24px; background: #f8fafc; border: 1px solid #e2e8f0;">
        <!-- Stats Row -->
        <div style="display: flex; gap: 12px; margin-bottom: 24px;">
          <div style="flex: 1; background: white; border-radius: 8px; padding: 12px; text-align: center; border: 1px solid #e2e8f0;">
            <div style="font-size: 24px; font-weight: 700; color: #4f46e5;">${totalSynced.count || 0}</div>
            <div style="font-size: 12px; color: #64748b;">Synced</div>
          </div>
          <div style="flex: 1; background: white; border-radius: 8px; padding: 12px; text-align: center; border: 1px solid #e2e8f0;">
            <div style="font-size: 24px; font-weight: 700; color: #7c3aed;">${autoCategorized.count || 0}</div>
            <div style="font-size: 12px; color: #64748b;">Auto-Categorized</div>
          </div>
          <div style="flex: 1; background: white; border-radius: 8px; padding: 12px; text-align: center; border: 1px solid #e2e8f0;">
            <div style="font-size: 24px; font-weight: 700; color: ${(pendingCount.count || 0) > 0 ? "#d97706" : "#16a34a"};">${pendingCount.count || 0}</div>
            <div style="font-size: 12px; color: #64748b;">Pending</div>
          </div>
          <div style="flex: 1; background: white; border-radius: 8px; padding: 12px; text-align: center; border: 1px solid #e2e8f0;">
            <div style="font-size: 24px; font-weight: 700; color: #16a34a;">${approvedCount.count || 0}</div>
            <div style="font-size: 12px; color: #64748b;">Approved</div>
          </div>
        </div>

        ${accuracy ? `
        <!-- AI Accuracy -->
        <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
          <h3 style="margin: 0 0 4px; font-size: 14px; color: #475569;">AI Accuracy</h3>
          <span style="font-size: 28px; font-weight: 700; color: #4f46e5;">${accuracy}%</span>
          ${accuracyTrend === "up" ? `<span style="color: #16a34a; margin-left: 8px;">↑ improving</span>` :
            accuracyTrend === "down" ? `<span style="color: #dc2626; margin-left: 8px;">↓ declining</span>` : ""}
        </div>
        ` : ""}

        ${uncategorizedRows ? `
        <!-- Top Uncategorized -->
        <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
          <h3 style="margin: 0 0 12px; font-size: 14px; color: #475569;">Top Uncategorized Transactions</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="color: #94a3b8;">
                <th style="text-align: left; padding: 8px;">Vendor</th>
                <th style="text-align: left; padding: 8px;">Amount</th>
                <th style="text-align: left; padding: 8px;">Date</th>
                <th style="padding: 8px;"></th>
              </tr>
            </thead>
            <tbody>${uncategorizedRows}</tbody>
          </table>
          <div style="text-align: center; margin-top: 12px;">
            <a href="${APP_URL}/intranet/bookkeeping/categorize" style="display: inline-block; background: #4f46e5; color: white; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-size: 13px;">
              Categorize All →
            </a>
          </div>
        </div>
        ` : ""}

        ${findingsRows ? `
        <!-- Integrity Alerts -->
        <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
          <h3 style="margin: 0 0 8px; font-size: 14px; color: #475569;">Integrity Alerts</h3>
          <ul style="margin: 0; padding: 0 0 0 16px; font-size: 13px;">${findingsRows}</ul>
        </div>
        ` : ""}

        <!-- Quick Links -->
        <div style="text-align: center; padding: 16px 0;">
          <a href="${APP_URL}/intranet/bookkeeping/dashboard" style="color: #4f46e5; margin: 0 12px; font-size: 13px;">Dashboard</a>
          <a href="${APP_URL}/intranet/bookkeeping/tasks" style="color: #4f46e5; margin: 0 12px; font-size: 13px;">Tasks (${openTodos.count || 0})</a>
          <a href="${APP_URL}/intranet/bookkeeping/activity" style="color: #4f46e5; margin: 0 12px; font-size: 13px;">Activity</a>
        </div>
      </div>

      <div style="padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-radius: 0 0 12px 12px; background: #f1f5f9;">
        Last sync: ${lastSync.data?.completed_at ? new Date(lastSync.data.completed_at).toLocaleString() : "Never"}<br>
        Finleg Financial Manager · Automated weekly digest
      </div>
    </body>
    </html>`;

    // Send via Resend API
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `Finleg Weekly: ${pendingCount.count || 0} pending, ${totalSynced.count || 0} synced`,
        html,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      throw new Error(`Resend API error: ${sendRes.status} ${errText}`);
    }

    const sendResult = await sendRes.json();

    // Log activity
    await supabase.from("bookkeeping_activity_log").insert({
      action: "weekly_digest_sent",
      entity_type: "system",
      actor: "system",
      details: {
        email_id: sendResult.id,
        recipient: ADMIN_EMAIL,
        pending: pendingCount.count || 0,
        synced_this_week: totalSynced.count || 0,
        findings: criticalFindings.data?.length || 0,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        email_id: sendResult.id,
        stats: {
          synced: totalSynced.count,
          auto_categorized: autoCategorized.count,
          pending: pendingCount.count,
          open_todos: openTodos.count,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Weekly digest error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
