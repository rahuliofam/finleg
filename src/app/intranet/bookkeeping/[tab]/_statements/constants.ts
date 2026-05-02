export const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const INSTITUTIONS = [
  { value: "", label: "All Institutions" },
  { value: "amex", label: "American Express" },
  { value: "chase", label: "Chase" },
  { value: "charles-schwab", label: "Charles Schwab" },
  { value: "us-bank", label: "US Bank" },
  { value: "robinhood", label: "Robinhood" },
  { value: "apple", label: "Apple" },
  { value: "bank-of-america", label: "Bank of America" },
  { value: "pnc", label: "PNC" },
  { value: "coinbase", label: "Coinbase" },
  { value: "venmo", label: "Venmo" },
  { value: "paypal", label: "PayPal" },
  { value: "cash-app", label: "Cash App" },
  { value: "sba", label: "SBA" },
  { value: "various", label: "Various" },
];

export const ACCOUNT_TYPES = [
  { value: "", label: "All Account Types" },
  { value: "credit-card", label: "Credit Cards" },
  { value: "checking", label: "Checking" },
  { value: "payment", label: "Payment (Venmo, PayPal, Cash App)" },
  { value: "brokerage", label: "Brokerage" },
  { value: "ira", label: "IRA" },
  { value: "trust", label: "Trust" },
  { value: "crypto", label: "Crypto" },
  { value: "mortgage", label: "Mortgage" },
  { value: "heloc", label: "HELOC" },
  { value: "credit-line", label: "Credit Line" },
  { value: "auto-loan", label: "Auto Loan" },
  { value: "sba-loan", label: "SBA Loan" },
];

export const HOLDERS = [
  { value: "", label: "All Holders" },
  { value: "Rahul", label: "Rahul" },
  { value: "Subhash", label: "Subhash" },
  { value: "Family", label: "Family" },
  { value: "Trust", label: "Trust" },
  { value: "Tesloop", label: "Tesloop" },
];

export const YEARS = [
  { value: "", label: "All Years" },
  ...Array.from({ length: 8 }, (_, i) => {
    const y = 2026 - i;
    return { value: String(y), label: String(y) };
  }),
];

// Map account_type to summary table name
export const SUMMARY_TABLES: Record<string, string> = {
  "credit-card": "cc_statement_summaries",
  "credit-line": "cc_statement_summaries",
  checking: "checking_statement_summaries",
  payment: "checking_statement_summaries",
  brokerage: "investment_statement_summaries",
  ira: "investment_statement_summaries",
  trust: "investment_statement_summaries",
  crypto: "investment_statement_summaries",
  mortgage: "loan_statement_summaries",
  heloc: "loan_statement_summaries",
  "auto-loan": "loan_statement_summaries",
  "sba-loan": "loan_statement_summaries",
};

export const SUMMARY_TABLE_NAMES = [
  "cc_statement_summaries",
  "checking_statement_summaries",
  "investment_statement_summaries",
  "loan_statement_summaries",
];

export const API_BASE = "https://r2-files.finleg.workers.dev";

export function fileUrl(bucket: string, r2Key: string): string {
  return `${API_BASE}/${bucket}/${r2Key}`;
}

export function institutionLabel(slug: string): string {
  const match = INSTITUTIONS.find((i) => i.value === slug);
  return match ? match.label : slug;
}

export function accountTypeLabel(slug: string): string {
  const labels: Record<string, string> = {
    "credit-card": "Credit Card",
    checking: "Checking",
    payment: "Payment",
    brokerage: "Brokerage",
    ira: "IRA",
    trust: "Trust",
    crypto: "Crypto",
    mortgage: "Mortgage",
    heloc: "HELOC",
    "credit-line": "Credit Line",
    "auto-loan": "Auto Loan",
    "sba-loan": "SBA Loan",
  };
  return labels[slug] || slug;
}

export function institutionLogo(slug: string): string {
  const logos: Record<string, string> = {
    amex: "\ud83d\udfe6",
    chase: "\ud83d\udfe6",
    "charles-schwab": "\ud83d\udfe6",
    "us-bank": "\ud83c\udfe6",
    robinhood: "\ud83d\udfe9",
    apple: "\u2b1b",
    "bank-of-america": "\ud83d\udfe5",
    pnc: "\ud83d\udfe7",
    coinbase: "\ud83d\udfe6",
    venmo: "\ud83d\udfe6",
    paypal: "\ud83d\udfe6",
    "cash-app": "\ud83d\udfe9",
    sba: "\ud83c\udfe6",
  };
  return logos[slug] || "\ud83c\udfe6";
}

export function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export const selectClass =
  "px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm text-slate-700 outline-none focus:border-emerald-600";
