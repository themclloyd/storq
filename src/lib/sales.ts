import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaleRow = {
  id: string;
  number: number;
  kind: "sale" | "layby";
  status: string;
  total: number;
  paid: number;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  store_id: string;
  created_at: string;
  tax: number;
  refunded: number;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sale_items: {
    id: string;
    refunded_qty: number;
    name: string;
    qty: number;
    price: number;
    product_id: string | null;
  }[];
};

export function useSales(
  key: string,
  filter: { storeId?: string | undefined; statuses?: string[]; since?: string },
) {
  return useQuery({
    queryKey: ["sales", key, filter],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("*, sale_items(id,refunded_qty,name,qty,price,product_id)")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (filter.storeId) q = q.eq("store_id", filter.storeId);
      if (filter.statuses) q = q.in("status", filter.statuses);
      if (filter.since) q = q.gte("created_at", filter.since);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as SaleRow[];
    },
  });
}

// Sale-item buying costs live in the gated sale_item_costs table (admin/manager
// only). Cashiers simply get an empty map and every cost fallback is 0.
export function useSaleItemCosts(rows?: SaleRow[]) {
  return useQuery({
    queryKey: ["sale-item-costs", (rows ?? []).flatMap((s) => s.sale_items.map((i) => i.id))],
    queryFn: async () => {
      const ids = (rows ?? []).flatMap((s) => s.sale_items.map((i) => i.id));
      if (!ids.length) return {} as Record<string, number>;
      const map: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 500) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from as any)("sale_item_costs")
          .select("sale_item_id,cost")
          .in("sale_item_id", ids.slice(i, i + 500));
        if (error) throw error;
        for (const r of (data ?? []) as { sale_item_id: string; cost: string | number }[])
          map[r.sale_item_id] = Number(r.cost);
      }
      return map;
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
