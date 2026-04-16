"use client";

import type { Account, Holding } from "./types";
import { fmt, fmtPct, fmtQty } from "./helpers";
import { S } from "./styles";

interface Props {
  account: Account;
  holdings: Holding[];
  expanded: boolean;
  totalMV: number;
  totalCB: number;
  totalGL: number;
  onToggle: () => void;
}

export default function PositionRows({
  account,
  holdings,
  expanded,
  totalMV,
  totalCB,
  totalGL,
  onToggle,
}: Props) {
  return (
    <>
      {/* Account header row in positions */}
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td colSpan={11} style={{ ...S.groupHeader, fontSize: 13 }}>
          <span
            style={{
              display: "inline-block",
              width: 14,
              fontSize: 9,
              color: "#666",
              marginRight: 4,
            }}
          >
            {expanded ? "▼" : "▶"}
          </span>
          <span style={{ fontWeight: 600 }}>
            {account.display_name || account.account_number_masked}
          </span>
          <span style={{ marginLeft: 16, fontSize: 12, fontWeight: 400, color: "#888" }}>
            {holdings.length} positions
          </span>
          <span style={{ marginLeft: 16, fontSize: 13, fontWeight: 600 }}>{fmt(totalMV)}</span>
          {totalGL !== 0 && (
            <span
              style={{
                marginLeft: 12,
                fontSize: 13,
                fontWeight: 600,
                ...(totalGL >= 0 ? { color: "#067a46" } : { color: "#d32f2f" }),
              }}
            >
              {fmt(totalGL)}
            </span>
          )}
        </td>
      </tr>

      {/* Holding rows */}
      {expanded &&
        holdings.map((h, idx) => {
          const pctOfAcct = totalMV > 0 && h.market_value ? (h.market_value / totalMV) * 100 : null;
          const gl = h.unrealized_gain_loss;
          const glPct = h.unrealized_gain_loss_pct;
          const rowBg = idx % 2 === 1 ? "#f8f8f8" : "#fff";
          return (
            <tr
              key={h.id}
              style={{ background: rowBg }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#f0f7f2")}
              onMouseOut={(e) => (e.currentTarget.style.background = rowBg)}
            >
              <td style={{ ...S.td, paddingLeft: 28 }}>
                <div style={{ fontWeight: 600, color: "#0d7a3e", fontSize: 13 }}>
                  {h.security?.ticker_symbol || "–"}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#999",
                    marginTop: 1,
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.security?.name || ""}
                </div>
              </td>
              <td style={{ ...S.td, textAlign: "right" }}>{fmtQty(h.quantity)}</td>
              <td style={{ ...S.td, textAlign: "right" }}>{fmt(h.price)}</td>
              <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
              <td style={{ ...S.td, textAlign: "right", fontWeight: 500 }}>
                {fmt(h.market_value)}
              </td>
              <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
              <td style={{ ...S.td, textAlign: "right" }}>{fmt(h.cost_basis)}</td>
              <td
                style={{
                  ...S.td,
                  textAlign: "right",
                  fontWeight: 500,
                  ...(gl != null && gl !== 0
                    ? gl > 0
                      ? { color: "#067a46" }
                      : { color: "#d32f2f" }
                    : {}),
                }}
              >
                {fmt(gl)}
              </td>
              <td
                style={{
                  ...S.td,
                  textAlign: "right",
                  ...(glPct != null && glPct !== 0
                    ? glPct > 0
                      ? { color: "#067a46" }
                      : { color: "#d32f2f" }
                    : {}),
                }}
              >
                {fmtPct(glPct)}
              </td>
              <td style={{ ...S.td, textAlign: "right", color: "#555" }}>
                {pctOfAcct != null ? `${pctOfAcct.toFixed(1)}%` : "–"}
              </td>
              <td style={{ ...S.td, textAlign: "center", color: "#888", fontSize: 12 }}>No</td>
            </tr>
          );
        })}

      {/* Account total row in positions */}
      {expanded && (
        <tr>
          <td style={{ ...S.groupSubtotal, paddingLeft: 28 }}>Account Total</td>
          <td style={S.groupSubtotal}></td>
          <td style={S.groupSubtotal}></td>
          <td style={S.groupSubtotal}></td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>{fmt(totalMV)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#888" }}>–</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>{fmt(totalCB)}</td>
          <td
            style={{
              ...S.groupSubtotal,
              textAlign: "right",
              ...(totalGL >= 0 ? { color: "#067a46" } : { color: "#d32f2f" }),
            }}
          >
            {fmt(totalGL)}
          </td>
          <td
            style={{
              ...S.groupSubtotal,
              textAlign: "right",
              ...(totalGL >= 0 ? { color: "#067a46" } : { color: "#d32f2f" }),
            }}
          >
            {totalCB > 0 ? fmtPct((totalGL / totalCB) * 100) : "–"}
          </td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>100%</td>
          <td style={S.groupSubtotal}></td>
        </tr>
      )}
    </>
  );
}
