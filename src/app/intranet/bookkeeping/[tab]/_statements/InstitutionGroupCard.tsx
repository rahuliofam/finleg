"use client";

import React, { useRef, useEffect } from "react";
import type {
  AccountGroup,
  AccountSortField,
  InstitutionGroup,
  SortDir,
  Statement,
} from "./types";
import {
  MONTH_NAMES,
  accountTypeLabel,
  fileUrl,
  formatSize,
  institutionLogo,
} from "./constants";
import { fmtStatementDate, sortAccounts } from "./helpers";

const SORT_COLUMNS: [AccountSortField, string, string][] = [
  ["name", "Account", "text-left"],
  ["number", "Acct #", "text-left"],
  ["type", "Type", "text-left"],
  ["holder", "Holder", "text-left"],
  ["stmts", "Stmts", "text-right"],
];

interface Props {
  instGroup: InstitutionGroup;
  expanded: boolean;
  expandedAccounts: Set<string>;
  acctSortField: AccountSortField;
  acctSortDir: SortDir;
  parsedDocIds: Set<string>;
  editingKey: string | null;
  editValue: string;
  getDisplayName: (acct: AccountGroup) => string;
  onToggleInstitution: (institution: string) => void;
  onToggleAccount: (key: string) => void;
  onToggleSort: (field: AccountSortField) => void;
  onStartEdit: (key: string, currentName: string, e: React.MouseEvent) => void;
  onEditValueChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (acct: AccountGroup) => void;
  onOpenDetail: (s: Statement) => void;
  onLoadParsed: (s: Statement) => void;
  onOpenShare: (s: Statement) => void;
}

