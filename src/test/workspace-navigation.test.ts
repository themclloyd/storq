import { describe, expect, it } from "vitest";
import { visibleWorkspacePages, workspaceNavigation, workspacePageAt } from "@/lib/workspace-navigation";
import type { Role } from "@/lib/pos";

describe("Store-aware workspace navigation", () => {
  it.each(["admin", "manager", "cashier"] as Role[])("hides approvals for %s in direct stores", (role) => {
    expect(visibleWorkspacePages(role, "direct").some((page) => page.to === "/app/invoices")).toBe(false);
    expect(visibleWorkspacePages(role, "approval").some((page) => page.to === "/app/invoices")).toBe(true);
  });

  it.each(["direct", "approval"] as const)("keeps laybys and cash drawer available in %s stores", (type) => {
    const paths = visibleWorkspacePages("cashier", type).map((page) => page.to);
    expect(paths).toContain("/app/laybys");
    expect(paths).toContain("/app/shifts");
  });

  it("reduces the admin sidebar to six destinations", () => {
    expect(workspaceNavigation("admin", "approval").map((item) => item.label)).toEqual(["Dashboard", "POS", "Sales", "Inventory", "Reports", "Settings"]);
  });

  it("groups items, collections and stock takes under Inventory", () => {
    expect(visibleWorkspacePages("admin", "direct").filter((page) => page.group === "inventory").map((page) => page.label)).toEqual(["Items", "Collections", "Stock takes"]);
  });

  it("retains cashier stock-taking access without granting item editing", () => {
    expect(workspaceNavigation("cashier", "approval").find((item) => item.group === "inventory")?.to).toBe("/app/stocktake");
    expect(visibleWorkspacePages("cashier", "approval").filter((page) => page.group === "inventory").map((page) => page.to)).toEqual(["/app/stocktake"]);
  });

  it("preserves manager billing but hides admin-only settings pages", () => {
    expect(visibleWorkspacePages("manager", "direct").filter((page) => page.group === "settings").map((page) => page.to)).toEqual(["/app/billing"]);
  });

  it("keeps cashier expenses accessible without reports or settings", () => {
    const nav = workspaceNavigation("cashier", "direct");
    expect(nav.find((item) => item.group === "finance")?.to).toBe("/app/expenses");
    expect(nav.some((item) => item.group === "settings")).toBe(false);
  });

  it("keeps deep collection pages within Inventory and handles trailing slashes", () => {
    expect(workspacePageAt("/app/collections/example")?.group).toBe("inventory");
    expect(workspacePageAt("/app/collections/")?.to).toBe("/app/collections");
    expect(workspacePageAt("/app/")?.group).toBe("register");
    expect(workspacePageAt("/app/shifts")?.group).toBe("register");
  });
});