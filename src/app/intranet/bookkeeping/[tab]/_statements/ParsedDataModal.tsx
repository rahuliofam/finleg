"use client";

import type { ParsedSummary } from "./types";

interface Props {
  parsed: ParsedSummary;
  loading: boolean;
  onClose: () => void;
}

const HIDDEN_KEYS = ["id", "created_at", "document_id", "r2_key", "source_file_name"];

export default function ParsedDataModal({ parsed, loading, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[61]"
      >
        &times;
      </button>

      <div className="bg-white rounded-xl p-8 max-w-[600px] w-[90vw] max-h-[80vh] overflow-y-auto text-left">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Parsed Statement Data</h3>
        {loading ? (
          <div className="text-center py-8 text-slate-400">
            <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(parsed.data)
                .filter(([k]) => !HIDDEN_KEYS.includes(k))
                .map(([key, value]) => (
                  <tr key={key} className="border-t border-slate-100">
                    <td className="text-slate-400 py-1.5 pr-4 whitespace-nowrap align-top capitalize">
                      {key.replace(/_/g, " ")}
                    </td>
                    <td className="text-slate-700 py-1.5">
                      {value === null || value === undefined
                        ? "\u2014"
                        : typeof value === "number"
                          ? value.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : String(value)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
