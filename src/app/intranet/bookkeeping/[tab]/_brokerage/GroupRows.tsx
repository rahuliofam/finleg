"use client";

import type { AccountGroup, Holding } from "./types";
import { fmt, typeLabel } from "./helpers";
import { S } from "./styles";

interface Props {
  group: AccountGroup;
  expanded: boolean;
  groupValue: number;
  groupCash: number;
  holdings: Record<string, Holding[]>;
  onToggle: () => void;
}

export default function GroupRows({
  group,
  expanded,
  groupValue,
  groupCash,
  holdings,
  onToggle,
}: Props) {
  return (
    <>
      {/* Group header */}
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td colSpan={7} style={{ ...S.groupHeader, borderLeft: "3px solid #0d7a3e" }}>
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
          {group.name}
        </td>
      </tr>

      {/* Account rows */}
      {expanded &&
        group.accounts.map((acct, idx) => {
          const value = acct.total_value || acct.balance_current || 0;
          const hasHoldings = (holdings[acct.id]?.length || 0) > 0;
          const rowBg = idx % 2 === 1 ? "#f8f8f8" : "#fff";
          return (
            <tr
              key={acct.id}
              style={{ background: rowBg }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#f0f7f2")}
              onMouseOut={(e) => (e.currentTarget.style.background = rowBg)}
            >
              <td style={S.td}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  {acct.connection_type === "api" ? (
                    <span
                      style={{
                        marginTop: 4,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#0d7a3e",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        marginTop: 4,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#ccc",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 400, color: "#1a1a1a" }}>
                      {acct.display_name || acct.account_number_masked}{" "}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 13,
                          height: 13,
                          borderRadius: "50%",
                          background: "#0d7a3e",
                          color: "#fff",
                          fontSize: 8,
                          fontWeight: 700,
                          cursor: "pointer",
                          verticalAlign: "middle",
                        }}
                      >
                        i
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>
                      {acct.account_number_masked}
                      {acct.account_holder ? ` · ${acct.account_holder}` : ""}
                    </div>
                  </div>
                </div>
              </td>
              <td style={{ ...S.td, color: "#555" }}>{typeLabel(acct.account_type)}</td>
              <td style={{ ...S.td, textAlign: "right", color: "#555" }}>
                {acct.cash_balance != null ? fmt(acct.cash_balance) : "–"}
              </td>
              <td
                style={{
                  ...S.td,
                  textAlign: "right",
                  fontWeight: 500,
                  color: "#1a1a1a",
                }}
              >
                {value ? fmt(value) : "–"}
              </td>
              <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
              <td style={{ ...S.td, textAlign: "right", color: "#888" }}>–</td>
              <td style={{ ...S.td, textAlign: "center" }}>
                {hasHoldings && (
                  <span
                    style={{ fontSize: 12, color: "#0d7a3e", fontWeight: 600, cursor: "pointer" }}
                  >
                    More
                  </span>
                )}
              </td>
            </tr>
          );
        })}

      {/* Group subtotal */}
      {expanded && (
        <tr>
          <td style={{ ...S.groupSubtotal, paddingLeft: 28 }} colSpan={2}>
            {group.name} Total
          </td>
          <td style={{ ...S.groupSubtotal, textAlign: "right" }}>{fmt(groupCash)}</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#1a1a1a" }}>
            {fmt(groupValue)}
          </td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#888" }}>–</td>
          <td style={{ ...S.groupSubtotal, textAlign: "right", color: "#888" }}>–</td>
          <td style={S.groupSubtotal}></td>
        </tr>
      )}
    </>
  );
}
