export interface Statement {
  id: string;
  bucket: string;
  r2_key: string;
  filename: string;
  file_type: string;
  file_size: number;
  category: string;
  account_type: string;
  institution: string;
  account_name: string;
  account_number: string;
  account_holder: string;
  year: number | null;
  month: number | null;
  statement_date: string | null;
  period_start: string | null;
  period_end: string | null;
  is_closed: boolean;
  property: string | null;
}

export interface AccountGroup {
  key: string;
  institution: string;
  accountName: string;
  accountNumber: string;
  accountHolder: string;
  accountType: string;
  isClosed: boolean;
  statements: Statement[];
}

export interface InstitutionGroup {
  institution: string;
  label: string;
  accounts: AccountGroup[];
  totalStatements: number;
}

export type AccountSortField = "name" | "number" | "type" | "holder" | "stmts";
export type SortDir = "asc" | "desc";

export interface ParsedSummary {
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface AppUser {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

export interface ShareModalState {
  statement: Statement;
  shareUrl: string | null;
  shareId: string | null;
  creating: boolean;
  copied: boolean;
  sendMode: boolean;
  sending: boolean;
  sentTo: Set<string>;
}
