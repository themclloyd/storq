import { describe, expect, it } from "vitest";
import {
  AREAS,
  AREA_GRANTS,
  areaAccess,
  areaPerms,
  canChange,
  canView,
  expandPermissions,
  permits,
  toPermissions,
} from "@/lib/permissions";

const member = (permissions: string[]) => ({ owner: false, permissions });

describe("staff access model", () => {
  it("opens an area from either box, but only change may act", () => {
    const viewer = member(["view_stock"]);
    expect(canView(viewer, "stock")).toBe(true);
    expect(canChange(viewer, "stock")).toBe(false);
    expect(areaAccess(viewer, "stock")).toEqual({ view: true, change: false });
    expect(areaAccess(member([]), "stock")).toEqual({ view: false, change: false });
  });

  it("treats a change grant as its view grant", () => {
    const keeper = member(["sell"]);
    expect(canView(keeper, "sales")).toBe(true);
    expect(canChange(keeper, "sales")).toBe(true);
    expect(areaAccess(keeper, "sales")).toEqual({ view: true, change: true });
  });

  it("gives the owner everything without listing a single grant", () => {
    const owner = { owner: true, permissions: [] };
    for (const area of AREAS) expect(areaAccess(owner, area)).toEqual({ view: true, change: true });
    expect(permits(owner)).toBe(true);
  });

  it("lets everyone signed in open the pages with no grants", () => {
    expect(permits(member([]), [])).toBe(true);
    expect(permits(null, [])).toBe(false);
  });

  it("mirrors the database when expanding a list", () => {
    // app.expand_perms('{stock}') adds view_stock, exactly as this does.
    expect(expandPermissions(["stock"])).toEqual(["stock", "view_stock"]);
    expect(expandPermissions(["view_stock", "stock"])).toEqual(["stock", "view_stock"]);
    expect(expandPermissions(["sell", "view_money"])).toEqual(["sell", "view_sales", "view_money"]);
  });

  it("matches the database's area table", () => {
    // app.perm_pairs() is the SQL twin; a drift here would let the screen offer
    // a grant the server refuses.
    expect(Object.keys(AREA_GRANTS).sort()).toEqual([...AREAS].sort());
    for (const area of AREAS) expect(areaPerms(area)).toHaveLength(2);
  });

  it("drops unknown keys and orders a stored list canonically", () => {
    expect(toPermissions(["view_stock", "admin", "stock", "sell"])).toEqual([
      "sell",
      "stock",
      "view_stock",
    ]);
    expect(toPermissions("stock")).toEqual([]);
    expect(toPermissions(undefined)).toEqual([]);
  });
});
