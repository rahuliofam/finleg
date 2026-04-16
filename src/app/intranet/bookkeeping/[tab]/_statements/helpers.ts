import type {
  AccountGroup,
  AccountSortField,
  InstitutionGroup,
  SortDir,
  Statement,
} from "./types";
import { accountTypeLabel, institutionLabel } from "./constants";

/**
 * Group statements first by (institution|account_name|account_number), then by institution.
 * Accounts inside each institution are sorted: open first, then alphabetical by account name.
 * Institution groups are sorted alphabetically by label.
 */
export function buildInstitutionGroups(statements: Statement[]): InstitutionGroup[] {
  // First build account groups
  const accountMap = new Map<string, AccountGroup>();
  for (const s of statements) {
    const key = `${s.institution}|${s.account_name}|${s.account_number}`;
    if (!accountMap.has(key)) {
      accountMap.set(key, {
        key,
        institution: s.institution,
        accountName: s.account_name,
        accountNumber: s.account_number,
        accountHolder: s.account_holder,
        accountType: s.account_type,
        isClosed: s.is_closed,
        statements: [],
      });
    }
    accountMap.get(key)!.statements.push(s);
  }

  // Group accounts by institution
  const instMap = new Map<string, AccountGroup[]>();
  for (const acct of accountMap.values()) {
    if (!instMap.has(acct.institution)) instMap.set(acct.institution, []);
    instMap.get(acct.institution)!.push(acct);
  }

  // Sort and build institution groups
  return Array.from(instMap.entries())
    .map(([inst, accounts]) => ({
      institution: inst,
      label: institutionLabel(inst),
      accounts: accounts.sort((a, b) => {
        if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
        return a.accountName.localeCompare(b.accountName);
      }),
      totalStatements: accounts.reduce((sum, a) => sum + a.statements.length, 0),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A group is "active" if any statement is from the current calendar year
 * or within the last 6 months.
 */
export function isActiveGroup(group: InstitutionGroup): boolean {
  const now = new Date();
  const currentYear = now.getFullYear();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoffYear = sixMonthsAgo.getFullYear();
  const cutoffMonth = sixMonthsAgo.getMonth() + 1; // 1-indexed

  return group.accounts.some((acct) =>
    acct.statements.some((s) => {
      if (!s.year) return false;
      if (s.year >= currentYear) return true;
      if (s.year === cutoffYear && s.month && s.month >= cutoffMonth) return true;
      return false;
    })
  );
}

/**
 * Sort a list of account groups by a field and direction,
 * using a display-name lookup for the "name" column.
 */
export function sortAccounts(
  accounts: AccountGroup[],
  field: AccountSortField,
  dir: SortDir,
  getDisplayName: (a: AccountGroup) => string,
): AccountGroup[] {
  return [...accounts].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "name":
        cmp = getDisplayName(a).localeCompare(getDisplayName(b));
        break;
      case "number":
        cmp = (a.accountNumber || "").localeCompare(b.accountNumber || "");
        break;
      case "type":
        cmp = accountTypeLabel(a.accountType).localeCompare(accountTypeLabel(b.accountType));
        break;
      case "holder":
        cmp = (a.accountHolder || "").localeCompare(b.accountHolder || "");
        break;
      case "stmts":
        cmp = a.statements.length - b.statements.length;
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

export function fmtStatementDate(d: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
