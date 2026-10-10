import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import type { Product } from "@/lib/products";

export type Collection = {
  id: string;
  name: string;
  discount_pct: number;
  is_shared: boolean;
  share_slug: string;
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
        supabase
          .from("collections")
          .select("id,name,discount_pct,is_shared,share_slug")
          .order("name"),
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
export const shareUrl = (slug: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/c/${slug}`;
