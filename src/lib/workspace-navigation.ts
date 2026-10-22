import type { Store } from "@/lib/pos";
import { areaPerms, permits, type Access, type Permission } from "@/lib/permissions";

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
  /**
   * Alternate i18n key used when the selected store is approval-based, so the
   * same URL reads "Invoices" there while direct stores keep "Sales history".
   */
  approvalLabelKey?: string;
  /**
   * Grants that open this page (any one of them). An empty list means every
   * signed-in person; the owner always sees everything.
   */
  perms: Permission[];
  group: WorkspaceGroup;
  approvalOnly?: boolean;
};

/** Mode-aware sidebar/tab label for a page. */
export function pageLabelKey(page: Page, type?: Store["store_type"]) {
  return page.approvalLabelKey && type === "approval" ? page.approvalLabelKey : page.labelKey;
}

const everyone: Permission[] = [];

export const workspacePages: Page[] = [
  {
    to: "/app/dashboard",
    label: "Dashboard",
    labelKey: "nav.dashboard",
    group: "dashboard",
    perms: everyone,
  },
  { to: "/app", label: "POS", labelKey: "nav.pos", group: "register", perms: ["sell"] },
  {
    to: "/app/shifts",
    label: "Cash drawer",
    labelKey: "nav.cashDrawer",
    group: "register",
    perms: ["sell"],
  },
  {
    to: "/app/sales",
    label: "Sales history",
    labelKey: "nav.salesHistory",
    approvalLabelKey: "nav.invoices",
    group: "sales",
    perms: areaPerms("sales"),
  },
  {
    to: "/app/invoices",
    label: "Approvals",
    labelKey: "nav.approvals",
    group: "sales",
    perms: areaPerms("approvals"),
    approvalOnly: true,
  },
  {
    to: "/app/laybys",
    label: "Laybys",
    labelKey: "nav.laybys",
    group: "sales",
    perms: areaPerms("sales"),
  },
  {
    to: "/app/inventory",
    label: "Items",
    labelKey: "nav.items",
    group: "inventory",
    perms: areaPerms("stock"),
  },
  {
    to: "/app/transfers",
    label: "Transfers",
    labelKey: "nav.transfers",
    group: "inventory",
    perms: areaPerms("stock"),
  },
  {
    to: "/app/collections",
    label: "Collections",
    labelKey: "nav.collections",
    group: "inventory",
    perms: areaPerms("stock"),
  },
  {
    to: "/app/stocktake",
    label: "Stock takes",
    labelKey: "nav.stocktakes",
    group: "inventory",
    perms: areaPerms("stock"),
  },
  {
    to: "/app/reports",
    label: "Overview",
    labelKey: "nav.overview",
    group: "finance",
    perms: areaPerms("money"),
  },
  {
    to: "/app/expenses",
    label: "Expenses",
    labelKey: "nav.expenses",
    group: "finance",
    // Tills record what they spend; only money access may delete an entry.
    perms: ["sell", ...areaPerms("money")],
  },
  {
    to: "/app/stores",
    label: "Locations",
    labelKey: "nav.locations",
    group: "settings",
    perms: areaPerms("locations"),
  },
  {
    to: "/app/staff",
    label: "Staff",
    labelKey: "nav.staff",
    group: "settings",
    perms: areaPerms("staff"),
  },
  {
    to: "/app/billing",
    label: "Subscription",
    labelKey: "nav.subscription",
    group: "settings",
    perms: areaPerms("money"),
  },
];

export function visibleWorkspacePages(
  access: Access | null | undefined,
  type?: Store["store_type"],
) {
  return workspacePages.filter(
    (page) => permits(access, page.perms) && (!page.approvalOnly || type === "approval"),
  );
}

/**
 * Groups whose sibling pages are reached from each page's own actions menu
 * instead of the shell tab row, so the workspace keeps one compact switcher.
 */
export const menuNavigationGroups: WorkspaceGroup[] = ["inventory"];

export function workspacePageAt(path: string) {
  const normalized = path.replace(/\/$/, "");
  return workspacePages.find(
    (page) =>
      normalized === page.to || (page.to !== "/app" && normalized.startsWith(`${page.to}/`)),
  );
}

export function workspaceNavigation(access: Access | null | undefined, type?: Store["store_type"]) {
  const pages = visibleWorkspacePages(access, type);
  // The finance group is named after the screen this person can open.
  const money = permits(access, areaPerms("money"));
  const labels: Record<WorkspaceGroup, string> = {
    dashboard: "Dashboard",
    register: "POS",
    sales: "Sales",
    inventory: "Inventory",
    finance: money ? "Reports" : "Expenses",
    settings: "Settings",
  };
  const labelKeys: Record<WorkspaceGroup, string> = {
    dashboard: "nav.dashboard",
    register: "nav.pos",
    sales: type === "approval" ? "nav.invoices" : "nav.sales",
    inventory: "nav.inventory",
    finance: money ? "nav.reports" : "nav.expenses",
    settings: "nav.settings",
  };
  return (
    ["dashboard", "register", "sales", "inventory", "finance", "settings"] as WorkspaceGroup[]
  ).flatMap((group) => {
    const first = pages.find((page) => page.group === group);
    return first ? [{ group, label: labels[group], labelKey: labelKeys[group], to: first.to }] : [];
  });
}
