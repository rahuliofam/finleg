"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import CenteredBrandLayout from "@/components/centered-brand-layout";

interface SharedDoc {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  category: string;
  account_type: string;
  institution: string;
  account_name: string;
  account_holder: string;
  year: number | null;
  month: number | null;
  period_start: string | null;
  period_end: string | null;
  bucket: string;
  r2_key: string;
}

interface ShareRecord {
  id: string;
  document_id: string;
  share_token: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  note: string | null;
  is_revoked: boolean;
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const INSTITUTION_LABELS: Record<string, string> = {
  amex: "American Express",
  chase: "Chase",
  "charles-schwab": "Charles Schwab",
  "us-bank": "US Bank",
  robinhood: "Robinhood",
  apple: "Apple",
  "bank-of-america": "Bank of America",
  pnc: "PNC",
  coinbase: "Coinbase",
  venmo: "Venmo",
  paypal: "PayPal",
  "cash-app": "Cash App",
  sba: "SBA",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  "credit-card": "Credit Card",
  checking: "Checking",
  payment: "Payment",
  brokerage: "Brokerage",
  ira: "IRA",
  trust: "Trust",
  crypto: "Crypto",
  mortgage: "Mortgage",
  heloc: "HELOC",
  "credit-line": "Credit Line",
  "auto-loan": "Auto Loan",
  "sba-loan": "SBA Loan",
};

function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function SharedContent() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [share, setShare] = useState<ShareRecord | null>(null);
  const [doc, setDoc] = useState<SharedDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sharedByName, setSharedByName] = useState("");

  // Mark recipient as viewed
  useEffect(() => {
    if (!user || !share) return;
    (async () => {
      const { data: appUser } = await supabase
        .from("app_users")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();
      if (!appUser) return;

      await supabase
        .from("document_share_recipients")
        .update({ viewed_at: new Date().toISOString() })
        .eq("share_id", share.id)
        .eq("recipient_user_id", appUser.id)
        .is("viewed_at", null);
    })();
  }, [user, share]);

  // Fetch share + document once authenticated
  useEffect(() => {
    if (authLoading || !user || !token) return;

    (async () => {
      setLoading(true);
      setError("");

      // Look up the share by token
      const { data: shareData, error: shareErr } = await supabase
        .from("document_shares")
        .select("*")
        .eq("share_token", token)
        .single();

      if (shareErr || !shareData) {
        setError("This share link is invalid or has been removed.");
        setLoading(false);
        return;
      }

      const s = shareData as ShareRecord;

      if (s.is_revoked) {
        setError("This share link has been revoked.");
        setLoading(false);
        return;
      }

      if (s.expires_at && new Date(s.expires_at) < new Date()) {
        setError("This share link has expired.");
        setLoading(false);
        return;
      }

      setShare(s);

      // Fetch the document
      const { data: docData, error: docErr } = await supabase
        .from("document_index")
        .select("id, filename, file_type, file_size, category, account_type, institution, account_name, account_holder, year, month, period_start, period_end, bucket, r2_key")
        .eq("id", s.document_id)
        .single();

      if (docErr || !docData) {
        setError("The shared document could not be found.");
        setLoading(false);
        return;
      }

      setDoc(docData as SharedDoc);

      // Get who shared it
      const { data: sharer } = await supabase
        .from("app_users")
        .select("display_name, first_name")
        .eq("id", s.created_by)
        .single();

      if (sharer) {
        setSharedByName(sharer.display_name || sharer.first_name || "Someone");
      }

      setLoading(false);
    })();
  }, [authLoading, user, token]);

  // No token provided
  if (!token) {
    return (
      <CenteredBrandLayout>
        <p className="text-lg text-slate-500">No share link provided.</p>
      </CenteredBrandLayout>
    );
  }

  // Not authenticated - show restricted message
  if (!authLoading && !user) {
    return (
      <CenteredBrandLayout>
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <div className="text-5xl mb-4">&#128274;</div>
          <h2 className="text-xl font-semibold text-slate-900 mb-3">
            Sign in required
          </h2>
          <p className="text-slate-500 mb-6 text-sm leading-relaxed">
            This document has not been shared publicly. Please sign in with your
            authorized account to view it.
          </p>
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white border border-slate-300 hover:border-slate-400 rounded-full font-medium text-slate-700 hover:shadow-md transition-all cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      </CenteredBrandLayout>
    );
  }

  // Auth loading
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  // Data loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <CenteredBrandLayout>
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <div className="text-5xl mb-4">&#9888;&#65039;</div>
          <p className="text-slate-600">{error}</p>
        </div>
      </CenteredBrandLayout>
    );
  }

  // Document view
  if (!doc || !share) return null;

  const fileUrl = `https://r2-files.finleg.workers.dev/${doc.bucket}/${doc.r2_key}`;
  const periodLabel = doc.period_start && doc.period_end
    ? `${new Date(doc.period_start + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — ${new Date(doc.period_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : doc.month
      ? `${MONTH_NAMES[doc.month]} ${doc.year}`
      : doc.year
        ? String(doc.year)
        : null;

  return (
    <div className="max-w-lg mx-auto px-6 pt-12 pb-20">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="text-3xl">
              {doc.file_type === "pdf" ? "\uD83D\uDCC4" : "\uD83D\uDCC3"}
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {doc.month
                  ? `${MONTH_NAMES[doc.month]} ${doc.year} Statement`
                  : "Shared Document"}
              </h1>
              <p className="text-sm text-slate-500">
                {INSTITUTION_LABELS[doc.institution] || doc.institution} &middot; {doc.account_name}
              </p>
            </div>
          </div>
          {sharedByName && (
            <p className="mt-3 text-xs text-slate-400">
              Shared by {sharedByName}
              {share.note && <span className="text-slate-500"> &mdash; &ldquo;{share.note}&rdquo;</span>}
            </p>
          )}
        </div>

        {/* Details */}
        <div className="px-6 py-4">
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">Institution</td>
                <td className="text-slate-700">{INSTITUTION_LABELS[doc.institution] || doc.institution}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">Account</td>
                <td className="text-slate-700">{doc.account_name}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">Type</td>
                <td className="text-slate-700">{ACCOUNT_TYPE_LABELS[doc.account_type] || doc.account_type}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">Holder</td>
                <td className="text-slate-700">{doc.account_holder}</td>
              </tr>
              {periodLabel && (
                <tr>
                  <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">Period</td>
                  <td className="text-slate-700">{periodLabel}</td>
                </tr>
              )}
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">File</td>
                <td className="text-slate-700 break-all text-xs">{doc.filename}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap">Size</td>
                <td className="text-slate-700">{formatSize(doc.file_size)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Action */}
        <div className="px-6 pb-6">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-3 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            View Document
          </a>
        </div>
      </div>
    </div>
  );
}

export default function SharedPage() {
  return (
    <Suspense>
      <SharedContent />
    </Suspense>
  );
}
