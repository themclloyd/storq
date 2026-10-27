import { beforeEach, describe, expect, it } from "vitest";
import { RECENT_MAX, loadRecent, rememberRecent } from "@/lib/recent-items";
import type { Product } from "@/lib/products";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Sugar 1kg",
  sku: "SUG-1",
  category: "grocery",
  price: 10,
  cost: 6,
  active: true,
  reorder_point: null,
  ...over,
});

beforeEach(() => localStorage.clear());

describe("till recent items", () => {
  it("keeps the newest item first", () => {
    rememberRecent("u1", product({ id: "a", name: "A" }));
    rememberRecent("u1", product({ id: "b", name: "B" }));
    expect(loadRecent("u1").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("moves a repeated item back to the front instead of duplicating it", () => {
    rememberRecent("u1", product({ id: "a" }));
    rememberRecent("u1", product({ id: "b" }));
    rememberRecent("u1", product({ id: "a" }));
    expect(loadRecent("u1").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("caps the list so a device never grows a catalogue of its own", () => {
    for (let i = 0; i < RECENT_MAX + 5; i++) rememberRecent("u1", product({ id: `p${i}` }));
    expect(loadRecent("u1")).toHaveLength(RECENT_MAX);
    expect(loadRecent("u1")[0]?.id).toBe(`p${RECENT_MAX + 4}`);
  });

  it("never writes the buying cost to disk", () => {
    rememberRecent("u1", product());
    expect(localStorage.getItem("storq-recent-u1") ?? "").not.toContain("cost");
    expect(loadRecent("u1")[0]?.cost).toBe(0);
  });

  it("keeps each account's shortcuts separate", () => {
    rememberRecent("u1", product({ id: "a" }));
    expect(loadRecent("u2")).toEqual([]);
  });

  it("survives a corrupt snapshot", () => {
    localStorage.setItem("storq-recent-u1", "{not json");
    expect(loadRecent("u1")).toEqual([]);
  });
});
