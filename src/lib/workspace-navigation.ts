import type { Role, Store } from "@/lib/pos";

export type WorkspacePath =
  | "/app/dashboard"
  | "/app"
  | "/app/sales"
  | "/app/invoices"
  | "/app/laybys"
  | "/app/shifts"
  | "/app/inventory"
  | "/app/transfers"
  | "/app/collections"
  | "/app/stocktake"
  | "/app/reports"
  | "/app/expenses"
  | "/app/stores"
  | "/app/staff"
  | "/app/billing";
export type WorkspaceGroup =
  "dashboard" | "register" | "sales" | "inventory" | "finance" | "settings";
type Page = {
  to: WorkspacePath;
  label: string;
  /** i18n dot-key for `label`; rendered via t(). Kept separate so `label` stays the stable English identity. */
  labelKey: string;
  roles: Role[];
  group: WorkspaceGroup;
  approvalOnly?: boolean;
};
const all: Role[] = ["admin", "manager", "cashier"];
const managers: Role[] = ["admin", "manager"];

export const workspacePages: Page[] = [
  {
    to: "/app/dashboard",
    label: "Dashboard",
    labelKey: "nav.dashboard",
    group: "dashboard",
    roles: all,
  },
  { to: "/app", label: "POS", labelKey: "nav.pos", group: "register", roles: all },
  {
    to: "/app/shifts",
    label: "Cash drawer",
    labelKey: "nav.cashDrawer",
    group: "register",
    roles: all,
  },
  {
    to: "/app/sales",
    label: "Sales history",
    labelKey: "nav.salesHistory",
    group: "sales",
    roles: all,
  },
  {
    to: "/app/invoices",
    label: "Approvals",
    labelKey: "nav.approvals",
    group: "sales",
    roles: all,
    approvalOnly: true,
  },
  { to: "/app/laybys", label: "Laybys", labelKey: "nav.laybys", group: "sales", roles: all },
  {
    to: "/app/inventory",
    label: "Items",
    labelKey: "nav.items",
    group: "inventory",
    roles: managers,
  },
  {
    to: "/app/transfers",
    label: "Transfers",
    labelKey: "nav.transfers",
    group: "inventory",
    roles: managers,
  },
  {
    to: "/app/collections",
    label: "Collections",
    labelKey: "nav.collections",
    group: "inventory",
    roles: managers,
  },
  {
    to: "/app/stocktake",
    label: "Stock takes",
    labelKey: "nav.stocktakes",
    group: "inventory",
    roles: all,
  },
  {
    to: "/app/reports",
    label: "Overview",
    labelKey: "nav.overview",
    group: "finance",
    roles: managers,
  },
  {
    to: "/app/expenses",
    label: "Expenses",
    labelKey: "nav.expenses",
    group: "finance",
    roles: all,
  },
  {
    to: "/app/stores",
    label: "Locations",
    labelKey: "nav.locations",
    group: "settings",
    roles: ["admin"],
  },
  { to: "/app/staff", label: "Staff", labelKey: "nav.staff", group: "settings", roles: ["admin"] },
  {
    to: "/app/billing",
    label: "Subscription",
    labelKey: "nav.subscription",
    group: "settings",
    roles: managers,
  },
];

export function visibleWorkspacePages(role: Role, type?: Store["store_type"]) {
  return workspacePages.filter(
    (page) => page.roles.includes(role) && (!page.approvalOnly || type === "approval"),
  );
}

export function workspacePageAt(path: string) {
  const normalized = path.replace(/\/$/, "");
  return workspacePages.find(
    (page) =>
      normalized === page.to || (page.to !== "/app" && normalized.startsWith(`${page.to}/`)),
  );
}

export function workspaceNavigation(role: Role, type?: Store["store_type"]) {
  const pages = visibleWorkspacePages(role, type);
  const labels: Record<WorkspaceGroup, string> = {
    dashboard: "Dashboard",
    register: "POS",
    sales: "Sales",
    inventory: "Inventory",
    finance: role === "cashier" ? "Expenses" : "Reports",
    settings: "Settings",
  };
  const labelKeys: Record<WorkspaceGroup, string> = {
    dashboard: "nav.dashboard",
    register: "nav.pos",
    sales: "nav.sales",
    inventory: "nav.inventory",
    finance: role === "cashier" ? "nav.expenses" : "nav.reports",
    settings: "nav.settings",
  };
  return (
    ["dashboard", "register", "sales", "inventory", "finance", "settings"] as WorkspaceGroup[]
  ).flatMap((group) => {
    const first = pages.find((page) => page.group === group);
    return first ? [{ group, label: labels[group], labelKey: labelKeys[group], to: first.to }] : [];
  });
}
