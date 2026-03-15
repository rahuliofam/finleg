"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface FindingGroup {
  title: string;
  severity: "critical" | "warning" | "info";
  items: string[];
}

export default function LedgerNotesTab() {
  const [stats, setStats] = useState<{
    totalRows: number;
    totalAccounts: number;
    dateRange: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const { count } = await supabase
          .from("qb_general_ledger")
          .select("*", { count: "exact", head: true });

        setStats({
          totalRows: count || 0,
          totalAccounts: 155,
          dateRange: "January 1, 2025 - March 15, 2026",
        });
      } catch {
        setStats({
          totalRows: 9288,
          totalAccounts: 155,
          dateRange: "January 1, 2025 - March 15, 2026",
        });
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  const findings: FindingGroup[] = [
    {
      title: "Duplicate Transactions",
      severity: "critical",
      items: [
        "Blue Rhino Propane (2026-01-09): 4 identical entries of $19.92 across Utilities (AAP) and Chase Visa CC - Subhash. Likely double-booked.",
        "COA Parking Meters (2025-06-20): 3 identical entries of $2.75 across Toll & Parking Expenses and Chase Amazon Prime. Check for duplicate imports.",
        "Best Buy $150.47 (2025-06-28): 2 identical entries across Office Supplies and Amex Blue Preferred.",
        "Venmo Payment $300 (2025-05-18): 2 identical entries in Schwab Trust Checking.",
        "Facebook Ads (2025-02-15 & 02-17): 2 duplicate entries each on Apple Credit Card.",
        "GE Window AC $169.95 (2025-06-30): Duplicate in Household Equipment.",
      ],
    },
    {
      title: "Large Transactions (>$10,000) Requiring Review",
      severity: "warning",
      items: [
        "Tesla Model Y - Cuygnus: $40,568 journal entry (2025-08-28). Verify loan amount matches purchase.",
        "Tesla Model Y - Sloop: $38,697 journal entry (2025-10-17). Second Tesla purchase same year.",
        "Federal Income Taxes (Hannah): $35,541 check to US Treasury (2025-04-13). Verify correct taxpayer allocation.",
        "Hannah Brokerage transfer: $33,000.77 (2025-04-14). Large brokerage-to-checking movement.",
        "Emina Brokerage transfer: $30,007.77 (2025-04-14). Same-day large transfer.",
        "Swan Investment wire: $25,000 (2025-07-17). Memo says 'need to review with Rahul'.",
        "Decentralnet wire: $25,000 (2025-08-05). Single wire to investment entity.",
        "Chase CC autopay: $18,709.06 (2025-06-03). Unusually large credit card payment.",
      ],
    },
    {
      title: "Negative Account Balances (Potential Issues)",
      severity: "critical",
      items: [
        "Schwab Trust - Subhash (2028): Balance of -$3,987,781. This is likely a tracking/brokerage account but the magnitude warrants verification.",
        "Schwab Brokerage (0566) - Rahul: Balance reached -$272,094. Verify if margin or tracking error.",
        "Schwab Trust Checking (0044) - Subhash: Went to -$57,595. Possible timing of transfers vs. expenses.",
        "Schwab Checking (3711) - Rahul: Went to -$10,906. Checking account shouldn't go this negative.",
        "Direct Lodging Deposits: -$5,201. Deposit account with negative balance suggests unreconciled refunds.",
        "Venmo Account - Rahul: Went to -$2,062. Peer-to-peer account deficit.",
        "Suspense Account: -$1,560. Items sitting in suspense need to be classified.",
        "US Bank Primary (7444) - Rahul: Went to -$1,226. Checking overdraft.",
      ],
    },
    {
      title: "Missing Data / Uncategorized",
      severity: "warning",
      items: [
        "874 transactions have no vendor/payee name. These should be identified for proper reporting.",
        "510 transactions have no memo/description. Makes it harder to verify transaction purpose.",
        "35 accounts have only a beginning balance and zero transactions (inactive/deleted). Consider archiving.",
        "Suspense Account has active transactions totaling -$1,560. All items need to be reclassified to proper accounts.",
        "Uncategorized Asset account exists with beginning balance only. Review if any assets need to be recorded.",
      ],
    },
    {
      title: "Deleted Accounts With Activity",
      severity: "warning",
      items: [
        "Amex Green (91002) - Rahul (deleted): 66 transactions, net -$31.77. Small residual balance on deleted card.",
        "Amex Blue (38005) - Rahul (deleted): 18 transactions, net -$24.54. Residual balance.",
        "Wells Fargo Checking (0709) - Rahul (deleted): 4 transactions, net -$853.66. Non-trivial balance on deleted account.",
      ],
    },
    {
      title: "Possible Misclassifications",
      severity: "warning",
      items: [
        "Accounting Expenses: $8,117.90 in positive amounts (14 transactions). Expenses should be negative - verify if these are refunds or misposted.",
        "Cleaning Expenses (AAP): $5,869.94 positive across 75 transactions. Same concern.",
        "Personal Expenses - Rahul: $2,709.41 positive across 52 transactions. Check if credits/refunds or wrong sign.",
        "Car Rental Income: -$881 (5 transactions). Income account with negative entries - either refunds or misclassified expenses.",
        "Non-Taxable Income: -$62.39 expense. Small but should be reviewed.",
      ],
    },
    {
      title: "Stale Accounts (No Activity in 6+ Months)",
      severity: "info",
      items: [
        "Advertising/Promotional (Wingsie): Last activity 2025-02-28 (28 transactions). If Wingsie project is done, archive this.",
        "Donations Rahul: Last activity 2025-03-20 (7 transactions). Donations stopped?",
        "CapEx Asset: Last activity 2025-03-30 (7 transactions). Capital expenditure tracking paused.",
        "Schwab Trust - Subhash (2028): Last activity 2025-06-30 (15 transactions). Large brokerage account dormant.",
        "Transportation: Last activity 2025-07-14 (11 transactions). Being tracked elsewhere?",
      ],
    },
    {
      title: "Flagged Transaction - Needs Discussion",
      severity: "warning",
      items: [
        "Swan Investment wire $25,000 (2025-07-17): Memo explicitly says 'need to review with Rahul'. Has this been reviewed?",
        "Coinbase Crypto via Revolut: 4 transactions totaling $7,490 in Jan-Feb 2026. All coded to Revolut - verify crypto classification.",
        "ATM withdrawals: 54 transactions totaling $14,771.66. High cash usage - verify all are accounted for.",
        "Kathy Sonnad: 15 transactions totaling $21,982.96. Verify relationship and classification.",
      ],
    },
  ];

  const topVendors = [
    { name: "Chase Bank (CC payments)", total: "$278,732" },
    { name: "Robinhood", total: "$77,835" },
    { name: "US Treasury (taxes)", total: "$59,590" },
    { name: "Genesis Structures", total: "$55,663" },
    { name: "US Bank Loan", total: "$46,502" },
    { name: "PNC Mortgage", total: "$37,500" },
    { name: "Decentralnet", total: "$25,000" },
    { name: "Swan", total: "$25,000" },
    { name: "Kathy Sonnad", total: "$21,983" },
    { name: "US Bank", total: "$20,603" },
  ];

  const severityStyles = {
    critical: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };

  const severityLabels = {
    critical: "Needs Attention",
    warning: "Review",
    info: "Informational",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ledger Notes</h1>
          <p className="text-sm text-slate-500 mt-1">
            QuickBooks General Ledger analysis for Sonnad Financial
          </p>
        </div>
        <span className="text-xs text-slate-400">
          Analyzed: March 15, 2026
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">
            {loading ? "..." : stats?.totalRows.toLocaleString()}
          </div>
          <div className="text-sm text-slate-500">Transactions</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">
            {loading ? "..." : stats?.totalAccounts}
          </div>
          <div className="text-sm text-slate-500">Accounts</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">15 months</div>
          <div className="text-sm text-slate-500">
            {stats?.dateRange || "Jan 2025 - Mar 2026"}
          </div>
        </div>
      </div>

      {/* Monthly Trend */}
      <div className="rounded-xl border border-slate-200 p-5">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          Monthly Overview
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 font-medium text-slate-600">
                  Month
                </th>
                <th className="text-right py-2 px-3 font-medium text-slate-600">
                  Transactions
                </th>
                <th className="text-right py-2 px-3 font-medium text-slate-600">
                  Income
                </th>
                <th className="text-right py-2 px-3 font-medium text-slate-600">
                  Expenses
                </th>
                <th className="text-right py-2 px-3 font-medium text-slate-600">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  m: "Jan 2025",
                  t: 567,
                  i: 127829,
                  e: -89541,
                },
                { m: "Feb 2025", t: 556, i: 88359, e: -72207 },
                {
                  m: "Mar 2025",
                  t: 537,
                  i: 144986,
                  e: -100360,
                },
                {
                  m: "Apr 2025",
                  t: 683,
                  i: 326642,
                  e: -134159,
                },
                {
                  m: "May 2025",
                  t: 623,
                  i: 122813,
                  e: -99222,
                },
                {
                  m: "Jun 2025",
                  t: 596,
                  i: 104724,
                  e: -103328,
                },
                {
                  m: "Jul 2025",
                  t: 721,
                  i: 276650,
                  e: -129305,
                },
                {
                  m: "Aug 2025",
                  t: 639,
                  i: 178225,
                  e: -108293,
                },
                {
                  m: "Sep 2025",
                  t: 697,
                  i: 152936,
                  e: -134178,
                },
                {
                  m: "Oct 2025",
                  t: 756,
                  i: 255419,
                  e: -118287,
                },
                {
                  m: "Nov 2025",
                  t: 696,
                  i: 135354,
                  e: -72662,
                },
                {
                  m: "Dec 2025",
                  t: 698,
                  i: 239934,
                  e: -138693,
                },
                {
                  m: "Jan 2026",
                  t: 832,
                  i: 170660,
                  e: -91741,
                },
                {
                  m: "Feb 2026",
                  t: 569,
                  i: 137549,
                  e: -76760,
                },
                { m: "Mar 2026*", t: 40, i: 2087, e: -1281 },
              ].map((row) => (
                <tr key={row.m} className="border-b border-slate-100">
                  <td className="py-2 px-3 text-slate-700">{row.m}</td>
                  <td className="py-2 px-3 text-right text-slate-600">
                    {row.t}
                  </td>
                  <td className="py-2 px-3 text-right text-green-700">
                    ${row.i.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right text-red-600">
                    -${Math.abs(row.e).toLocaleString()}
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-medium ${
                      row.i + row.e >= 0 ? "text-green-700" : "text-red-600"
                    }`}
                  >
                    {row.i + row.e >= 0 ? "$" : "-$"}
                    {Math.abs(row.i + row.e).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">* Partial month</p>
      </div>

      {/* Top Vendors */}
      <div className="rounded-xl border border-slate-200 p-5">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          Top 10 Vendors by Spend
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {topVendors.map((v, i) => (
            <div
              key={v.name}
              className="flex justify-between items-center py-1.5 px-3 rounded-lg bg-slate-50"
            >
              <span className="text-sm text-slate-700">
                <span className="text-slate-400 mr-2">{i + 1}.</span>
                {v.name}
              </span>
              <span className="text-sm font-medium text-slate-900">
                {v.total}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Findings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Findings & Anomalies
        </h2>
        {findings.map((group) => (
          <div
            key={group.title}
            className={`rounded-xl border p-5 ${severityStyles[group.severity]}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-semibold">{group.title}</h3>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  group.severity === "critical"
                    ? "bg-red-200 text-red-900"
                    : group.severity === "warning"
                      ? "bg-amber-200 text-amber-900"
                      : "bg-blue-200 text-blue-900"
                }`}
              >
                {severityLabels[group.severity]}
              </span>
            </div>
            <ul className="space-y-2">
              {group.items.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 p-5 bg-slate-50">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Data Source
        </h2>
        <p className="text-sm text-slate-600">
          General Ledger export from QuickBooks Online (Sonnad Financial).
          Accrual basis. Exported March 15, 2026. Stored in Supabase table{" "}
          <code className="bg-slate-200 px-1.5 py-0.5 rounded text-xs">
            qb_general_ledger
          </code>
          .
        </p>
      </div>
    </div>
  );
}
