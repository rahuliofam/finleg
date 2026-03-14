export type IntranetSection =
  | "devices"
  | "residents"
  | "associates"
  | "staff"
  | "admin";

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
  { key: "devices", label: "Devices" },
  { key: "residents", label: "Residents" },
  { key: "associates", label: "Associates" },
  { key: "staff", label: "Staff" },
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
    { key: "users", label: "Users", defaultVisible: true },
    { key: "passwords", label: "Passwords", defaultVisible: false },
    { key: "settings", label: "Settings", defaultVisible: false },
    { key: "releases", label: "Releases", defaultVisible: true },
    { key: "templates", label: "Templates", defaultVisible: false },
    { key: "brand", label: "Brand", defaultVisible: true },
    { key: "accounting", label: "Accounting", defaultVisible: false },
    { key: "life-of-pai", label: "Life of PAI", defaultVisible: false },
  ],
};

export const ALL_TAB_SLUGS: Record<IntranetSection, string[]> = {
  devices: DEFAULT_TABS.devices.map((t) => t.key),
  residents: DEFAULT_TABS.residents.map((t) => t.key),
  associates: DEFAULT_TABS.associates.map((t) => t.key),
  staff: DEFAULT_TABS.staff.map((t) => t.key),
  admin: DEFAULT_TABS.admin.map((t) => t.key),
};
