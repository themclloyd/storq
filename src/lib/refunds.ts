import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RefundRow = {
  id: string;
  number: number;
  sale_id: string;
  store_id: string;
  amount: number;
  cost: number;
  tax: number;
  method: string;
  reason: string | null;
  staff_id: string | null;
  created_at: string;
  refund_items: {
    name: string;
    qty: number;
    amount: number;
    cost: number;
    restock: boolean;
    product_id: string | null;
  }[];
};

export function useRefunds(filter: {
  storeId?: string | undefined;
  since?: string;
  saleId?: string;
}) {
  return useQuery({
    queryKey: ["refunds", filter],
    // Refunds are recorded through the refund flow, which wipes the query
    // cache; a short floor keeps the feed resident across remounts rather than
    // re-reading up to 1000 refund rows (with their items) on every visit.
    staleTime: 60_000,
    queryFn: async () => {
      // refunds/refund_items read via any-cast (tables predate type regeneration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from as any)("refunds")
        .select("*, refund_items(name,qty,amount,cost,restock,product_id)")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (filter.storeId) q = q.eq("store_id", filter.storeId);
      if (filter.since) q = q.gte("created_at", filter.since);
      if (filter.saleId) q = q.eq("sale_id", filter.saleId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RefundRow[];
    },
  });
}

export const REFUNDABLE = ["completed", "layby_completed", "partially_refunded"];
export const COUNTED = ["completed", "layby_completed", "partially_refunded", "refunded"];

// ---- export helper (lazy — called only on button click) ----
export async function fetchRefundsForExport(filter: {
  storeId?: string | undefined;
  since: string;
}): Promise<RefundRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from as any)("refunds")
    .select("*, refund_items(name,qty,amount,cost,restock,product_id)")
    .gte("created_at", filter.since)
    .order("created_at", { ascending: false })
    .limit(50_000);
  if (filter.storeId) q = q.eq("store_id", filter.storeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RefundRow[];
}
