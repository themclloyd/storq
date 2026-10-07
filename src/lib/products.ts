import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";

export type Product = { id: string; name: string; sku: string | null; category: string | null; price: number; cost: number; active: boolean };
export function useProducts() {
  const { business } = usePos();
  return useQuery({
    queryKey: ["products", business?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data as unknown as Product[];
    },
  });
}
export function useStock(storeId?: string) {
  return useQuery({
    queryKey: ["stock", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const { data, error } = await supabase.from("store_stock").select("product_id,qty").eq("store_id", storeId!);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.product_id, Number(r.qty)])) as Record<string, number>;
    },
  });
}

