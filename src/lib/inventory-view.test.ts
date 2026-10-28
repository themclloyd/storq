import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parseView, sameSearch, viewOnly, viewSearch } from "@/lib/inventory-view";

describe("parseView", () => {
  it("opens on the default view for an empty URL", () => {
    expect(parseView({})).toEqual(DEFAULT_VIEW);
  });

  it("keeps the filters a returned-to link carried", () => {
    expect(parseView({ q: "hood", low: "1", col: "c1", sort: "price", page: "3" })).toEqual({
      q: "hood",
      low: true,
      col: "c1",
      sort: "price",
      page: 2,
    });
  });

  it("reads page 1 as the first page, not the second", () => {
    expect(parseView({ page: "1" }).page).toBe(0);
    expect(parseView({ page: "0" }).page).toBe(0);
    expect(parseView({ page: "-4" }).page).toBe(0);
  });

  it("falls back instead of throwing on a hand-typed URL", () => {
    expect(parseView({ sort: "colour", col: "", page: "two", low: "yes" })).toEqual(DEFAULT_VIEW);
  });

  it("accepts a boolean low flag from a router-parsed value", () => {
    expect(parseView({ low: true }).low).toBe(true);
    expect(parseView({ low: "0" }).low).toBe(false);
  });
});

describe("viewSearch", () => {
  it("stays empty for the default view, so a plain visit has a clean URL", () => {
    expect(viewSearch(DEFAULT_VIEW)).toEqual({});
  });

  it("writes the page a person can read", () => {
    expect(viewSearch({ ...DEFAULT_VIEW, page: 1 })).toEqual({ page: 2 });
  });

  it("drops a search term that is only spaces", () => {
    expect(viewSearch({ ...DEFAULT_VIEW, q: "   " })).toEqual({});
  });

  it("round-trips every field it writes", () => {
    const view = { q: "compression", low: true, col: "c9", sort: "stock" as const, page: 4 };
    expect(parseView(viewSearch(view))).toEqual(view);
  });
});

describe("viewOnly", () => {
  it("drops the keys a page of its own adds", () => {
    expect(viewOnly({ q: "hood", ids: "a,b", code: "1234" })).toEqual({ q: "hood" });
  });

  it("keeps the page the way the address bar spells it", () => {
    expect(viewOnly({ page: "2" })).toEqual({ page: 2 });
    expect(viewOnly({ page: 2 })).toEqual({ page: 2 });
  });

  it("is stable when the router validates its own output again", () => {
    // A route declares this as `validateSearch`, and the router keeps that
    // output in the address bar: a second pass that read page 2 as an index and
    // wrote page 3 made the bar count a page nobody turned.
    const once = viewOnly({ q: "sock", low: "1", sort: "price", page: "2" });
    expect(viewOnly(once as Record<string, unknown>)).toEqual(once);
  });

  it("reads back to the view the table works in", () => {
    const search = viewOnly({ q: "sock", low: "1", sort: "price", page: "2" });
    expect(parseView(search as Record<string, unknown>)).toEqual({
      q: "sock",
      low: true,
      col: "all",
      sort: "price",
      page: 1,
    });
  });
});

describe("sameSearch", () => {
  it("ignores key order, so a mirroring effect settles", () => {
    expect(sameSearch({ q: "hood", page: 2 }, { page: 2, q: "hood" })).toBe(true);
  });

  it("sees a dropped filter as a change", () => {
    expect(sameSearch({ q: "hood" }, {})).toBe(false);
    expect(sameSearch({}, { q: "hood" })).toBe(false);
  });

  it("compares a number to the string the URL carries", () => {
    expect(sameSearch({ page: 2 }, { page: "2" })).toBe(true);
  });
});
