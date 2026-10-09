import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
// costs are only pulled by screens that show them (`withCost`).
export function useProducts(opts: { withCost?: boolean } = {}) {
  const { business, can } = usePos();
  const withCost = !!opts.withCost && can("admin", "manager");
  return useQuery({
    queryKey: ["products", business?.id, withCost],
    enabled: !!business?.id,
    // The catalog only changes through the inventory screens, which
    // invalidate explicitly — no need to re-pull it on every mount.
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,category,price,active,reorder_point")
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
 * Exact barcode/SKU lookup for the till scanner. Trimmed, case-insensitive,
 * matched against the already-cached catalog — never a fresh network fetch.
 */
export function findByBarcode(list: Product[], code: string): Product | undefined {
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  return list.find((p) => p.active && p.sku?.trim().toLowerCase() === c);
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

export function useStock(storeId?: string) {
  return useQuery({
    queryKey: ["stock", storeId],
    enabled: !!storeId,
    // Stock changes only through our own writes, which invalidate ["stock"].
    staleTime: 60_000,
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
