import type { Role, Store } from "@/lib/pos";

export type WorkspacePath = "/app/dashboard" | "/app" | "/app/sales" | "/app/invoices" | "/app/laybys" | "/app/shifts" | "/app/inventory" | "/app/collections" | "/app/stocktake" | "/app/reports" | "/app/expenses" | "/app/stores" | "/app/staff" | "/app/billing";
export type WorkspaceGroup = "dashboard" | "register" | "sales" | "inventory" | "finance" | "business";
type Page = { to: WorkspacePath; label: string; roles: Role[]; group: WorkspaceGroup; approvalOnly?: boolean };
const all: Role[] = ["admin", "manager", "cashier"];
const managers: Role[] = ["admin", "manager"];

export const workspacePages: Page[] = [
  { to: "/app/dashboard", label: "Dashboard", group: "dashboard", roles: all },
  { to: "/app", label: "Register", group: "register", roles: all },
  { to: "/app/shifts", label: "Cash drawer", group: "register", roles: all },
  { to: "/app/sales", label: "Sales history", group: "sales", roles: all },
  { to: "/app/invoices", label: "Approvals", group: "sales", roles: all, approvalOnly: true },
  { to: "/app/laybys", label: "Laybys", group: "sales", roles: all },
  { to: "/app/inventory", label: "Items", group: "inventory", roles: managers },
  { to: "/app/collections", label: "Collections", group: "inventory", roles: managers },
  { to: "/app/stocktake", label: "Stock takes", group: "inventory", roles: all },
  { to: "/app/reports", label: "Overview", group: "finance", roles: managers },
  { to: "/app/expenses", label: "Expenses", group: "finance", roles: all },
  { to: "/app/stores", label: "Stores", group: "business", roles: ["admin"] },
  { to: "/app/staff", label: "Staff", group: "business", roles: ["admin"] },
  { to: "/app/billing", label: "Subscription", group: "business", roles: managers },
];

export function visibleWorkspacePages(role: Role, type?: Store["store_type"]) {
  return workspacePages.filter((page) => page.roles.includes(role) && (!page.approvalOnly || type === "approval"));
}

export function workspacePageAt(path: string) {
  const normalized = path.replace(/\/$/, "");
  return workspacePages.find((page) => normalized === page.to || (page.to !== "/app" && normalized.startsWith(`${page.to}/`)));
}

export function workspaceNavigation(role: Role, type?: Store["store_type"]) {
  const pages = visibleWorkspacePages(role, type);
  const labels: Record<WorkspaceGroup, string> = { dashboard: "Dashboard", register: "Register", sales: "Sales", inventory: "Inventory", finance: role === "cashier" ? "Expenses" : "Reports", business: "Business" };
  return (["dashboard", "register", "sales", "inventory", "finance", "business"] as WorkspaceGroup[]).flatMap((group) => {
    const first = pages.find((page) => page.group === group);
    return first ? [{ group, label: labels[group], to: first.to }] : [];
  });
}