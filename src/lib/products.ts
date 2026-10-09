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
};

export function useProducts() {
  const { business } = usePos();
  return useQuery({
    queryKey: ["products", business?.id],
    // The catalog only changes through the inventory screens, which
    // invalidate explicitly — no need to re-pull it on every mount.
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      // Generated types haven't caught up with the new gated cost table.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const costRes = await (supabase.from as any)("product_costs").select("product_id,cost");
      const costs = new Map<string, number>(
        ((costRes.data ?? []) as { product_id: string; cost: string | number }[]).map((c) => [
          c.product_id,
          Number(c.cost),
        ]),
      );
      return (data as unknown as Omit<Product, "cost">[]).map((p) => ({
        ...p,
        cost: costs.get(p.id) ?? 0,
      }));
    },
  });
}
export function useStock(storeId?: string) {
  return useQuery({
    queryKey: ["stock", storeId],
    enabled: !!storeId,
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
