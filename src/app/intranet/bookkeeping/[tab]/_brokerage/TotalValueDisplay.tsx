"use client";

import type { Account, BalanceSnapshot } from "./types";
import { filterByRange, fmt } from "./helpers";
import { FONT, S } from "./styles";

interface Props {
  accounts: Account[];
  balanceHistory: BalanceSnapshot[];
  chartRange: string;
  chartView: "chart" | "table";
  totalValue: number;
}

export default function TotalValueDisplay({
  accounts,
  balanceHistory,
  chartRange,
  chartView,
  totalValue,
}: Props) {
  const filtered = filterByRange(balanceHistory, chartRange);

  // Group by date, summing total_value across all accounts
  const dateMap = new Map<string, { total: number; byAccount: Map<string, number> }>();
  for (const snap of filtered) {
    if (!dateMap.has(snap.snapshot_date)) {
      dateMap.set(snap.snapshot_date, { total: 0, byAccount: new Map() });
    }
    const entry = dateMap.get(snap.snapshot_date)!;
    const val = snap.total_value || 0;
    entry.total += val;
    entry.byAccount.set(snap.account_id, val);
  }

  const sortedDates = [...dateMap.keys()].sort();

  // Build account lookup for display names — only include accounts with balance data
  const accountsWithData = accounts.filter((a) => {
    return filtered.some((s) => s.account_id === a.id && s.total_value != null);
  });

  if (sortedDates.length === 0) {
    // No historical data — show current snapshot as single row
    const today = new Date().toISOString().split("T")[0];
    return (
      <div>
        {chartView === "table" ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: "left" }}>Date</th>
                {accounts
                  .filter((a) => (a.total_value || a.balance_current || 0) > 0)
                  .map((a) => (
                    <th key={a.id} style={{ ...S.th, textAlign: "right" }}>
                      {a.display_name || a.account_number_masked}
                    </th>
                  ))}
                <th style={{ ...S.th, textAlign: "right", fontWeight: 700 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.td}>{today}</td>
                {accounts
                  .filter((a) => (a.total_value || a.balance_current || 0) > 0)
                  .map((a) => (
                    <td key={a.id} style={{ ...S.td, textAlign: "right" }}>
                      {fmt(a.total_value || a.balance_current)}
                    </td>
                  ))}
                <td style={{ ...S.td, textAlign: "right", fontWeight: 700 }}>{fmt(totalValue)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: "#999", fontSize: 13 }}>
            No historical data yet. Run daily syncs to build chart history.
          </div>
        )}
      </div>
    );
  }

  if (chartView === "table") {
    return (
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th
                style={{
                  ...S.th,
                  textAlign: "left",
                  position: "sticky",
                  top: 0,
                  background: "#fff",
                  zIndex: 1,
                }}
              >
                Date
              </th>
              {accountsWithData.map((a) => (
                <th
                  key={a.id}
                  style={{
                    ...S.th,
                    textAlign: "right",
                    position: "sticky",
                    top: 0,
                    background: "#fff",
                    zIndex: 1,
                  }}
                >
                  {a.display_name || a.account_number_masked}
                </th>
              ))}
              <th
                style={{
                  ...S.th,
                  textAlign: "right",
                  fontWeight: 700,
                  position: "sticky",
                  top: 0,
                  background: "#fff",
                  zIndex: 1,
                }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {[...sortedDates].reverse().map((date, idx) => {
              const entry = dateMap.get(date)!;
              const rowBg = idx % 2 === 1 ? "#f8f8f8" : "#fff";
              return (
                <tr key={date} style={{ background: rowBg }}>
                  <td style={S.td}>
                    {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  {accountsWithData.map((a) => (
                    <td key={a.id} style={{ ...S.td, textAlign: "right" }}>
                      {entry.byAccount.has(a.id) ? fmt(entry.byAccount.get(a.id)!) : "–"}
                    </td>
                  ))}
                  <td style={{ ...S.td, textAlign: "right", fontWeight: 600 }}>
                    {fmt(entry.total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Chart view — SVG with real data points
  const chartW = 900;
  const chartH = 200;
  const marginR = 60;
  const marginB = 30;
  const values = sortedDates.map((d) => dateMap.get(d)!.total);
  const minVal = Math.min(...values) * 0.998;
  const maxVal = Math.max(...values) * 1.002;
  const range = maxVal - minVal || 1;

  const points = sortedDates.map((_, i) => {
    const x = (i / Math.max(sortedDates.length - 1, 1)) * (chartW - marginR);
    const y = chartH - marginB - ((values[i] - minVal) / range) * (chartH - marginB - 10);
    return [x, y] as [number, number];
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const fillPath = `${linePath} V${chartH - marginB} H0 Z`;

  // Y-axis labels
  const yLabels = [0, 0.33, 0.66, 1].map((frac) => {
    const val = minVal + frac * range;
    if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  });

  // X-axis: show ~8 evenly spaced date labels
  const xTickCount = Math.min(sortedDates.length, 8);
  const xStep = Math.max(1, Math.floor(sortedDates.length / xTickCount));

  return (
    <svg
      viewBox={`0 0 ${chartW} ${chartH + 5}`}
      style={{ width: "100%", height: 250, display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d7a3e" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#0d7a3e" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((frac, i) => (
        <line
          key={i}
          x1={0}
          y1={(chartH - marginB) * frac}
          x2={chartW - marginR}
          y2={(chartH - marginB) * frac}
          stroke="#eee"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
      ))}
      <line
        x1={0}
        y1={chartH - marginB}
        x2={chartW - marginR}
        y2={chartH - marginB}
        stroke="#ddd"
        strokeWidth="1"
      />
      <path d={fillPath} fill="url(#chartFill)" />
      <path d={linePath} fill="none" stroke="#0d7a3e" strokeWidth="1.5" />
      {sortedDates
        .filter((_, i) => i % xStep === 0 || i === sortedDates.length - 1)
        .map((date, i) => {
          const idx = sortedDates.indexOf(date);
          const x = (idx / Math.max(sortedDates.length - 1, 1)) * (chartW - marginR);
          return (
            <text
              key={i}
              x={x}
              y={chartH - marginB + 18}
              textAnchor="middle"
              style={{ fontSize: 10, fill: "#999", fontFamily: FONT }}
            >
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </text>
          );
        })}
      {yLabels.map((label, i) => (
        <text
          key={i}
          x={chartW - marginR + 8}
          y={(chartH - marginB) * (1 - i / (yLabels.length - 1)) + 3}
          textAnchor="start"
          style={{ fontSize: 10, fill: "#999", fontFamily: FONT }}
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
