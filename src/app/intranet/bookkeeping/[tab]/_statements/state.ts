import type {
  AccountSortField,
  ParsedSummary,
  ShareModalState,
  SortDir,
  Statement,
} from "./types";

/**
 * Consolidated UI state for StatementsTab.
 *
 * Previously ~30 separate useState calls; moved to a reducer so related
 * state transitions live in one place and the component body is readable.
 */
export interface StatementsUIState {
  // Data loading
  statements: Statement[];
  loading: boolean;
  error: string;

  // Filters
  institution: string;
  accountType: string;
  holderFilter: string;
  yearFilter: string;

  // Expansion
  expandedInstitutions: Set<string>;
  expandedAccounts: Set<string>;

  // Detail/share modals
  detailStatement: Statement | null;
  detailShareUrl: string | null;
  detailShareCopied: boolean;

  // Display-name editing
  displayNames: Record<string, string>;
  editingKey: string | null;
  editValue: string;

  // Sorting
  acctSortField: AccountSortField;
  acctSortDir: SortDir;

  // Parsed data
  parsedDocIds: Set<string>;
  parsedDetail: ParsedSummary | null;
  parsedLoading: boolean;

  // Share modal
  shareModal: ShareModalState | null;
}

export const initialStatementsUIState: StatementsUIState = {
  statements: [],
  loading: true,
  error: "",
  institution: "",
  accountType: "",
  holderFilter: "",
  yearFilter: "",
  expandedInstitutions: new Set(),
  expandedAccounts: new Set(),
  detailStatement: null,
  detailShareUrl: null,
  detailShareCopied: false,
  displayNames: {},
  editingKey: null,
  editValue: "",
  acctSortField: "stmts",
  acctSortDir: "desc",
  parsedDocIds: new Set(),
  parsedDetail: null,
  parsedLoading: false,
  shareModal: null,
};

export type StatementsAction =
  // Data loading
  | { type: "fetch/start" }
  | { type: "fetch/success"; statements: Statement[] }
  | { type: "fetch/error"; message: string }

  // Filters
  | { type: "filter/set"; field: "institution" | "accountType" | "holderFilter" | "yearFilter"; value: string }
  | { type: "filter/clear" }

  // Expansion
  | { type: "expand/toggleInstitution"; institution: string }
  | { type: "expand/toggleAccount"; key: string }
  | { type: "expand/all"; institutions: string[]; accounts: string[] }
  | { type: "expand/collapseAll" }

  // Detail modal
  | { type: "detail/open"; statement: Statement }
  | { type: "detail/close" }
  | { type: "detail/setShareUrl"; url: string | null }
  | { type: "detail/setShareCopied"; copied: boolean }

  // Display names
  | { type: "displayNames/set"; map: Record<string, string> }
  | { type: "displayNames/update"; key: string; value: string }
  | { type: "editing/start"; key: string; value: string }
  | { type: "editing/setValue"; value: string }
  | { type: "editing/cancel" }

  // Sort
  | { type: "sort/toggle"; field: AccountSortField }

  // Parsed data
  | { type: "parsed/setIds"; ids: Set<string> }
  | { type: "parsed/loadStart" }
  | { type: "parsed/loadSuccess"; detail: ParsedSummary }
  | { type: "parsed/loadFail" }
  | { type: "parsed/close" }

  // Share modal
  | { type: "share/open"; statement: Statement }
  | { type: "share/close" }
  | { type: "share/patch"; patch: Partial<ShareModalState> }
  | { type: "share/addRecipient"; userId: string }
  | { type: "share/setRecipients"; ids: Set<string> };

export function statementsReducer(
  state: StatementsUIState,
  action: StatementsAction,
): StatementsUIState {
  switch (action.type) {
    case "fetch/start":
      return { ...state, loading: true, error: "" };
    case "fetch/success":
      return { ...state, loading: false, error: "", statements: action.statements };
    case "fetch/error":
      return { ...state, loading: false, error: action.message, statements: [] };

    case "filter/set":
      return { ...state, [action.field]: action.value } as StatementsUIState;
    case "filter/clear":
      return {
        ...state,
        institution: "",
        accountType: "",
        holderFilter: "",
        yearFilter: "",
      };

    case "expand/toggleInstitution": {
      const next = new Set(state.expandedInstitutions);
      if (next.has(action.institution)) next.delete(action.institution);
      else next.add(action.institution);
      return { ...state, expandedInstitutions: next };
    }
    case "expand/toggleAccount": {
      const next = new Set(state.expandedAccounts);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, expandedAccounts: next };
    }
    case "expand/all":
      return {
        ...state,
        expandedInstitutions: new Set(action.institutions),
        expandedAccounts: new Set(action.accounts),
      };
    case "expand/collapseAll":
      return {
        ...state,
        expandedInstitutions: new Set(),
        expandedAccounts: new Set(),
      };

    case "detail/open":
      return { ...state, detailStatement: action.statement, detailShareUrl: null, detailShareCopied: false };
    case "detail/close":
      return { ...state, detailStatement: null };
    case "detail/setShareUrl":
      return { ...state, detailShareUrl: action.url };
    case "detail/setShareCopied":
      return { ...state, detailShareCopied: action.copied };

    case "displayNames/set":
      return { ...state, displayNames: action.map };
    case "displayNames/update":
      return { ...state, displayNames: { ...state.displayNames, [action.key]: action.value } };
    case "editing/start":
      return { ...state, editingKey: action.key, editValue: action.value };
    case "editing/setValue":
      return { ...state, editValue: action.value };
    case "editing/cancel":
      return { ...state, editingKey: null };

    case "sort/toggle": {
      if (state.acctSortField === action.field) {
        return { ...state, acctSortDir: state.acctSortDir === "asc" ? "desc" : "asc" };
      }
      const asc = action.field === "name" || action.field === "type" || action.field === "holder";
      return { ...state, acctSortField: action.field, acctSortDir: asc ? "asc" : "desc" };
    }

    case "parsed/setIds":
      return { ...state, parsedDocIds: action.ids };
    case "parsed/loadStart":
      return { ...state, parsedLoading: true };
    case "parsed/loadSuccess":
      return { ...state, parsedLoading: false, parsedDetail: action.detail };
    case "parsed/loadFail":
      return { ...state, parsedLoading: false };
    case "parsed/close":
      return { ...state, parsedDetail: null };

    case "share/open":
      return {
        ...state,
        shareModal: {
          statement: action.statement,
          shareUrl: null,
          shareId: null,
          creating: true,
          copied: false,
          sendMode: false,
          sending: false,
          sentTo: new Set(),
        },
      };
    case "share/close":
      return { ...state, shareModal: null };
    case "share/patch":
      return {
        ...state,
        shareModal: state.shareModal ? { ...state.shareModal, ...action.patch } : null,
      };
    case "share/addRecipient": {
      if (!state.shareModal) return state;
      const sentTo = new Set(state.shareModal.sentTo);
      sentTo.add(action.userId);
      return { ...state, shareModal: { ...state.shareModal, sentTo, sending: false } };
    }
    case "share/setRecipients":
      return {
        ...state,
        shareModal: state.shareModal ? { ...state.shareModal, sentTo: action.ids } : null,
      };

    default:
      return state;
  }
}
