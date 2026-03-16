"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface Receipt {
  id: string;
  email_from: string | null;
  email_subject: string | null;
  email_date: string | null;
  attachment_url: string | null;
  attachment_filename: string | null;
  parsed_vendor: string | null;
  parsed_amount: number | null;
  parsed_date: string | null;
  parsed_category: string | null;
  ai_confidence: number | null;
  user_category: string | null;
  matched_qb_txn_id: string | null;
  match_confidence: number | null;
  match_method: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface QBTransaction {
  id: string;
  txn_date: string;
  amount: number;
  vendor_name: string | null;
  qb_account_name: string | null;
}

type StatusFilter = "all" | "pending" | "parsed" | "matched" | "review" | "error";

export default function ReceiptsTab() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [matchCandidates, setMatchCandidates] = useState<Record<string, QBTransaction[]>>({});
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("receipts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setReceipts(data || []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  async function findMatchCandidates(receipt: Receipt) {
    if (!receipt.parsed_amount) return;

    const receiptId = receipt.id;
    if (matchCandidates[receiptId]) {
      setExpandedReceipt(expandedReceipt === receiptId ? null : receiptId);
      return;
    }

    const amount = Math.abs(receipt.parsed_amount);
    const date = receipt.parsed_date || new Date().toISOString().split("T")[0];

    const { data } = await supabase
      .from("qb_transactions")
      .select("id, txn_date, amount, vendor_name, qb_account_name")
      .is("receipt_id", null)
      .gte("amount", amount - 1)
      .lte("amount", amount + 1)
      .gte("txn_date", shiftDate(date, -10))
      .lte("txn_date", shiftDate(date, 10))
      .order("txn_date", { ascending: false })
      .limit(10);

    setMatchCandidates((prev) => ({ ...prev, [receiptId]: data || [] }));
    setExpandedReceipt(receiptId);
  }

  async function handleManualMatch(receiptId: string, txnId: string) {
    const receipt = receipts.find((r) => r.id === receiptId);
    if (!receipt) return;

    // Update receipt
    await supabase
      .from("receipts")
      .update({
        matched_qb_txn_id: txnId,
        match_confidence: 1.0,
        match_method: "manual",
        status: "matched",
        updated_at: new Date().toISOString(),
      })
      .eq("id", receiptId);

    // Update transaction
    await supabase
      .from("qb_transactions")
      .update({
        receipt_id: receiptId,
        our_category: receipt.parsed_category || receipt.user_category,
        category_source: "human",
        category_confidence: 1.0,
        review_status: "approved",
        reviewed_by: "owner",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", txnId);

    // Log activity
    await supabase.from("bookkeeping_activity_log").insert({
      action: "receipt_matched",
      entity_type: "receipt",
      entity_id: receiptId,
      actor: "owner",
      details: { qb_txn_id: txnId, method: "manual" },
    });

    setExpandedReceipt(null);
    fetchReceipts();
  }

  async function handleArchive(receiptId: string) {
    await supabase
      .from("receipts")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", receiptId);
    fetchReceipts();
  }

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatAmount = (a: number | null) => {
    if (a === null) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(a);
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    parsed: "bg-blue-100 text-blue-700",
    matched: "bg-green-100 text-green-700",
    review: "bg-orange-100 text-orange-700",
    archived: "bg-slate-100 text-slate-500",
    error: "bg-red-100 text-red-700",
  };

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "parsed", label: "Parsed" },
    { key: "matched", label: "Matched" },
    { key: "error", label: "Errors" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Receipt Inbox</h1>
        <p className="text-sm text-slate-500 mt-1">
          Receipts emailed to <span className="font-mono text-slate-700">agent@finleg.net</span> appear here
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3 bg-red-50 border border-red-200 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* How-to banner */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <strong>How it works:</strong> Email a receipt photo or PDF to{" "}
        <span className="font-mono font-medium">agent@finleg.net</span>. AI parses the vendor, amount, and
        date, then matches it to your QuickBooks transactions. Include a category in the subject line
        (e.g. &quot;meals&quot; or &quot;office supplies&quot;) to skip AI categorization.
      </div>

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
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          Loading receipts...
        </div>
      ) : receipts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          <p className="text-lg mb-2">No receipts yet</p>
          <p className="text-sm">
            Email a receipt to <span className="font-mono">agent@finleg.net</span> to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">
                        {receipt.parsed_vendor || receipt.email_subject || "Unknown Receipt"}
                      </span>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                          statusColors[receipt.status] || statusColors.pending
                        }`}
                      >
                        {receipt.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                      <span>{formatDate(receipt.parsed_date || receipt.email_date)}</span>
                      {receipt.email_from && <span>from {receipt.email_from}</span>}
                      {receipt.parsed_category && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
                          {receipt.parsed_category}
                        </span>
                      )}
                    </div>
                    {receipt.error_message && (
                      <p className="mt-1 text-xs text-red-600">{receipt.error_message}</p>
                    )}
                    {receipt.ai_confidence !== null && receipt.ai_confidence > 0 && (
                      <p className="mt-1 text-xs text-slate-400">
                        AI confidence: {Math.round(receipt.ai_confidence * 100)}%
                        {receipt.match_method && ` | Match: ${receipt.match_method}`}
                      </p>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-semibold text-slate-900">
                      {formatAmount(receipt.parsed_amount)}
                    </div>
                    <div className="flex items-center gap-2 mt-1 justify-end">
                      {receipt.attachment_url && (
                        <a
                          href={receipt.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          View
                        </a>
                      )}
                      {!receipt.matched_qb_txn_id && receipt.status !== "error" && (
                        <button
                          onClick={() => findMatchCandidates(receipt)}
                          className="text-xs text-[#228B4A] hover:text-[#1B6B3A] underline"
                        >
                          {expandedReceipt === receipt.id ? "Hide matches" : "Find match"}
                        </button>
                      )}
                      <button
                        onClick={() => handleArchive(receipt.id)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Match candidates */}
              {expandedReceipt === receipt.id && matchCandidates[receipt.id] && (
                <div className="border-t border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-600 mb-2">
                    Possible matches ({matchCandidates[receipt.id].length}):
                  </p>
                  {matchCandidates[receipt.id].length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No matching transactions found. The QB transaction may not have synced yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {matchCandidates[receipt.id].map((txn) => (
                        <div
                          key={txn.id}
                          className="flex items-center justify-between bg-white rounded-lg border border-slate-200 px-3 py-2"
                        >
                          <div>
                            <span className="text-sm font-medium text-slate-900">
                              {txn.vendor_name || "Unknown"}
                            </span>
                            <span className="text-xs text-slate-500 ml-2">
                              {formatDate(txn.txn_date)} &middot; {txn.qb_account_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-slate-900">
                              {formatAmount(txn.amount)}
                            </span>
                            <button
                              onClick={() => handleManualMatch(receipt.id, txn.id)}
                              className="px-2 py-1 text-xs font-medium text-white bg-[#228B4A] hover:bg-[#1B6B3A] rounded transition-colors"
                            >
                              Match
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
