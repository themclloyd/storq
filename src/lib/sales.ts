import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaleRow = {
  id: string; number: number; kind: "sale" | "layby"; status: string; total: number; paid: number; payment_method: string | null;
  customer_name: string | null; customer_phone: string | null; note: string | null; store_id: string; created_at: string;
  tax: number; refunded: number; created_by: string | null; approved_by: string | null; approved_at: string | null;
  sale_items: { id: string; refunded_qty: number; name: string; qty: number; price: number; cost: number; product_id: string | null }[];
};

export function useSales(key: string, filter: { storeId?: string | undefined; statuses?: string[]; since?: string }) {
  return useQuery({
    queryKey: ["sales", key, filter],
    queryFn: async () => {
      let q = supabase.from("sales").select("*, sale_items(id,refunded_qty,name,qty,price,cost,product_id)").order("created_at", { ascending: false }).limit(1000);
      if (filter.storeId) q = q.eq("store_id", filter.storeId);
      if (filter.statuses) q = q.in("status", filter.statuses);
      if (filter.since) q = q.gte("created_at", filter.since);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as SaleRow[];
    },
  });
}

export function useStaffNames() {
  return useQuery({
    queryKey: ["staff-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff").select("id,name");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((s) => [s.id, s.name])) as Record<string, string>;
    },
  });
}
