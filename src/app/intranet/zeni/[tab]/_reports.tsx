"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Feature 6: Financial Report Builder with Export
 * Customizable spending reports with CSV and PDF export.
 * Self-contained — remove from _tab-content.tsx to back out.
 */

type ReportPeriod = "months" | "quarters" | "years";
type ReportView = "summary" | "detailed";

interface ReportRow {
  category: string;
  periods: Record<string, number>;
  total: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function getPeriodKey(date: string, period: ReportPeriod): string {
  const [y, m] = date.split("-");
  switch (period) {
    case "months":
      return `${y}-${m}`;
    case "quarters": {
      const q = Math.ceil(Number(m) / 3);
      return `${y} Q${q}`;
    }
    case "years":
      return y;
  }
}

function getPeriodLabel(key: string, period: ReportPeriod): string {
  switch (period) {
    case "months": {
      const [y, m] = key.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
    }
    case "quarters":
    case "years":
      return key;
  }
}

function downloadCSV(rows: ReportRow[], periodKeys: string[], period: ReportPeriod) {
  const header = ["Category", ...periodKeys.map((k) => getPeriodLabel(k, period)), "Total"];
  const csvRows = [header.join(",")];

  for (const row of rows) {
    const cells = [
      `"${row.category}"`,
      ...periodKeys.map((k) => (row.periods[k] || 0).toFixed(2)),
      row.total.toFixed(2),
    ];
    csvRows.push(cells.join(","));
  }

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `financial-report-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPDF(rows: ReportRow[], periodKeys: string[], period: ReportPeriod, title: string) {
  // Build a print-friendly HTML table and trigger browser print
  const colHeaders = periodKeys.map((k) => getPeriodLabel(k, period));
  const tableRows = rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${r.category}</td>
          ${periodKeys.map((k) => `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${formatCurrency(r.periods[k] || 0)}</td>`).join("")}
          <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">${formatCurrency(r.total)}</td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html><html><head><title>${title}</title>
    <style>body{font-family:system-ui;margin:40px}table{border-collapse:collapse;width:100%}
    th{background:#f1f5f9;padding:6px 8px;text-align:right;border-bottom:2px solid #cbd5e1}
    th:first-child{text-align:left}td:first-child{text-align:left}</style></head>
    <body><h2>${title}</h2><p style="color:#64748b">Generated ${new Date().toLocaleDateString()}</p>
    <table><thead><tr><th>Category</th>${colHeaders.map((h) => `<th>${h}</th>`).join("")}<th>Total</th></tr></thead>
    <tbody>${tableRows}</tbody></table></body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }
}

export default function ReportsTab() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [periodKeys, setPeriodKeys] = useState<string[]>([]);
  const [period, setPeriod] = useState<ReportPeriod>("months");
  const [view, setView] = useState<ReportView>("summary");
  const [showYTD, setShowYTD] = useState(true);
  const [monthsBack, setMonthsBack] = useState(6);

  const fetchReport = useCallback(async () => {
    setLoading(true);

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    const startStr = startDate.toISOString().split("T")[0];

    const { data: txns } = await supabase
      .from("qb_transactions")
      .select("txn_date, amount, qb_type, our_category, qb_account_name")
      .eq("is_deleted", false)
      .eq("qb_type", "Purchase")
      .gte("txn_date", startStr)
      .order("txn_date", { ascending: true });

    if (!txns) {
      setLoading(false);
      return;
    }

    // Group by category and period
    const catPeriods = new Map<string, Record<string, number>>();

    for (const t of txns) {
      const cat = view === "detailed"
        ? (t.our_category || "Uncategorized")
        : (t.our_category || "Uncategorized").split(" - ")[0]; // group parent category
      const pk = getPeriodKey(t.txn_date, period);
      const amt = Math.abs(Number(t.amount));

      if (!catPeriods.has(cat)) catPeriods.set(cat, {});
      const periods = catPeriods.get(cat)!;
      periods[pk] = (periods[pk] || 0) + amt;
    }

    // Collect all period keys and sort
    const allPeriods = new Set<string>();
    for (const periods of catPeriods.values()) {
      for (const k of Object.keys(periods)) allPeriods.add(k);
    }
    const sortedPeriods = Array.from(allPeriods).sort();

    // Build rows
    const reportRows: ReportRow[] = Array.from(catPeriods.entries()).map(([category, periods]) => ({
      category,
      periods,
      total: Object.values(periods).reduce((sum, v) => sum + v, 0),
    }));

    reportRows.sort((a, b) => b.total - a.total);

    setRows(reportRows);
    setPeriodKeys(sortedPeriods);
    setLoading(false);
  }, [period, view, monthsBack]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const grandTotals = periodKeys.reduce<Record<string, number>>((acc, pk) => {
    acc[pk] = rows.reduce((sum, r) => sum + (r.periods[pk] || 0), 0);
    return acc;
  }, {});
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Financial Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Spending breakdown with export</p>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Period toggle */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Period</label>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {(["months", "quarters", "years"] as ReportPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    period === p
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* View toggle */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Detail Level</label>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {(["summary", "detailed"] as ReportView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === v
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Range selector */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">Range</label>
            <select
              value={monthsBack}
              onChange={(e) => setMonthsBack(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700"
            >
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 24 months</option>
            </select>
          </div>

          {/* YTD toggle */}
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showYTD}
              onChange={(e) => setShowYTD(e.target.checked)}
              className="rounded border-slate-300"
            />
            YTD Total
          </label>

          {/* Export buttons */}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => downloadCSV(rows, periodKeys, period)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={() => downloadPDF(rows, periodKeys, period, "Spending Report")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading report...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">
          No data for this period.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600 sticky left-0 bg-slate-50">
                  Category
                </th>
                {periodKeys.map((pk) => (
                  <th
                    key={pk}
                    className="text-right px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
                  >
                    {getPeriodLabel(pk, period)}
                  </th>
                ))}
                {showYTD && (
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-900 whitespace-nowrap">
                    Total
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-2 text-slate-700 sticky left-0 bg-white truncate max-w-[200px]">
                    {row.category}
                  </td>
                  {periodKeys.map((pk) => (
                    <td key={pk} className="text-right px-3 py-2 text-slate-600 whitespace-nowrap">
                      {row.periods[pk] ? formatCurrency(row.periods[pk]) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                  {showYTD && (
                    <td className="text-right px-4 py-2 text-slate-900 font-medium whitespace-nowrap">
                      {formatCurrency(row.total)}
                    </td>
                  )}
                </tr>
              ))}
              {/* Grand total row */}
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                <td className="px-4 py-2.5 text-slate-900 sticky left-0 bg-slate-50">Total</td>
                {periodKeys.map((pk) => (
                  <td key={pk} className="text-right px-3 py-2.5 text-slate-900 whitespace-nowrap">
                    {formatCurrency(grandTotals[pk] || 0)}
                  </td>
                ))}
                {showYTD && (
                  <td className="text-right px-4 py-2.5 text-slate-900 whitespace-nowrap">
                    {formatCurrency(grandTotal)}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
