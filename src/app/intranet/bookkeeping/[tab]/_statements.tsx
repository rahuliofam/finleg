"use client";

import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import InstitutionGroupCard from "./_statements/InstitutionGroupCard";
import ParsedDataModal from "./_statements/ParsedDataModal";
import ShareStatementModal from "./_statements/ShareStatementModal";
import StatementDetailModal from "./_statements/StatementDetailModal";
import {
  ACCOUNT_TYPES,
  HOLDERS,
  INSTITUTIONS,
  SUMMARY_TABLE_NAMES,
  SUMMARY_TABLES,
  YEARS,
  selectClass,
} from "./_statements/constants";
import { buildInstitutionGroups, isActiveGroup } from "./_statements/helpers";
import {
  initialStatementsUIState,
  statementsReducer,
} from "./_statements/state";
import type {
  AccountGroup,
  AccountSortField,
  AppUser,
  Statement,
} from "./_statements/types";

export default function StatementsTab() {
  const authCtx = useAuth();
  const [state, dispatch] = useReducer(statementsReducer, initialStatementsUIState);

  // Still using independent pieces of auth/app-user state — these are
  // independent cross-cutting concerns, not UI state.
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [currentAppUserId, setCurrentAppUserId] = useState<string | null>(null);

  const {
    statements,
    loading,
    error,
    institution,
    accountType,
    holderFilter,
    yearFilter,
    expandedInstitutions,
    expandedAccounts,
    detailStatement,
    displayNames,
    editingKey,
    editValue,
    acctSortField,
    acctSortDir,
    parsedDocIds,
    parsedDetail,
    parsedLoading,
    shareModal,
    detailShareUrl,
    detailShareCopied,
  } = state;

  const getDisplayName = useCallback(
    (acct: AccountGroup): string => displayNames[acct.key] || acct.accountName,
    [displayNames],
  );

  // ============ Data fetching ============

  const fetchStatements = useCallback(async () => {
    dispatch({ type: "fetch/start" });
    try {
      let q = supabase
        .from("document_index")
        .select("*")
        .eq("category", "statement")
        .order("year", { ascending: false })
        .order("month", { ascending: false, nullsFirst: false });

      if (institution) q = q.eq("institution", institution);
      if (accountType) q = q.eq("account_type", accountType);
      if (holderFilter) q = q.eq("account_holder", holderFilter);
      if (yearFilter) q = q.eq("year", parseInt(yearFilter));

      const { data, error: err } = await q;
      if (err) throw err;
      dispatch({ type: "fetch/success", statements: (data as Statement[]) || [] });
    } catch (e: unknown) {
      dispatch({
        type: "fetch/error",
        message: e instanceof Error ? e.message : "Failed to load statements",
      });
    }
  }, [institution, accountType, holderFilter, yearFilter]);

  useEffect(() => {
    fetchStatements();
  }, [fetchStatements]);

  // Fetch display name overrides
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("account_display_names")
        .select("institution, account_number, account_name, display_name");
      if (data) {
        const map: Record<string, string> = {};
        for (const row of data) {
          const key = `${row.institution}|${row.account_name}|${row.account_number || ""}`;
          map[key] = row.display_name;
        }
        dispatch({ type: "displayNames/set", map });
      }
    })();
  }, []);

  // Fetch parsed document IDs from all summary tables
  useEffect(() => {
    (async () => {
      const ids = new Set<string>();
      await Promise.all(
        SUMMARY_TABLE_NAMES.map(async (t) => {
          const { data } = await supabase.from(t).select("document_id");
          if (data) {
            data.forEach((r: { document_id: string }) => {
              if (r.document_id) ids.add(r.document_id);
            });
          }
        }),
      );
      dispatch({ type: "parsed/setIds", ids });
    })();
  }, []);

  const loadParsedDetail = async (s: Statement) => {
    const table = SUMMARY_TABLES[s.account_type];
    if (!table) return;
    dispatch({ type: "parsed/loadStart" });
    const { data } = await supabase.from(table).select("*").eq("document_id", s.id).single();
    if (data) {
      dispatch({ type: "parsed/loadSuccess", detail: { table, data } });
    } else {
      dispatch({ type: "parsed/loadFail" });
    }
  };

  // Fetch current user's app_users id
  const user = authCtx.user;
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("app_users")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();
      if (data) setCurrentAppUserId(data.id);
    })();
  }, [user]);

  // Fetch app users for send-to feature
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_users")
        .select("id, display_name, first_name, last_name, email, role")
        .not("role", "in", "(pending,prospect)")
        .eq("is_archived", false)
        .order("first_name");
      if (data) setAppUsers(data as AppUser[]);
    })();
  }, []);

  // ============ Share flow ============

  const openShareModal = async (s: Statement) => {
    dispatch({ type: "share/open", statement: s });

    if (!currentAppUserId) {
      dispatch({ type: "share/patch", patch: { creating: false } });
      return;
    }

    // Check for existing active share
    const { data: existing } = await supabase
      .from("document_shares")
      .select("id, share_token")
      .eq("document_id", s.id)
      .eq("created_by", currentAppUserId)
      .eq("is_revoked", false)
      .limit(1)
      .single();

    if (existing) {
      const url = `${window.location.origin}/shared?token=${existing.share_token}`;
      dispatch({
        type: "share/patch",
        patch: { shareUrl: url, shareId: existing.id, creating: false },
      });

      // Load already-sent recipients
      const { data: recipients } = await supabase
        .from("document_share_recipients")
        .select("recipient_user_id")
        .eq("share_id", existing.id);
      if (recipients) {
        const sent = new Set(
          recipients.map((r: { recipient_user_id: string }) => r.recipient_user_id),
        );
        dispatch({ type: "share/setRecipients", ids: sent });
      }
      return;
    }

    // Create new share
    const { data: newShare, error: createErr } = await supabase
      .from("document_shares")
      .insert({ document_id: s.id, created_by: currentAppUserId })
      .select("id, share_token")
      .single();

    if (createErr || !newShare) {
      dispatch({ type: "share/patch", patch: { creating: false } });
      return;
    }

    const url = `${window.location.origin}/shared?token=${newShare.share_token}`;
    dispatch({
      type: "share/patch",
      patch: { shareUrl: url, shareId: newShare.id, creating: false },
    });
  };

  const copyShareLink = async () => {
    if (!shareModal?.shareUrl) return;
    await navigator.clipboard.writeText(shareModal.shareUrl);
    dispatch({ type: "share/patch", patch: { copied: true } });
    setTimeout(() => dispatch({ type: "share/patch", patch: { copied: false } }), 2000);
  };

  const sendToUser = async (userId: string) => {
    if (!shareModal?.shareId) return;
    dispatch({ type: "share/patch", patch: { sending: true } });

    await supabase
      .from("document_share_recipients")
      .upsert(
        { share_id: shareModal.shareId, recipient_user_id: userId },
        { onConflict: "share_id,recipient_user_id" },
      );

    dispatch({ type: "share/addRecipient", userId });
  };

  const getDetailShareUrl = async (s: Statement) => {
    dispatch({ type: "detail/setShareUrl", url: null });
    dispatch({ type: "detail/setShareCopied", copied: false });
    if (!currentAppUserId) return;

    // Check for existing active share
    const { data: existing } = await supabase
      .from("document_shares")
      .select("share_token")
      .eq("document_id", s.id)
      .eq("created_by", currentAppUserId)
      .eq("is_revoked", false)
      .limit(1)
      .single();

    if (existing) {
      dispatch({
        type: "detail/setShareUrl",
        url: `${window.location.origin}/shared?token=${existing.share_token}`,
      });
      return;
    }

    // Create new share
    const { data: newShare } = await supabase
      .from("document_shares")
      .insert({ document_id: s.id, created_by: currentAppUserId })
      .select("share_token")
      .single();

    if (newShare) {
      dispatch({
        type: "detail/setShareUrl",
        url: `${window.location.origin}/shared?token=${newShare.share_token}`,
      });
    }
  };

  const copyDetailShareUrl = async () => {
    if (!detailShareUrl) return;
    await navigator.clipboard.writeText(detailShareUrl);
    dispatch({ type: "detail/setShareCopied", copied: true });
    setTimeout(() => dispatch({ type: "detail/setShareCopied", copied: false }), 2000);
  };

  // ============ Display-name editing ============

  const startEditing = (key: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "editing/start", key, value: currentName });
  };

  const saveDisplayName = async (acct: AccountGroup) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === getDisplayName(acct)) {
      dispatch({ type: "editing/cancel" });
      return;
    }
    dispatch({ type: "displayNames/update", key: acct.key, value: trimmed });
    dispatch({ type: "editing/cancel" });
    await supabase.from("account_display_names").upsert(
      {
        institution: acct.institution,
        account_number: acct.accountNumber || "",
        account_name: acct.accountName || "",
        display_name: trimmed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "institution,account_number,account_name" },
    );
  };

  // ============ Derived data ============

  const institutionGroups = useMemo(() => buildInstitutionGroups(statements), [statements]);
  const activeGroups = useMemo(
    () => institutionGroups.filter(isActiveGroup),
    [institutionGroups],
  );
  const archivedGroups = useMemo(
    () => institutionGroups.filter((g) => !isActiveGroup(g)),
    [institutionGroups],
  );

  const allAccountKeys = institutionGroups.flatMap((g) => g.accounts.map((a) => a.key));
  const allInstitutionKeys = institutionGroups.map((g) => g.institution);
  const totalAccounts = institutionGroups.reduce((sum, g) => sum + g.accounts.length, 0);

  const hasFilters = institution || accountType || holderFilter || yearFilter;

  // ============ Shared detail statement helpers ============

  const openDetail = (s: Statement) => {
    dispatch({ type: "detail/open", statement: s });
    getDetailShareUrl(s);
  };

  const renderInstGroup = (instGroup: (typeof institutionGroups)[number]) => (
    <InstitutionGroupCard
      key={instGroup.institution}
      instGroup={instGroup}
      expanded={expandedInstitutions.has(instGroup.institution)}
      expandedAccounts={expandedAccounts}
      acctSortField={acctSortField}
      acctSortDir={acctSortDir}
      parsedDocIds={parsedDocIds}
      editingKey={editingKey}
      editValue={editValue}
      getDisplayName={getDisplayName}
      onToggleInstitution={(inst) =>
        dispatch({ type: "expand/toggleInstitution", institution: inst })
      }
      onToggleAccount={(key) => dispatch({ type: "expand/toggleAccount", key })}
      onToggleSort={(field: AccountSortField) => dispatch({ type: "sort/toggle", field })}
      onStartEdit={startEditing}
      onEditValueChange={(value) => dispatch({ type: "editing/setValue", value })}
      onCancelEdit={() => dispatch({ type: "editing/cancel" })}
      onSaveEdit={saveDisplayName}
      onOpenDetail={openDetail}
      onLoadParsed={loadParsedDetail}
      onOpenShare={openShareModal}
    />
  );

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-900">Statements</h1>
        {!loading && (
          <span className="text-sm text-slate-400">
            {statements.length.toLocaleString()} statements across {totalAccounts} accounts
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <select
          value={institution}
          onChange={(e) =>
            dispatch({ type: "filter/set", field: "institution", value: e.target.value })
          }
          className={selectClass}
        >
          {INSTITUTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={accountType}
          onChange={(e) =>
            dispatch({ type: "filter/set", field: "accountType", value: e.target.value })
          }
          className={selectClass}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={holderFilter}
          onChange={(e) =>
            dispatch({ type: "filter/set", field: "holderFilter", value: e.target.value })
          }
          className={selectClass}
        >
          {HOLDERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) =>
            dispatch({ type: "filter/set", field: "yearFilter", value: e.target.value })
          }
          className={selectClass}
        >
          {YEARS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => dispatch({ type: "filter/clear" })}
            className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-16 text-slate-400">
          <div className="inline-block w-6 h-6 border-3 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-3">&#9888;</div>
          <p>{error}</p>
        </div>
      )}

      {/* Institution groups */}
      {!loading && !error && institutionGroups.length > 0 && (
        <>
          {/* Expand/collapse controls */}
          <div className="flex gap-3 mb-4 text-sm">
            <button
              onClick={() =>
                dispatch({
                  type: "expand/all",
                  institutions: allInstitutionKeys,
                  accounts: allAccountKeys,
                })
              }
              className="text-emerald-600 hover:text-emerald-700"
            >
              Expand all
            </button>
            <button
              onClick={() => dispatch({ type: "expand/collapseAll" })}
              className="text-slate-400 hover:text-slate-600"
            >
              Collapse all
            </button>
          </div>

          <div className="space-y-6">
            {/* Active Accounts */}
            {activeGroups.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
                    Active Accounts
                  </h2>
                  <span className="text-xs text-slate-400">
                    {activeGroups.length} institution{activeGroups.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-2">{activeGroups.map(renderInstGroup)}</div>
              </div>
            )}

            {/* Archived Accounts */}
            {archivedGroups.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                    Archived Accounts
                  </h2>
                  <span className="text-xs text-slate-400">
                    {archivedGroups.length} institution{archivedGroups.length !== 1 ? "s" : ""}{" "}
                    &middot; no activity in 6+ months
                  </span>
                </div>
                <div className="space-y-2 opacity-75">{archivedGroups.map(renderInstGroup)}</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !error && institutionGroups.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-4">{"\ud83c\udfe6"}</div>
          <p className="text-lg mb-2">No Statements Found</p>
          <p className="text-sm">
            {hasFilters
              ? "No statements match your current filters."
              : "No statements indexed yet."}
          </p>
        </div>
      )}

      {/* Statement detail modal */}
      {detailStatement && (
        <StatementDetailModal
          statement={detailStatement}
          displayNames={displayNames}
          hasParsed={parsedDocIds.has(detailStatement.id)}
          shareUrl={detailShareUrl}
          shareCopied={detailShareCopied}
          onClose={() => dispatch({ type: "detail/close" })}
          onCopyShareUrl={copyDetailShareUrl}
          onLoadParsed={loadParsedDetail}
          onOpenShare={openShareModal}
        />
      )}

      {/* Parsed data detail modal */}
      {parsedDetail && (
        <ParsedDataModal
          parsed={parsedDetail}
          loading={parsedLoading}
          onClose={() => dispatch({ type: "parsed/close" })}
        />
      )}

      {/* Share modal */}
      {shareModal && (
        <ShareStatementModal
          share={shareModal}
          appUsers={appUsers}
          currentAppUserId={currentAppUserId}
          onClose={() => dispatch({ type: "share/close" })}
          onCopy={copyShareLink}
          onToggleSendMode={() =>
            dispatch({ type: "share/patch", patch: { sendMode: !shareModal.sendMode } })
          }
          onSendToUser={sendToUser}
        />
      )}
    </div>
  );
}
