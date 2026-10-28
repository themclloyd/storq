/**
 * The inventory table's view — search text, filters, sort, page — as URL state.
 *
 * A page opened from the table and closed again has to put the person back on
 * the rows they were reading: the same filter, the same page. That is why the
 * big catalogues keep a list's state in the address bar, and why every link out
 * of this table carries it here. One module owns the shape so the list, the
 * item pages and the bulk grid cannot drift apart.
 */
export type InventorySort = "name" | "price" | "stock";

export type InventoryView = {
  /** Search text, matched against name, item code and collection names. */
  q: string;
  /** Low-stock rows only. */
  low: boolean;
  /** Collection id, or `all`. */
  col: string;
  sort: InventorySort;
  /**
   * Zero-based, matching `pageSlice`. The URL carries it 1-based (`?page=2` is
   * the second page) because that is the number a person reads; the conversion
   * stays inside this module.
   */
  page: number;
};

export const DEFAULT_VIEW: InventoryView = {
  q: "",
  low: false,
  col: "all",
  sort: "name",
  page: 0,
};

const SORTS: readonly InventorySort[] = ["name", "price", "stock"];

/**
 * Tolerant read: a hand-typed, truncated or stale URL falls back to the default
 * instead of throwing on a screen that must open.
 */
export function parseView(search: Record<string, unknown>): InventoryView {
  const sort = SORTS.find((s) => s === search["sort"]);
  const col = search["col"];
  const page = Number(search["page"]);
  return {
    q: typeof search["q"] === "string" ? search["q"].slice(0, 80) : DEFAULT_VIEW.q,
    low: search["low"] === "1" || search["low"] === true || search["low"] === 1,
    col: typeof col === "string" && col ? col : DEFAULT_VIEW.col,
    sort: sort ?? DEFAULT_VIEW.sort,
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
  };
}

/**
 * The same view as search params. Defaults are left out, so a plain visit stays
 * a clean `/app/inventory` and a returned-to link only carries what actually
 * narrowed the list.
 *
 * Typed as a partial view, not a loose record: a route declares this shape for
 * its `validateSearch`, which is what makes `navigate({ to: "/app/inventory" })`
 * legal without spelling out every filter.
 */
export function viewSearch(view: InventoryView): Partial<InventoryView> {
  const out: Partial<InventoryView> = {};
  const q = view.q.trim();
  if (q) out.q = q;
  if (view.low) out.low = true;
  if (view.col !== DEFAULT_VIEW.col) out.col = view.col;
  if (view.sort !== DEFAULT_VIEW.sort) out.sort = view.sort;
  if (view.page > 0) out.page = view.page + 1;
  return out;
}

/** Same params, whatever their key order: what a mirroring effect compares. */
export function sameSearch(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => String(a[k]) === String(b[k]));
}

/**
 * The table's params out of a page's search, leaving that page's own keys
 * (`code`, `ids`, …) behind. Callers memoise on the search object, which the
 * router keeps stable per location — a fresh object would re-fire their effects.
 */
export function viewOnly(search: Record<string, unknown>): Partial<InventoryView> {
  return viewSearch(parseView(search));
}
