"use client";

import type { Statement } from "./types";
import {
  MONTH_NAMES,
  accountTypeLabel,
  fileUrl,
  formatSize,
  institutionLabel,
} from "./constants";

interface Props {
  statement: Statement;
  displayNames: Record<string, string>;
  hasParsed: boolean;
  shareUrl: string | null;
  shareCopied: boolean;
  onClose: () => void;
  onCopyShareUrl: () => void;
  onLoadParsed: (s: Statement) => void;
  onOpenShare: (s: Statement) => void;
}

export default function StatementDetailModal({
  statement,
  displayNames,
  hasParsed,
  shareUrl,
  shareCopied,
  onClose,
  onCopyShareUrl,
  onLoadParsed,
  onOpenShare,
}: Props) {
  const s = statement;
  const displayName =
    displayNames[`${s.institution}|${s.account_name}|${s.account_number || ""}`] ||
    s.account_name;

  return (
    <div
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[51]"
      >
        &times;
      </button>

      <div className="bg-white rounded-xl p-8 max-w-[500px] w-[90vw] text-left">
        <div className="flex items-center gap-3 mb-5">
          <span className="text-4xl">
            {s.file_type === "pdf" ? "\ud83d\udcc4" : "\ud83d\udcc3"}
          </span>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {s.month ? `${MONTH_NAMES[s.month]} ${s.year} Statement` : "Statement"}
            </h3>
            <p className="text-sm text-slate-500">{displayName}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Account</td>
              <td className="text-slate-700">
                {s.account_name}
                {s.account_number ? ` (${s.account_number})` : ""}
              </td>
            </tr>
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Institution</td>
              <td className="text-slate-700 capitalize">{institutionLabel(s.institution)}</td>
            </tr>
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Type</td>
              <td className="text-slate-700">{accountTypeLabel(s.account_type)}</td>
            </tr>
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Holder</td>
              <td className="text-slate-700">{s.account_holder}</td>
            </tr>
            {(s.period_start || s.statement_date) && (
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Starting</td>
                <td className="text-slate-700">{s.period_start || s.statement_date}</td>
              </tr>
            )}
            {s.period_end && (
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Ending</td>
                <td className="text-slate-700">{s.period_end}</td>
              </tr>
            )}
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">File</td>
              <td className="text-slate-700 break-all text-xs">{s.filename}</td>
            </tr>
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Size</td>
              <td className="text-slate-700">{formatSize(s.file_size)}</td>
            </tr>
            <tr>
              <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Format</td>
              <td className="text-slate-700 uppercase">{s.file_type}</td>
            </tr>
            {s.is_closed && (
              <tr>
                <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top">Status</td>
                <td className="text-amber-600 font-medium">Closed Account</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Action buttons */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex gap-3">
          <a
            href={fileUrl(s.bucket, s.r2_key)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            View Original PDF
          </a>
          {hasParsed && (
            <button
              onClick={() => onLoadParsed(s)}
              className="flex-1 text-center py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              View Parsed Data
            </button>
          )}
          <button
            onClick={() => {
              onClose();
              onOpenShare(s);
            }}
            className="flex-1 text-center py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
          >
            Send To...
          </button>
        </div>

        {/* Inline share link */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
            Share Link
          </label>
          {shareUrl ? (
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-500 outline-none font-mono"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={onCopyShareUrl}
                className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                  shareCopied
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                }`}
              >
                {shareCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-400 italic">Generating link...</div>
          )}
        </div>

        <div className="mt-3 text-xs text-slate-400">
          <span className="font-medium">R2 Key:</span>{" "}
          <span className="break-all">{s.r2_key}</span>
        </div>
      </div>
    </div>
  );
}
