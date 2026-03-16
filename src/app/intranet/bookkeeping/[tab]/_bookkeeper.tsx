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
  memo: string | null;
  our_category: string | null;
  qb_category_name: string | null;
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

export default function BookkeeperTab() {
  const [transactions, setTransactions] = useState<QBTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("qb_transactions")
      .select("*")
      .eq("review_status", "bookkeeper")
      .order("txn_date", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setTransactions(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  async function handleResolve(txnId: string, category: string) {
    const txnNote = note[txnId];

    const { error: updateError } = await supabase
      .from("qb_transactions")
      .update({
        our_category: category,
        category_source: "human",
        category_confidence: 1.0,
        review_status: "approved",
        reviewed_by: "bookkeeper",
        reviewed_at: new Date().toISOString(),
        memo: txnNote || undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", txnId);

    if (updateError) {
      setError(updateError.message);
    } else {
      await supabase.from("bookkeeping_activity_log").insert({
        action: "manual_categorized",
        entity_type: "qb_transaction",
        entity_id: txnId,
        actor: "bookkeeper",
        details: { category, note: txnNote || null },
      });

      setTransactions((prev) => prev.filter((t) => t.id !== txnId));
    }
  }

  async function handleSendBack(txnId: string) {
    await supabase
      .from("qb_transactions")
      .update({ review_status: "needs_review", updated_at: new Date().toISOString() })
      .eq("id", txnId);
    setTransactions((prev) => prev.filter((t) => t.id !== txnId));
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const formatAmount = (a: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(a));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Bookkeeper Queue</h1>
        <p className="text-sm text-slate-500 mt-1">
          Transactions flagged for bookkeeper review — complex categorization, splits, or unknowns
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading queue...
        </div>
      ) : transactions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">Queue is empty</p>
          <p className="text-sm">No transactions need bookkeeper attention right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {transactions.length} item{transactions.length !== 1 ? "s" : ""} awaiting review
          </p>

          {transactions.map((txn) => (
            <div
              key={txn.id}
              className="rounded-xl border border-amber-200 bg-amber-50/30 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900">
                    {txn.vendor_name || "Unknown Vendor"}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                    <span>{formatDate(txn.txn_date)}</span>
                    <span>{txn.qb_account_name}</span>
                    <span className="capitalize">{txn.qb_type}</span>
                  </div>
                  {txn.description && (
                    <p className="mt-1 text-sm text-slate-600">{txn.description}</p>
                  )}
                  {txn.memo && (
                    <p className="mt-1 text-sm text-slate-500 italic">{txn.memo}</p>
                  )}
                  {txn.qb_category_name && (
                    <p className="mt-1 text-xs text-slate-400">
                      QB category: {txn.qb_category_name}
                    </p>
                  )}
                  {txn.our_category && (
                    <p className="mt-1 text-xs text-slate-400">
                      AI suggested: {txn.our_category}
                      {txn.category_confidence
                        ? ` (${Math.round(txn.category_confidence * 100)}%)`
                        : ""}
                    </p>
                  )}
                </div>

                <div className="text-lg font-semibold text-slate-900">
                  {formatAmount(txn.amount)}
                </div>
              </div>

              {/* Bookkeeper actions */}
              <div className="mt-3 pt-3 border-t border-amber-200/50 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    defaultValue={txn.our_category || ""}
                    onChange={(e) => {
                      if (e.target.value) handleResolve(txn.id, e.target.value);
                    }}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 text-slate-900 bg-white"
                  >
                    <option value="">Categorize & resolve...</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleSendBack(txn.id)}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    Send back to owner
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Add a note (optional)..."
                  value={note[txn.id] || ""}
                  onChange={(e) => setNote((prev) => ({ ...prev, [txn.id]: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/30 text-slate-900 bg-white"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
