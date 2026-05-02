"use client";

import type { AppUser, ShareModalState } from "./types";
import { MONTH_NAMES } from "./constants";

interface Props {
  share: ShareModalState;
  appUsers: AppUser[];
  currentAppUserId: string | null;
  onClose: () => void;
  onCopy: () => void;
  onToggleSendMode: () => void;
  onSendToUser: (userId: string) => void;
}

export default function ShareStatementModal({
  share,
  appUsers,
  currentAppUserId,
  onClose,
  onCopy,
  onToggleSendMode,
  onSendToUser,
}: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-6 text-3xl text-white bg-transparent border-none cursor-pointer z-[71]"
      >
        &times;
      </button>

      <div className="bg-white rounded-xl p-6 max-w-[480px] w-[90vw] max-h-[80vh] overflow-y-auto text-left">
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Share Statement</h3>
        <p className="text-sm text-slate-500 mb-5">
          {share.statement.account_name}
          {share.statement.month
            ? ` — ${MONTH_NAMES[share.statement.month]} ${share.statement.year}`
            : ""}
        </p>

        {share.creating ? (
          <div className="text-center py-8 text-slate-400">
            <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
            <p className="mt-2 text-sm">Generating share link...</p>
          </div>
        ) : share.shareUrl ? (
          <>
            {/* Copy link section */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Share Link
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={share.shareUrl}
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-slate-50 text-slate-600 outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={onCopy}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    share.copied
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
                  }`}
                >
                  {share.copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Only authenticated users can view this link.
              </p>
            </div>

            {/* Send to users section */}
            <div>
              <button
                onClick={onToggleSendMode}
                className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-emerald-700 transition-colors mb-3"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                Send to a user
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${share.sendMode ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {share.sendMode && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  {appUsers.length === 0 ? (
                    <div className="p-4 text-sm text-slate-400 text-center">No users found</div>
                  ) : (
                    <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-100">
                      {appUsers
                        .filter((u) => u.id !== currentAppUserId)
                        .map((u) => {
                          const name =
                            u.display_name ||
                            `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
                            u.email;
                          const isSent = share.sentTo.has(u.id);
                          return (
                            <div
                              key={u.id}
                              className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50"
                            >
                              <div>
                                <span className="text-sm font-medium text-slate-800">{name}</span>
                                <span className="text-xs text-slate-400 ml-2">{u.role}</span>
                              </div>
                              {isSent ? (
                                <span className="text-xs text-emerald-600 font-medium">Sent</span>
                              ) : (
                                <button
                                  onClick={() => onSendToUser(u.id)}
                                  disabled={share.sending}
                                  className="text-xs text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
                                >
                                  Send
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-6 text-slate-400">
            <p className="text-sm">
              Unable to create share link. Make sure you have an active account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
