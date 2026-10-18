import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCode } from "@/lib/item-codes";
import { usePos } from "@/lib/pos";

// Buying costs live in the gated product_costs table (admin/manager only): a
// cashier's select returns no rows, so cost arrives as 0 and stays invisible.
export type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  cost: number;
  active: boolean;
  reorder_point: number | null;
};

// The till keeps one lean, long-lived catalog in memory (like Square/Shopify's
// local catalog) so scanning and search never wait on the network. Buying
// costs are only pulled by screens that show them (`withCost`). Each store
// owns its own item copies now, so the catalog is scoped to the current store.
export function useProducts(storeId?: string, opts: { withCost?: boolean } = {}) {
  const { can } = usePos();
  const withCost = !!opts.withCost && can("admin", "manager");
  return useQuery({
    queryKey: ["products", storeId, withCost],
    enabled: !!storeId,
    // The catalog only changes through the inventory screens, which
    // invalidate explicitly — no need to re-pull it on every mount.
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,category,price,active,reorder_point")
        .eq("store_id", storeId!)
        .order("name");
      if (error) throw error;
      const base = data as unknown as Omit<Product, "cost">[];
      if (!withCost) return base.map((p) => ({ ...p, cost: 0 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const costRes = await (supabase.from as any)("product_costs").select("product_id,cost");
      const costs = new Map<string, number>(
        ((costRes.data ?? []) as { product_id: string; cost: string | number }[]).map((c) => [
          c.product_id,
          Number(c.cost),
        ]),
      );
      return base.map((p) => ({
        ...p,
        cost: costs.get(p.id) ?? 0,
      }));
    },
  });
}
/**
 * Exact lookup for the one item code (typed SKU, scanner gun, printed QR).
 * Normalized on both sides — trimmed, space-collapsed, case-folded — so a code
 * stored with a stray double space still resolves to exactly one active item.
 * Matched against the already-cached catalog, never a fresh network fetch.
 */
export function findByBarcode(list: Product[], code: string): Product | undefined {
  const c = normalizeCode(code).toLowerCase();
  if (!c) return undefined;
  return list.find((p) => p.active && normalizeCode(p.sku).toLowerCase() === c);
}

// ---- manual discount caps (mirror app.checkout: 10% for cashiers) ----
/** Cashiers may discount up to this share of a line / the cart before a manager PIN is required. */
export const DISCOUNT_CAP_RATIO = 0.1;
/** Two-decimal money rounding, matching the SQL round(x, 2) the server uses. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
/** A single line's discount is past the cashier cap. */
export function lineCapBlocked(lineGross: number, lineDiscount: number): boolean {
  return lineDiscount > round2(lineGross * DISCOUNT_CAP_RATIO);
}
/** The cart-wide discount is past the cashier cap. */
export function cartCapBlocked(gross: number, discountTotal: number): boolean {
  return gross > 0 && discountTotal > round2(gross * DISCOUNT_CAP_RATIO);
}

export function useStock(storeId?: string, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ["stock", storeId],
    enabled: !!storeId,
    // Stock changes only through our own writes, which invalidate ["stock"].
    staleTime: 60_000,
    // `live` is for the till: quantities also move on other tills and through
    // CSV imports, whose invalidation cannot reach this device's cache. Without
    // a gentle re-read the badge keeps advertising units that are already gone
    // and the sale fails on the server. Polling stays off every other screen.
    refetchInterval: opts.live ? 30_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_stock")
        .select("product_id,qty")
        .eq("store_id", storeId!);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.product_id, Number(r.qty)])) as Record<
        string,
        number
      >;
    },
  });
}

// ---- export helpers (lazy — called only on button click) ----

export type ProductExportRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  cost: number;
  active: boolean;
  reorder_point: number | null;
  qty: number; // current stock at the chosen store (or 0 when all-stores)
};

/**
 * Fetches every active + inactive product for `storeId`, joining current stock
 * for that store.  Called only on an Export click — never inside a hook.
 */
export async function fetchProductsForExport(storeId: string): Promise<ProductExportRow[]> {
  const [{ data: prods, error: pe }, costRes, { data: stock, error: se }] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,sku,category,price,active,reorder_point")
      .eq("store_id", storeId)
      .order("name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from as any)("product_costs").select("product_id,cost"),
    supabase
      .from("store_stock")
      .select("product_id,qty")
      .eq("store_id", storeId),
  ]);
  if (pe) throw pe;
  if (se) throw se;
  const costs = new Map<string, number>(
    ((costRes.data ?? []) as { product_id: string; cost: string | number }[]).map((c) => [
      c.product_id,
      Number(c.cost),
    ]),
  );
  const stockMap = new Map<string, number>(
    ((stock ?? []) as { product_id: string; qty: string | number }[]).map((s) => [
      s.product_id,
      Number(s.qty),
    ]),
  );
  return ((prods ?? []) as unknown as Omit<ProductExportRow, "cost" | "qty">[]).map((p) => ({
    ...p,
    cost: costs.get(p.id) ?? 0,
    qty: stockMap.get(p.id) ?? 0,
  }));
}

export type StockMovementExportRow = {
  created_at: string;
  product_id: string;
  product_name: string;
  delta: number;
  balance_after: number;
  reason: string;
  note: string | null;
  ref_id: string | null;
};

/**
 * Fetches the immutable stock movement ledger for a store within the given
 * period.  Admin/manager only — RLS silently returns nothing for cashiers.
 */
export async function fetchMovementsForExport(filter: {
  storeId: string;
  since: string;
}): Promise<StockMovementExportRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from as any)("stock_movements")
    .select(
      "created_at,product_id,products(name),delta,balance_after,reason,note,ref_id",
    )
    .eq("store_id", filter.storeId)
    .gte("created_at", filter.since)
    .order("created_at", { ascending: false })
    .limit(100_000);
  if (error) throw error;
  return ((data ?? []) as {
    created_at: string;
    product_id: string;
    products: { name: string } | null;
    delta: number;
    balance_after: number;
    reason: string;
    note: string | null;
    ref_id: string | null;
  }[]).map((r) => ({
    created_at: r.created_at,
    product_id: r.product_id,
    product_name: r.products?.name ?? "",
    delta: Number(r.delta),
    balance_after: Number(r.balance_after),
    reason: r.reason,
    note: r.note,
    ref_id: r.ref_id,
  }));
}
