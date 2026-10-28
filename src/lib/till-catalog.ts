import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCode } from "@/lib/item-codes";
import type { Product } from "@/lib/products";

/**
 * The register never downloads the catalogue.
 *
 * A counter does not browse an e-commerce catalogue: a cashier scans a code,
 * types a few letters, or opens a collection, and only ever looks at the
 * handful of items in front of the customer. Handing every till the whole
 * price list on boot, and again on every catalogue edit, turns one shop into
 * thousands of rows per device for items nobody asked for, which is the read
 * pattern this module exists to stop. Every path here is one bounded query:
 * at most a page of tiles, or exactly one item for a scanned code.
 */
export const TILL_SEARCH_LIMIT = 24;
export const TILL_BROWSE_LIMIT = 48;

/** The columns a tile needs. Buying cost is never part of a till read. */
const TILL_COLUMNS = "id,name,sku,category,price,active,reorder_point";
/**
 * A page carries its own collection membership so a discounted tile is priced
 * the moment it renders, instead of showing the full price until a second
 * query lands.
 */
const TILL_SELECT = `${TILL_COLUMNS},product_collections(collection_id)`;

type Row = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  price: number | string;
  active: boolean;
  reorder_point: number | null;
  product_collections?: { collection_id: string }[] | null;
};

export type TillPage = {
  items: Product[];
  /** product id → the collections it belongs to, for this page only. */
  byProduct: Record<string, string[]>;
};

const asProduct = (row: Omit<Row, "product_collections">): Product => ({
  id: row.id,
  name: row.name,
  sku: row.sku,
  category: row.category,
  price: Number(row.price),
  cost: 0,
  active: row.active,
  reorder_point: row.reorder_point,
});

function toPage(rows: Row[] | null | undefined): TillPage {
  const page: TillPage = { items: [], byProduct: {} };
  for (const row of rows ?? []) {
    const { product_collections: links, ...rest } = row;
    page.items.push(asProduct(rest));
    const ids = (links ?? []).map((l) => l.collection_id);
    if (ids.length) page.byProduct[row.id] = ids;
  }
  return page;
}

/**
 * PostgREST reads `,` `(` `)` and quotes as filter syntax, so a term typed into
 * the search box must never smuggle them into an `or=(...)` list. Everything
 * else a cashier types is kept as-is.
 */
export function tillSearchTerm(raw: string): string {
  return raw
    .replace(/[(),"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** `%` and `_` typed by a cashier are literal text, never wildcards. */
export function likePattern(term: string): string {
  return `%${term.replace(/([\\%_])/g, "\\$1")}%`;
}

/**
 * A code keeps its single spaces flexible: a label printed as "ABC 123" still
 * resolves when the same code is typed with a double space. The caller only
 * trusts this pattern once both sides are normalized and compared exactly.
 */
export function codePattern(code: string): string {
  return normalizeCode(code)
    .replace(/([\\%_])/g, "\\$1")
    .replace(/ /g, "%");
}

async function searchProducts(
  storeId: string,
  term: string,
  signal: AbortSignal,
): Promise<TillPage> {
  const pattern = likePattern(term);
  const { data, error } = await supabase
    .from("products")
    .select(TILL_SELECT)
    .eq("store_id", storeId)
    .eq("active", true)
    .or(`name.ilike.${pattern},sku.ilike.${pattern}`)
    .order("name")
    .limit(TILL_SEARCH_LIMIT)
    .abortSignal(signal);
  if (error) throw error;
  const page = toPage(data as unknown as Row[]);
  // A code typed in full outranks a name that merely contains those letters.
  const code = normalizeCode(term).toLowerCase();
  const exact = (p: Product) => (p.sku && normalizeCode(p.sku).toLowerCase() === code ? 0 : 1);
  page.items.sort((a, b) => exact(a) - exact(b));
  return page;
}

async function collectionProducts(
  storeId: string,
  collectionId: string,
  signal: AbortSignal,
): Promise<TillPage> {
  const { data, error } = await supabase
    .from("product_collections")
    .select(`product_id,products!inner(${TILL_COLUMNS})`)
    .eq("collection_id", collectionId)
    .eq("products.store_id", storeId)
    .eq("products.active", true)
    .order("name", { referencedTable: "products" })
    .limit(TILL_BROWSE_LIMIT)
    .abortSignal(signal);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    product_id: string;
    products: Omit<Row, "product_collections">;
  }[];
  const page: TillPage = { items: rows.map((r) => asProduct(r.products)), byProduct: {} };
  const ids = rows.map((r) => r.product_id);
  if (!ids.length) return page;
  // A collection page joined the membership it was opened from; one small read
  // adds the item's other collections so the biggest discount still wins.
  const { data: links, error: linkErr } = await supabase
    .from("product_collections")
    .select("collection_id,product_id")
    .in("product_id", ids)
    .abortSignal(signal);
  if (linkErr) throw linkErr;
  for (const l of links ?? []) (page.byProduct[l.product_id] ??= []).push(l.collection_id);
  return page;
}

async function browseProducts(storeId: string, signal: AbortSignal): Promise<TillPage> {
  const { data, error } = await supabase
    .from("products")
    .select(TILL_SELECT)
    .eq("store_id", storeId)
    .eq("active", true)
    .order("name")
    .limit(TILL_BROWSE_LIMIT)
    .abortSignal(signal);
  if (error) throw error;
  return toPage(data as unknown as Row[]);
}

export type TillFilter = {
  storeId: string | undefined;
  term: string;
  collectionId: string | null;
  browseAll: boolean;
};

/** One page for whatever the cashier is looking at, idle means no read at all. */
export async function fetchTillPage(
  { storeId, term, collectionId, browseAll }: TillFilter & { storeId: string },
  signal: AbortSignal,
): Promise<TillPage> {
  if (term) return searchProducts(storeId, term, signal);
  if (collectionId) return collectionProducts(storeId, collectionId, signal);
  if (browseAll) return browseProducts(storeId, signal);
  return { items: [], byProduct: {} };
}

/**
 * The till's catalogue read. Keyed under `products` so every inventory write
 * that already invalidates the catalogue refreshes the register too.
 */
export function useTillCatalog({ storeId, term, collectionId, browseAll }: TillFilter) {
  const needle = tillSearchTerm(term);
  const idle = !needle && !collectionId && !browseAll;
  return useQuery({
    queryKey: ["products", "till", storeId, needle, collectionId ?? "", browseAll ? "all" : ""],
    enabled: !!storeId && !idle,
    // Tiles must not blink empty between keystrokes: keep the last page on
    // screen while the next one loads.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      fetchTillPage({ storeId: storeId!, term: needle, collectionId, browseAll }, signal),
  });
}

/**
 * Exactly the one item a scanned or typed code names. The until-now cheap path
 * (a page already in memory) is the caller's job; this is the single-row read
 * that replaces keeping the whole catalogue around for scanning.
 */
export async function findProductByCode(storeId: string, code: string): Promise<Product | null> {
  const value = normalizeCode(code);
  if (!value) return null;
  const { data, error } = await supabase
    .from("products")
    .select(TILL_COLUMNS)
    .eq("store_id", storeId)
    .eq("active", true)
    .ilike("sku", codePattern(value))
    .limit(5);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Omit<Row, "product_collections">[];
  // The pattern tolerates a stray double space; the answer must still be one
  // code, not a lookalike, so both sides are normalized before comparing.
  const hit = rows.find((r) => normalizeCode(r.sku).toLowerCase() === value.toLowerCase());
  return hit ? asProduct(hit) : null;
}