export default function InstitutionGroupCard({
  instGroup,
  expanded,
  expandedAccounts,
  acctSortField,
  acctSortDir,
  parsedDocIds,
  editingKey,
  editValue,
  getDisplayName,
  onToggleInstitution,
  onToggleAccount,
  onToggleSort,
  onStartEdit,
  onEditValueChange,
  onCancelEdit,
  onSaveEdit,
  onOpenDetail,
  onLoadParsed,
  onOpenShare,
}: Props) {
  const editRef = useRef<HTMLInputElement>(null);

  // Focus the input whenever editing starts
  useEffect(() => {
    if (editingKey && editRef.current) {
      editRef.current.focus();
    }
  }, [editingKey]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Institution header */}
      <button
        onClick={() => onToggleInstitution(instGroup.institution)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-xl flex-shrink-0">{institutionLogo(instGroup.institution)}</span>
        <span className="font-semibold text-slate-900 flex-1">{instGroup.label}</span>
        <span className="text-xs text-slate-400 mr-2">
          {instGroup.accounts.length} account{instGroup.accounts.length !== 1 ? "s" : ""}
          {" \u00b7 "}
          {instGroup.totalStatements} stmt{instGroup.totalStatements !== 1 ? "s" : ""}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded: accounts table */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[0.65rem] text-slate-400 uppercase tracking-wider">
                {SORT_COLUMNS.map(([field, label, align]) => (
                  <th
                    key={field}
                    onClick={() => onToggleSort(field)}
                    className={`${align} py-2 pr-3 font-medium cursor-pointer hover:text-slate-600 transition-colors select-none ${field === "stmts" ? "pr-0" : ""}`}
                  >
                    {label}
                    {acctSortField === field && (
                      <span className="ml-1 text-emerald-500">
                        {acctSortDir === "asc" ? "\u25b2" : "\u25bc"}
                      </span>
                    )}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {sortAccounts(instGroup.accounts, acctSortField, acctSortDir, getDisplayName).map(
                (acct) => {
                  const acctExpanded = expandedAccounts.has(acct.key);
                  return (
                    <React.Fragment key={acct.key}>
                      <tr
                        onClick={() => onToggleAccount(acct.key)}
                        className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${acct.isClosed ? "opacity-60" : ""}`}
                      >
                        {/* Account Name (with inline edit) */}
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1.5">
                            {editingKey === acct.key ? (
                              <input
                                ref={editRef}
                                value={editValue}
                                onChange={(e) => onEditValueChange(e.target.value)}
                                onBlur={() => onSaveEdit(acct)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") onSaveEdit(acct);
                                  if (e.key === "Escape") onCancelEdit();
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm font-medium text-slate-700 border border-emerald-300 rounded px-2 py-0.5 outline-none focus:border-emerald-500 bg-white w-full"
                              />
                            ) : (
                              <>
                                <span className="font-medium text-slate-800 truncate">
                                  {getDisplayName(acct)}
                                </span>
                                <span
                                  onClick={(e) => onStartEdit(acct.key, getDisplayName(acct), e)}
                                  className="text-slate-300 hover:text-emerald-600 cursor-pointer flex-shrink-0"
                                  title="Edit display name"
                                >
                                  <svg
                                    className="w-3 h-3"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    />
                                  </svg>
                                </span>
                                {acct.isClosed && (
                                  <span className="text-[0.6rem] uppercase font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                    Closed
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        {/* Account Number */}
                        <td className="py-2 pr-3 text-xs text-slate-400 font-mono whitespace-nowrap">
                          {acct.accountNumber ? `****${acct.accountNumber}` : "\u2014"}
                        </td>
                        {/* Type */}
                        <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                          {accountTypeLabel(acct.accountType)}
                        </td>
                        {/* Holder */}
                        <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                          {acct.accountHolder && acct.accountHolder !== "various"
                            ? acct.accountHolder
                            : "\u2014"}
                        </td>
                        {/* Stmts */}
                        <td className="py-2 text-xs text-slate-400 text-right whitespace-nowrap">
                          {acct.statements.length}
                        </td>
                        {/* Expand chevron */}
                        <td className="py-2 pl-2 w-8">
                          <svg
                            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${acctExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </td>
                      </tr>
                      {acctExpanded && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <div className="pl-4 pb-2 mb-2 border-l-2 border-emerald-200 ml-2">
                              <div className="text-[0.65rem] text-slate-400 uppercase tracking-wider font-medium py-1.5">
                                {getDisplayName(acct)} &mdash; {acct.statements.length} statement
                                {acct.statements.length !== 1 ? "s" : ""}
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-[0.6rem] text-slate-400 uppercase tracking-wider">
                                    <th className="text-left py-1 pr-3 font-medium">Starting</th>
                                    <th className="text-left py-1 pr-3 font-medium">Ending</th>
                                    <th className="text-left py-1 pr-3 font-medium">Filename</th>
                                    <th className="text-right py-1 pr-3 font-medium">Size</th>
                                    <th className="text-center py-1 font-medium w-16">View</th>
                                    <th className="text-center py-1 font-medium w-16">Data</th>
                                    <th className="text-center py-1 font-medium w-16">Share</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {acct.statements.map((s) => {
                                    const hasParsed = parsedDocIds.has(s.id);
                                    const startDate = fmtStatementDate(s.period_start);
                                    const endDate = fmtStatementDate(s.period_end);
                                    const fallbackPeriod = s.month
                                      ? `${MONTH_NAMES[s.month]} ${s.year}`
                                      : s.year
                                        ? String(s.year)
                                        : null;
                                    return (
                                      <tr
                                        key={s.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOpenDetail(s);
                                        }}
                                        className="hover:bg-emerald-50 cursor-pointer transition-colors border-t border-slate-50"
                                      >
                                        <td className="py-1.5 pr-3 text-slate-800 whitespace-nowrap">
                                          {startDate || fallbackPeriod || "\u2014"}
                                        </td>
                                        <td className="py-1.5 pr-3 text-slate-800 whitespace-nowrap">
                                          {endDate || "\u2014"}
                                        </td>
                                        <td className="py-1.5 pr-3 text-slate-500 truncate max-w-[300px]">
                                          {s.filename}
                                        </td>
                                        <td className="py-1.5 pr-3 text-slate-400 text-right whitespace-nowrap text-xs">
                                          {formatSize(s.file_size)}
                                        </td>
                                        {/* View original PDF */}
                                        <td className="py-1.5 text-center w-16">
                                          <a
                                            href={fileUrl(s.bucket, s.r2_key)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-emerald-600 hover:text-emerald-800 text-xs font-medium"
                                            title="View original document"
                                          >
                                            PDF
                                          </a>
                                        </td>
                                        {/* Parsed data */}
                                        <td className="py-1.5 text-center w-16">
                                          {hasParsed ? (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onLoadParsed(s);
                                              }}
                                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                              title="View parsed statement data"
                                            >
                                              View
                                            </button>
                                          ) : (
                                            <span className="text-slate-300 text-xs">&mdash;</span>
                                          )}
                                        </td>
                                        {/* Share */}
                                        <td className="py-1.5 text-center w-16">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOpenShare(s);
                                            }}
                                            className="text-slate-400 hover:text-emerald-600 text-xs font-medium transition-colors"
                                            title="Share this statement"
                                          >
                                            <svg
                                              className="w-3.5 h-3.5 inline"
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                              strokeWidth={2}
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                                              />
                                            </svg>
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
