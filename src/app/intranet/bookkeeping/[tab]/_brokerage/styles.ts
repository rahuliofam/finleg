import type { CSSProperties } from "react";

export const FONT = 'Arial, Helvetica, sans-serif';

/**
 * Shared inline-style snippets used across Brokerage tables.
 *
 * The brokerage tab intentionally uses inline styles (not Tailwind) to
 * replicate Schwab-exact measurements. Keep this object the single source
 * of truth for anything shared between GroupRows / PositionRows / etc.
 */
export const S = {
  th: {
    padding: "8px 12px",
    fontSize: "11px",
    fontWeight: 600 as const,
    color: "#555",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    borderBottom: "2px solid #ddd",
    fontFamily: FONT,
    lineHeight: "16px",
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 400 as const,
    color: "#333",
    fontFamily: FONT,
    lineHeight: "18px",
    borderBottom: "1px solid #eee",
    verticalAlign: "top" as const,
  },
  groupHeader: {
    padding: "10px 12px",
    fontSize: "14px",
    fontWeight: 700 as const,
    color: "#1a1a1a",
    fontFamily: FONT,
    borderBottom: "1px solid #ddd",
    cursor: "pointer",
    backgroundColor: "#fff",
  },
  groupSubtotal: {
    padding: "8px 12px",
    fontSize: "13px",
    fontWeight: 600 as const,
    color: "#333",
    fontFamily: FONT,
    borderBottom: "2px solid #ddd",
    backgroundColor: "#fafafa",
  },
  footerTotal: {
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 700 as const,
    color: "#1a1a1a",
    fontFamily: FONT,
    borderTop: "2px solid #bbb",
    backgroundColor: "#f5f5f5",
  },
  sectionTitle: {
    fontSize: "20px",
    fontWeight: 700 as const,
    color: "#1a1a1a",
    fontFamily: FONT,
    margin: 0,
    lineHeight: "28px",
  },
  infoText: {
    fontSize: "11px",
    color: "#888",
    fontFamily: FONT,
    lineHeight: "16px",
  },
};

export const btnStyle: CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 3,
  border: "1px solid #ccc",
  background: "#fff",
  color: "#555",
  cursor: "pointer",
  fontFamily: FONT,
};
