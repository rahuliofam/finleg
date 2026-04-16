"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { Account, AccountGroup } from "./types";
import { typeLabel } from "./helpers";
import { FONT, btnStyle } from "./styles";

interface Props {
  accounts: Account[];
  groups: AccountGroup[];
  onClose: () => void;
}

export default function SettingsModal({ accounts, groups, onClose }: Props) {
  const [tab, setTab] = useState<"accounts" | "grouped" | "ungrouped">("grouped");

  const modalBg: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: 80,
    background: "rgba(0,0,0,0.4)",
  };
  const modalBox: CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    width: 480,
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: FONT,
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "16px 20px 0", borderBottom: "1px solid #ddd" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>
            Customize Settings
          </h3>
          <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
            {(["accounts", "grouped", "ungrouped"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "0 0 8px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  borderBottom: tab === t ? "2px solid #0d7a3e" : "2px solid transparent",
                  color: tab === t ? "#0d7a3e" : "#888",
                  fontFamily: FONT,
                }}
              >
                {t === "accounts" ? "Hide Accounts" : t === "grouped" ? "Grouped" : "Ungrouped"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {tab === "grouped" &&
            groups.map((g) => (
              <div key={g.name} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#888",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 6,
                  }}
                >
                  {g.name}
                </div>
                {g.accounts.map((acct) => (
                  <div
                    key={acct.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 3,
                      cursor: "grab",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "")}
                  >
                    <span style={{ color: "#bbb", fontSize: 14 }}>&#9776;</span>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: acct.connection_type === "api" ? "#0d7a3e" : "#ccc",
                      }}
                    />
                    <span style={{ fontSize: 12, color: "#333", flex: 1 }}>
                      {acct.display_name || acct.account_number_masked}
                    </span>
                    <span style={{ fontSize: 10, color: "#999" }}>
                      {typeLabel(acct.account_type)}
                    </span>
                  </div>
                ))}
              </div>
            ))}

          {tab === "accounts" &&
            accounts.map((acct) => (
              <div
                key={acct.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 3,
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                onMouseOut={(e) => (e.currentTarget.style.background = "")}
              >
                <input
                  type="checkbox"
                  defaultChecked
                  style={{ accentColor: "#0d7a3e", width: 14, height: 14 }}
                />
                <span style={{ fontSize: 12, color: "#333", flex: 1 }}>
                  {acct.display_name || acct.account_number_masked}
                </span>
                <span style={{ fontSize: 10, color: "#999" }}>{acct.account_number_masked}</span>
              </div>
            ))}

          {tab === "ungrouped" &&
            accounts.map((acct) => (
              <div
                key={acct.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 3,
                  cursor: "grab",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                onMouseOut={(e) => (e.currentTarget.style.background = "")}
              >
                <span style={{ color: "#bbb", fontSize: 14 }}>&#9776;</span>
                <span style={{ fontSize: 12, color: "#333", flex: 1 }}>
                  {acct.display_name || acct.account_number_masked}
                </span>
                <span style={{ fontSize: 10, color: "#999" }}>
                  {typeLabel(acct.account_type)}
                </span>
              </div>
            ))}

          {/* Add a Group */}
          {tab === "grouped" && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Add a Group
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="Group Name"
                  style={{
                    flex: 1,
                    padding: "5px 8px",
                    fontSize: 12,
                    border: "1px solid #ccc",
                    borderRadius: 3,
                    fontFamily: FONT,
                    outline: "none",
                  }}
                />
                <button
                  style={{ ...btnStyle, background: "#0d7a3e", color: "#fff", border: "none" }}
                >
                  Create Group
                </button>
              </div>
            </div>
          )}

          {/* External accounts */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              External Accounts
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#555" }}
            >
              <input
                type="checkbox"
                defaultChecked
                style={{ accentColor: "#0d7a3e", width: 14, height: 14 }}
              />
              Show &ldquo;Add non-Schwab account&rdquo; row
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #ddd",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button onClick={onClose} style={btnStyle}>
            Cancel
          </button>
          <button
            onClick={onClose}
            style={{ ...btnStyle, background: "#0d7a3e", color: "#fff", border: "none" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
