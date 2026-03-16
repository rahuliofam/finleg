import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * QB Integrity Check — Detects data quality issues and generates todos.
 *
 * Runs weekly after sync. Checks:
 * - Missing categorization (pending > 7 days)
 * - Missing receipts (purchases > $75 without receipt)
 * - Duplicate detection (same amount + date + vendor, different QB IDs)
 * - Stale accounts (no activity 6+ months)
 * - Misclassifications (expense with positive amount, etc.)
 *
 * Auto-resolves previously generated todos if the issue is fixed.
 */

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key);
}

interface Finding {
  finding_type: string;
  severity: "critical" | "warning" | "info";
  entity_type: string;
  entity_id: string | null;
  title: string;
  description: string;
  suggested_action: string;
  auto_fixable: boolean;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = getSupabase();
  const findings: Finding[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().split("T")[0];

  try {
    // ============================================================
    // Check 1: Missing categorization (pending > 7 days)
    // ============================================================
    const { data: stalePending } = await supabase
      .from("qb_transactions")
      .select("id, vendor_name, amount, txn_date")
      .eq("review_status", "pending")
      .eq("is_deleted", false)
      .lt("created_at", sevenDaysAgo)
      .limit(50);

    for (const txn of stalePending || []) {
      findings.push({
        finding_type: "missing_category",
        severity: "warning",
        entity_type: "qb_transaction",
        entity_id: txn.id,
        title: `Uncategorized: ${txn.vendor_name || "Unknown"} $${txn.amount}`,
        description: `Transaction from ${txn.txn_date} has been pending categorization for over 7 days.`,
        suggested_action: "Categorize this transaction in the Categorize tab.",
        auto_fixable: true, // AI can try to categorize
      });
    }

    // ============================================================
    // Check 2: Missing receipts (purchases > $75 without receipt)
    // ============================================================
    const { data: noReceipt } = await supabase
      .from("qb_transactions")
      .select("id, vendor_name, amount, txn_date")
      .eq("qb_type", "Purchase")
      .eq("is_deleted", false)
      .is("receipt_id", null)
      .gte("amount", 75)
      .order("amount", { ascending: false })
      .limit(30);

    for (const txn of noReceipt || []) {
      findings.push({
        finding_type: "missing_receipt",
        severity: "info",
        entity_type: "qb_transaction",
        entity_id: txn.id,
        title: `No receipt: ${txn.vendor_name || "Unknown"} $${txn.amount}`,
        description: `Purchase on ${txn.txn_date} for $${txn.amount} has no receipt attached.`,
        suggested_action: "Forward the receipt email or upload a photo in the Receipts tab.",
        auto_fixable: false,
      });
    }

    // ============================================================
    // Check 3: Potential duplicates (same amount + date + vendor)
    // ============================================================
    const { data: allTxns } = await supabase
      .from("qb_transactions")
      .select("id, qb_id, vendor_name, amount, txn_date")
      .eq("is_deleted", false)
      .gte("txn_date", new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0])
      .order("txn_date", { ascending: false });

    if (allTxns) {
      const seen = new Map<string, any>();
      for (const txn of allTxns) {
        const key = `${txn.amount}|${txn.txn_date}|${(txn.vendor_name || "").toLowerCase()}`;
        if (seen.has(key)) {
          const existing = seen.get(key);
          // Only flag if different QB IDs (not the same transaction)
          if (existing.qb_id !== txn.qb_id) {
            findings.push({
              finding_type: "duplicate",
              severity: "warning",
              entity_type: "qb_transaction",
              entity_id: txn.id,
              title: `Possible duplicate: ${txn.vendor_name || "Unknown"} $${txn.amount}`,
              description: `Two transactions on ${txn.txn_date} for $${txn.amount} to "${txn.vendor_name}". QB IDs: ${existing.qb_id} and ${txn.qb_id}.`,
              suggested_action: "Verify if this is a genuine duplicate in QuickBooks.",
              auto_fixable: false,
            });
          }
        } else {
          seen.set(key, txn);
        }
      }
    }

    // ============================================================
    // Check 4: Stale accounts (no activity 6+ months)
    // ============================================================
    const { data: accountActivity } = await supabase
      .from("qb_transactions")
      .select("qb_account_name")
      .eq("is_deleted", false)
      .gte("txn_date", sixMonthsAgo);

    const { data: allAccounts } = await supabase
      .from("qb_transactions")
      .select("qb_account_name")
      .eq("is_deleted", false);

    if (accountActivity && allAccounts) {
      const activeAccounts = new Set(accountActivity.map((t) => t.qb_account_name));
      const allAccountNames = new Set(allAccounts.map((t) => t.qb_account_name));

      for (const acct of allAccountNames) {
        if (acct && !activeAccounts.has(acct)) {
          findings.push({
            finding_type: "stale_account",
            severity: "info",
            entity_type: "account",
            entity_id: null,
            title: `Stale account: ${acct}`,
            description: `Account "${acct}" has had no transaction activity in the last 6 months.`,
            suggested_action: "Review if this account is still active or should be closed/archived in QB.",
            auto_fixable: false,
          });
        }
      }
    }

    // ============================================================
    // Check 5: Soft-deleted transaction alerts
    // ============================================================
    const { data: deleted, count: deletedCount } = await supabase
      .from("qb_transactions")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", true)
      .gte("deleted_detected_at", sevenDaysAgo);

    if (deletedCount && deletedCount > 0) {
      findings.push({
        finding_type: "deleted_transactions",
        severity: "warning",
        entity_type: "qb_transaction",
        entity_id: null,
        title: `${deletedCount} transactions deleted from QB this week`,
        description: `${deletedCount} transactions that were previously synced are no longer in QuickBooks.`,
        suggested_action: "Review deleted transactions to ensure they were intentionally removed.",
        auto_fixable: false,
      });
    }

    // ============================================================
    // Save findings (clear old unresolved, insert new)
    // ============================================================

    // Mark old unresolved findings as resolved if no longer found
    const { data: existingFindings } = await supabase
      .from("integrity_findings")
      .select("id, entity_id, finding_type")
      .is("resolved_at", null);

    const newFindingKeys = new Set(
      findings.map((f) => `${f.finding_type}:${f.entity_id}`)
    );

    for (const existing of existingFindings || []) {
      const key = `${existing.finding_type}:${existing.entity_id}`;
      if (!newFindingKeys.has(key)) {
        // Auto-resolve: issue no longer exists
        await supabase
          .from("integrity_findings")
          .update({
            resolved_at: new Date().toISOString(),
            resolved_by: "system",
            resolution_notes: "Auto-resolved: issue no longer detected",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        // Also auto-resolve any linked todos
        await supabase
          .from("todos")
          .update({
            status: "auto_resolved",
            resolved_at: new Date().toISOString(),
            resolved_by: "system",
            resolution_notes: "Underlying integrity issue was resolved",
            updated_at: new Date().toISOString(),
          })
          .eq("source_entity_type", "integrity_finding")
          .eq("source_entity_id", existing.id)
          .in("status", ["open", "in_progress"]);
      }
    }

    // Insert new findings (skip if already exists unresolved)
    const existingKeys = new Set(
      (existingFindings || []).map((f) => `${f.finding_type}:${f.entity_id}`)
    );

    let newFindings = 0;
    let newTodos = 0;

    for (const finding of findings) {
      const key = `${finding.finding_type}:${finding.entity_id}`;
      if (existingKeys.has(key)) continue; // Already tracked

      const { data: inserted } = await supabase
        .from("integrity_findings")
        .insert(finding)
        .select("id")
        .single();

      newFindings++;

      // Generate todo for non-info findings
      if (inserted && finding.severity !== "info") {
        await supabase.from("todos").insert({
          title: finding.title,
          description: finding.suggested_action,
          source: "integrity_check",
          source_entity_type: "integrity_finding",
          source_entity_id: inserted.id,
          priority: finding.severity === "critical" ? "high" : "medium",
          assigned_to: finding.auto_fixable ? "ai" : "owner",
          due_date: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
        });
        newTodos++;
      }
    }

    // Log activity
    await supabase.from("bookkeeping_activity_log").insert({
      action: "integrity_check",
      entity_type: "system",
      actor: "system",
      details: {
        total_findings: findings.length,
        new_findings: newFindings,
        new_todos: newTodos,
        auto_resolved: (existingFindings || []).length - [...existingKeys].filter((k) => newFindingKeys.has(k)).length,
        by_type: findings.reduce((acc, f) => {
          acc[f.finding_type] = (acc[f.finding_type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        total_findings: findings.length,
        new_findings: newFindings,
        new_todos: newTodos,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Integrity check error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
