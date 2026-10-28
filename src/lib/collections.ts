import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import type { Product } from "@/lib/products";

export type Collection = {
  id: string;
  name: string;
  discount_pct: number;
  is_shared: boolean;
};
export type CollectionData = { list: Collection[]; byProduct: Record<string, string[]> };

export function useCollections() {
  const { business } = usePos();
  return useQuery({
    queryKey: ["collections", business?.id],
    // Membership edits go through the collection screens, which invalidate
    // explicitly; a long staleTime keeps till pricing stable between edits.
    staleTime: 300_000,
    queryFn: async (): Promise<CollectionData> => {
      const [c, pc] = await Promise.all([
        supabase.from("collections").select("id,name,discount_pct,is_shared").order("name"),
        supabase.from("product_collections").select("collection_id,product_id"),
      ]);
      if (c.error) throw c.error;
      if (pc.error) throw pc.error;
      const byProduct: Record<string, string[]> = {};
      for (const r of pc.data ?? []) (byProduct[r.product_id] ??= []).push(r.collection_id);
      return {
        list: (c.data ?? []).map((x) => ({ ...x, discount_pct: Number(x.discount_pct) })),
        byProduct,
      };
    },
  });
}

/**
 * The register's chips: collection names and their discount, and nothing else.
 * A business may hold thousands of item memberships, so the till never reads
 * `product_collections` wholesale, it asks for the ids on screen
 * (`useTillMemberships`) and prices from there.
 */
export function useTillCollections() {
  const { business } = usePos();
  return useQuery({
    // Nested under `collections` so saving a collection refreshes the chips.
    queryKey: ["collections", "till", business?.id],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("id,name,discount_pct,is_shared")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((c) => ({
        ...c,
        discount_pct: Number(c.discount_pct),
      })) as Collection[];
    },
  });
}

/**
 * Which collections the items a till is showing belong to. One bounded read per
 * page (plus the basket), so a discounted tile is priced without the device
 * ever holding the tenant's membership table.
 */
export function useTillMemberships(ids: string[]) {
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  return useQuery({
    queryKey: ["collections", "members", key],
    enabled: !!key,
    staleTime: 300_000,
    // Keep the last map while the next page loads: a price must not blink to
    // the undiscounted figure and back.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const values = key.split(",");
      const byProduct: Record<string, string[]> = {};
      // A long basket would overflow the URL in one `in.(...)` list.
      for (let i = 0; i < values.length; i += 100) {
        const { data, error } = await supabase
          .from("product_collections")
          .select("collection_id,product_id")
          .in("product_id", values.slice(i, i + 100));
        if (error) throw error;
        for (const row of data ?? []) (byProduct[row.product_id] ??= []).push(row.collection_id);
      }
      return byProduct;
    },
  });
}

/** Mirrors the server: biggest discount among the product's collections wins. */
export function discountFor(p: Product, data?: CollectionData) {
  if (!data) return 0;
  const ids = data.byProduct[p.id] ?? [];
  return Math.min(
    100,
    Math.max(0, ...data.list.filter((c) => ids.includes(c.id)).map((c) => c.discount_pct)),
  );
}
export function salePrice(p: Product, data?: CollectionData) {
  return Math.round(Number(p.price) * (1 - discountFor(p, data) / 100) * 100) / 100;
}
