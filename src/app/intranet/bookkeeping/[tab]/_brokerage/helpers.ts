import type { Account, AccountGroup, BalanceSnapshot } from "./types";

// ============================================================
// Grouping
// ============================================================

/**
 * Bucket an account into a named group based on holder / type / name.
 * Pure; easy to unit test.
 */
export function getAccountGroup(acct: Account): string {
  const holder = acct.account_holder || "";
  const type = acct.account_type;
  const subtype = acct.account_subtype || "";
  const name = acct.display_name || "";

  if (holder.includes("Subhash") || name.startsWith("SubTrust")) return "SubTrust";
  if (
    subtype === "trust" &&
    (holder.includes("Haydn") || holder.includes("Hannah") || holder.includes("Emina"))
  )
    return "Kids Trust IRAs";
  if (holder.includes("Haydn") || holder.includes("Hannah") || holder.includes("Emina"))
    return "Other People's Money";
  if (holder.includes("Dina")) return "Other People's Money";
  if (holder.includes("Kathy")) return "Kathy";

  const retirementTypes = ["ira", "roth_ira", "401k", "403b"];
  if (retirementTypes.includes(type)) return "Retirement";
  return "Non Retirement";
}

export const GROUP_ORDER = [
  "Non Retirement",
  "Retirement",
  "SubTrust",
  "Kathy",
  "Kids Trust IRAs",
  "Other People's Money",
];

export function groupAccounts(accounts: Account[]): AccountGroup[] {
  const groups: Record<string, Account[]> = {};
  for (const acct of accounts) {
    const group = getAccountGroup(acct);
    if (!groups[group]) groups[group] = [];
    groups[group].push(acct);
  }
  return GROUP_ORDER.filter((n) => groups[n]?.length).map((n) => ({
    name: n,
    accounts: groups[n],
  }));
}

export function typeLabel(type: string): string {
  const map: Record<string, string> = {
    brokerage: "Brokerage",
    checking: "Checking",
    savings: "Savings",
    ira: "IRA",
    roth_ira: "Roth IRA",
    "401k": "401(k)",
    "403b": "403(b)",
    trust: "Trust",
    credit_card: "Credit Card",
    money_market: "Money Market",
    other: "Other",
  };
  return map[type] || type;
}

// ============================================================
// Formatters
// ============================================================

export const fmt = (n: number | null | undefined) =>
  n != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n)
    : "–";

export const fmtPct = (n: number | null | undefined) =>
  n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "–";

export const fmtQty = (n: number | null | undefined) =>
  n != null ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "–";

export const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      })
    : "";

// ============================================================
// Chart / date-range helpers
// ============================================================

export const RANGE_DAYS: Record<string, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  YTD: 0,
  "1Y": 365,
  "2Y": 730,
};

export function getRangeDays(range: string): number {
  if (range === "YTD") {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.ceil((now.getTime() - jan1.getTime()) / 86400000);
  }
  return RANGE_DAYS[range] || 30;
}

export function filterByRange(snapshots: BalanceSnapshot[], range: string): BalanceSnapshot[] {
  const days = getRangeDays(range);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  return snapshots.filter((s) => s.snapshot_date >= cutoffStr);
}
