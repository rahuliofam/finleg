"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface QBTransaction {
  id: string;
  qb_id: string;
  qb_type: string;
  qb_account_name: string | null;
  txn_date: string;
  amount: number;
  vendor_name: string | null;
  description: string | null;
  our_category: string | null;
  category_confidence: number | null;
  category_source: string | null;
  review_status: string;
  receipt_id: string | null;
}

const CATEGORIES = [
  "Office Supplies",
  "Software & Subscriptions",
  "Meals & Entertainment",
  "Travel & Transport",
  "Auto & Gas",
  "Utilities & Telecom",
  "Professional Services",
  "Insurance",
  "Medical & Health",
  "Groceries",
  "Shopping",
  "Rent & Lease",
  "Repairs & Maintenance",
  "Advertising & Marketing",
  "Bank Fees & Interest",
  "Taxes & Licenses",
  "Education & Training",
  "Charitable Donations",
  "Transfer",
  "Other",
];

type FilterTab = "pending" | "auto_categorized" | "approved" | "all";

export default function CategorizeTab() {
  const [transactions, setTransactions] = useState<QBTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [saving, setSaving] = useState<string | null>(null);
  const [stats, setStats] = useState({ pending: 0, auto: 0, approved: 0, total: 0 });

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("qb_transactions")
      .select("*")
      .order("txn_date", { ascending: false })
      .limit(100);

    if (filter !== "all") {
      query = query.eq("review_status", filter);
    }

    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setTransactions(data || []);
    }
    setLoading(false);
  }, [filter]);

  const fetchStats = useCallback(async () => {
    const [pending, auto, approved, total] = await Promise.all([
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "auto_categorized"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }).eq("review_status", "approved"),
      supabase.from("qb_transactions").select("id", { count: "exact", head: true }),
    ]);
    setStats({
      pending: pending.count || 0,
      auto: auto.count || 0,
      approved: approved.count || 0,
      total: total.count || 0,
    });
  }, []);

  useEffect(() => {
    fetchTransactions();
    fetchStats();
  }, [fetchTransactions, fetchStats]);

  async function handleCategorize(txnId: string, category: string) {
    setSaving(txnId);
    const { error: updateError } = await supabase
      .from("qb_transactions")
      .update({
        our_category: category,
        category_source: "human",
        category_confidence: 1.0,
        review_status: "approved",
        reviewed_by: "owner",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", txnId);

    if (updateError) {
      setError(updateError.message);
    } else {
      // Learn from this categorization — check if we should create or update a rule
      const txn = transactions.find((t) => t.id === txnId);
      if (txn?.vendor_name) {
        const { data: existingRules } = await supabase
          .from("category_rules")
          .select("id, category, hit_count")
          .ilike("match_pattern", txn.vendor_name)
          .eq("is_active", true)
          .limit(1);

        if (existingRules?.length) {
          // Rule exists — check if human is overriding it
          const rule = existingRules[0];
          if (rule.category !== category) {
            // Human chose a different category than the rule
            // Track override count: deactivate rule if overridden 3+ times
            const { count: overrideCount } = await supabase
              .from("qb_transactions")
              .select("id", { count: "exact", head: true })
              .eq("vendor_name", txn.vendor_name)
              .eq("our_category", category)
              .eq("category_source", "human")
              .neq("our_category", rule.category);

            if ((overrideCount || 0) >= 3) {
              // Deactivate the old rule and create a new one
              await supabase.from("category_rules").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", rule.id);
              await supabase.from("category_rules").insert({
                match_pattern: txn.vendor_name.toLowerCase(),
                match_type: "contains",
                category,
                priority: 5,
                created_by: "owner",
              });
              // Log rule update
              await supabase.from("bookkeeping_activity_log").insert({
                action: "rule_created",
                entity_type: "category_rule",
                actor: "owner",
                details: { vendor: txn.vendor_name, old_category: rule.category, new_category: category, reason: "rule_override_3x" },
              });
            }
          }
        } else {
          // No rule exists — decide threshold for creating one
          const wasAiCategorized = txn.category_source === "ai" && (txn.category_confidence || 0) >= 0.9;
          const threshold = wasAiCategorized ? 1 : 2; // Lower threshold if AI was confident and human confirmed

          const { count } = await supabase
            .from("qb_transactions")
            .select("id", { count: "exact", head: true })
            .eq("vendor_name", txn.vendor_name)
            .eq("our_category", category)
            .eq("review_status", "approved");

          if ((count || 0) >= threshold) {
            await supabase.from("category_rules").insert({
              match_pattern: txn.vendor_name.toLowerCase(),
              match_type: "contains",
              category,
              priority: 5,
              created_by: wasAiCategorized ? "ai" : "owner",
            });
            // Log rule creation
            await supabase.from("bookkeeping_activity_log").insert({
              action: "rule_created",
              entity_type: "category_rule",
              actor: wasAiCategorized ? "ai" : "owner",
              details: { vendor: txn.vendor_name, category, threshold, ai_confirmed: wasAiCategorized },
            });
          }
        }
      }

      setTransactions((prev) => prev.filter((t) => t.id !== txnId));
      fetchStats();
    }
    setSaving(null);
  }

  async function handleBulkApprove() {
    const autoTxns = transactions.filter((t) => t.review_status === "auto_categorized");
    if (!autoTxns.length) return;

    setSaving("bulk");
    const ids = autoTxns.map((t) => t.id);

    const { error: updateError } = await supabase
      .from("qb_transactions")
      .update({
        review_status: "approved",
        reviewed_by: "owner",
        reviewed_at: new Date().toISOString(),
      })
      .in("id", ids);

    if (updateError) {
      setError(updateError.message);
    } else {
      fetchTransactions();
      fetchStats();
    }
    setSaving(null);
  }

  async function handleSendToBookkeeper(txnId: string) {
    const { error: updateError } = await supabase
      .from("qb_transactions")
      .update({ review_status: "bookkeeper", updated_at: new Date().toISOString() })
      .eq("id", txnId);

    if (!updateError) {
      setTransactions((prev) => prev.filter((t) => t.id !== txnId));
      fetchStats();
    }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const formatAmount = (a: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(a));

  const filterTabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "pending", label: "Needs Category", count: stats.pending },
    { key: "auto_categorized", label: "Auto-Categorized", count: stats.auto },
    { key: "approved", label: "Approved", count: stats.approved },
    { key: "all", label: "All", count: stats.total },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quick Categorize</h1>
          <p className="text-sm text-slate-500 mt-1">
            Review and categorize transactions from QuickBooks
          </p>
        </div>
        {filter === "auto_categorized" && transactions.length > 0 && (
          <button
            onClick={handleBulkApprove}
            disabled={saving === "bulk"}
            className="px-4 py-2 text-sm font-medium text-white bg-[#228B4A] hover:bg-[#1B6B3A] rounded-lg transition-colors disabled:opacity-50"
          >
            {saving === "bulk" ? "Approving..." : `Approve All (${transactions.length})`}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              filter === tab.key
                ? "bg-[#228B4A] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-xs opacity-75">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading transactions...
        </div>
      ) : transactions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">
            {filter === "pending" ? "All caught up!" : "No transactions found."}
          </p>
          {filter === "pending" && (
            <p className="text-sm">No transactions need categorization right now.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map((txn) => (
            <div
              key={txn.id}
              className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 truncate">
                      {txn.vendor_name || "Unknown Vendor"}
                    </span>
                    {txn.receipt_id && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">
                        Receipt
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                    <span>{formatDate(txn.txn_date)}</span>
                    <span>{txn.qb_account_name}</span>
                    {txn.description && (
                      <span className="truncate">{txn.description}</span>
                    )}
                  </div>
                  {txn.our_category && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        {txn.our_category}
                      </span>
                      {txn.category_source && (
                        <span className="text-xs text-slate-400">
                          via {txn.category_source}
                          {txn.category_confidence
                            ? ` (${Math.round(txn.category_confidence * 100)}%)`
                            : ""}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <div className={`text-lg font-semibold ${txn.amount >= 0 ? "text-red-600" : "text-green-600"}`}>
                    {txn.amount >= 0 ? "-" : "+"}
                    {formatAmount(txn.amount)}
                  </div>
                  <div className="text-xs text-slate-400 capitalize">{txn.qb_type}</div>
                </div>
              </div>

              {/* Category selector for pending/needs_review */}
              {(txn.review_status === "pending" || txn.review_status === "needs_review") && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleCategorize(txn.id, e.target.value);
                    }}
                    disabled={saving === txn.id}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#228B4A]/30 focus:border-[#228B4A] text-slate-900"
                  >
                    <option value="">Select category...</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleSendToBookkeeper(txn.id)}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    Send to bookkeeper
                  </button>
                </div>
              )}

              {/* Quick approve for auto-categorized */}
              {txn.review_status === "auto_categorized" && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => handleCategorize(txn.id, txn.our_category!)}
                    disabled={saving === txn.id}
                    className="px-3 py-1 text-sm font-medium text-white bg-[#228B4A] hover:bg-[#1B6B3A] rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving === txn.id ? "..." : "Approve"}
                  </button>
                  <select
                    value={txn.our_category || ""}
                    onChange={(e) => {
                      if (e.target.value) handleCategorize(txn.id, e.target.value);
                    }}
                    className="text-sm border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#228B4A]/30 text-slate-900"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleSendToBookkeeper(txn.id)}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    Send to bookkeeper
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
