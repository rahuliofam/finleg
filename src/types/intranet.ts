export type IntranetSection =
  | "devices"
  | "residents"
  | "associates"
  | "staff"
  | "admin"
  | "files"
  | "bookkeeping"
  | "zeni"
  | "howto"
  | "devcontrol"
  | "my"
  | "pages";

export interface TabDefinition {
  key: string;
  label: string;
  defaultVisible: boolean;
}

export interface TabConfig {
  tab_key: string;
  tab_label: string;
  is_visible: boolean;
  sort_order: number;
}

export interface SectionDefinition {
  key: IntranetSection;
  label: string;
}

export const SECTIONS: SectionDefinition[] = [
  { key: "files", label: "File Vault" },
  { key: "bookkeeping", label: "Bookkeeping" },
  { key: "associates", label: "Associates" },
  { key: "zeni", label: "Zeni" },
  { key: "howto", label: "How It Works" },
  { key: "devcontrol", label: "DevControl" },
  { key: "pages", label: "Pages" },
  { key: "admin", label: "Admin" },
];

export const DEFAULT_TABS: Record<IntranetSection, TabDefinition[]> = {
  devices: [
    { key: "inventory", label: "Inventory", defaultVisible: true },
    { key: "assignments", label: "Assignments", defaultVisible: true },
    { key: "maintenance", label: "Maintenance", defaultVisible: false },
    { key: "procurement", label: "Procurement", defaultVisible: false },
  ],
  residents: [
    { key: "directory", label: "Directory", defaultVisible: true },
    { key: "rooms", label: "Rooms", defaultVisible: true },
    { key: "check-in-out", label: "Check In/Out", defaultVisible: false },
    { key: "requests", label: "Requests", defaultVisible: false },
  ],
  associates: [
    { key: "directory", label: "Directory", defaultVisible: true },
    { key: "organizations", label: "Organizations", defaultVisible: true },
    { key: "donations", label: "Donations", defaultVisible: false },
    { key: "communications", label: "Communications", defaultVisible: false },
  ],
  staff: [
    { key: "directory", label: "Directory", defaultVisible: true },
    { key: "schedules", label: "Schedules", defaultVisible: true },
    { key: "roles", label: "Roles", defaultVisible: false },
    { key: "attendance", label: "Attendance", defaultVisible: false },
  ],
  admin: [
    { key: "uploads", label: "Uploads", defaultVisible: true },
    { key: "users", label: "Users", defaultVisible: true },
    { key: "passwords", label: "Passwords", defaultVisible: false },
    { key: "settings", label: "Settings", defaultVisible: false },
    { key: "templates", label: "Templates", defaultVisible: false },
    { key: "brand", label: "Brand", defaultVisible: true },
    { key: "accounting", label: "Accounting", defaultVisible: false },
    { key: "life-of-pai", label: "Life of PAI", defaultVisible: false },
  ],
  files: [
    { key: "financial-legal", label: "Financial & Legal", defaultVisible: true },
    { key: "general", label: "General Files", defaultVisible: true },
    { key: "photos", label: "Photos", defaultVisible: true },
  ],
  bookkeeping: [
    { key: "dashboard", label: "Dashboard", defaultVisible: true },
    { key: "ledger-notes", label: "Ledger Notes", defaultVisible: true },
    { key: "statements", label: "Statements", defaultVisible: true },
    { key: "categorize", label: "Categorize", defaultVisible: true },
    { key: "receipts", label: "Receipts", defaultVisible: true },
    { key: "bookkeeper", label: "Bookkeeper Queue", defaultVisible: true },
    { key: "tasks", label: "Tasks", defaultVisible: true },
    { key: "activity", label: "Activity", defaultVisible: true },
    { key: "tax-report", label: "Tax Report", defaultVisible: true },
    { key: "brokerage", label: "Brokerage", defaultVisible: true },
  ],
  zeni: [
    { key: "overview", label: "Overview", defaultVisible: true },
    { key: "reports", label: "Reports", defaultVisible: true },
  ],
  howto: [
    { key: "components", label: "Components", defaultVisible: true },
    { key: "nutsbolts", label: "Nuts & Bolts", defaultVisible: true },
    { key: "autoactions", label: "AutoActions", defaultVisible: true },
    { key: "security", label: "Security", defaultVisible: true },
    { key: "data-pipeline", label: "Data Pipeline", defaultVisible: true },
  ],
  devcontrol: [
    { key: "toc", label: "TOC", defaultVisible: true },
    { key: "releases", label: "Releases", defaultVisible: true },
    { key: "sessions", label: "Sessions", defaultVisible: true },
    { key: "tokens", label: "Tokens & Cost", defaultVisible: true },
    { key: "context", label: "Context Window", defaultVisible: true },
    { key: "backups", label: "Backups", defaultVisible: true },
    { key: "planlist", label: "Planlist", defaultVisible: true },
    { key: "flow-mig", label: "Flow Migration", defaultVisible: true },
  ],
  my: [
    { key: "overview", label: "Overview", defaultVisible: true },
    { key: "tax-forms", label: "Tax Forms", defaultVisible: true },
  ],
  pages: [
    { key: "all", label: "All Pages", defaultVisible: true },
  ],
};

export const ALL_TAB_SLUGS: Record<IntranetSection, string[]> = {
  devices: DEFAULT_TABS.devices.map((t) => t.key),
  residents: DEFAULT_TABS.residents.map((t) => t.key),
  associates: DEFAULT_TABS.associates.map((t) => t.key),
  staff: DEFAULT_TABS.staff.map((t) => t.key),
  admin: DEFAULT_TABS.admin.map((t) => t.key),
  files: DEFAULT_TABS.files.map((t) => t.key),
  bookkeeping: DEFAULT_TABS.bookkeeping.map((t) => t.key),
  zeni: DEFAULT_TABS.zeni.map((t) => t.key),
  howto: DEFAULT_TABS.howto.map((t) => t.key),
  devcontrol: DEFAULT_TABS.devcontrol.map((t) => t.key),
  my: DEFAULT_TABS.my.map((t) => t.key),
  pages: DEFAULT_TABS.pages.map((t) => t.key),
};
