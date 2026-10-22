import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";

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
  // Sale-level discount total. Present on rows read via `select("*")` (sale
  // detail); optional so list/aggregate builders can omit it.
  discount?: number;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  // Populated by the item join whenever `items` is on (the default). List-only
  // and cashier-aggregate callers pass `items: false`, which returns rows
  // without this field; every reader that touches it either always fetches the
  // join or guards against its absence.
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
  filter: {
    storeId?: string | undefined;
    statuses?: string[];
    since?: string;
    // Fetch the nested sale_items join. Defaults on (detail/invoice/layby/report
    // screens show line items); list-only and cashier aggregate views pass false.
    items?: boolean;
  },
) {
  const withItems = filter.items !== false;
  return useQuery({
    queryKey: ["sales", key, filter],
    // Writes go through checkout/refund which invalidate the ["sales"] prefix
    // (SALE_TOUCHED); a short floor stops a nav-away-and-back from re-pulling
    // the whole window while other-device rows stay within one minute stale.
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          withItems
            ? "*, sale_items(id,refunded_qty,name,qty,price,product_id)"
            : "id,number,kind,status,total,paid,payment_method,customer_name,customer_phone,note,store_id,created_at,tax,refunded,created_by,approved_by,approved_at",
        )
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

/**
 * Live "invoices awaiting you" signal shown by the workspace shell. It counts
 * pending approvals for the store selected in the switcher only — the badge
 * belongs to that location and never carries over when you switch stores.
 * Oldest first, so the queue opens on what has waited longest. This is a live
 * surface: it polls while anything is waiting here, and on this device a
 * send/approve/reject refreshes it instantly via the ["pending-approvals"]
 * entry in SALE_TOUCHED.
 */
export function usePendingApprovals() {
  const { store, staff, can } = usePos();
  // Only an approver sitting in an approval-based store has a queue to watch;
  // direct stores and cashiers never poll or badge at all.
  const storeId =
    can("approvals") &&
    store?.store_type === "approval" &&
    (!staff?.store_id || staff.store_id === store.id)
      ? store.id
      : undefined;
  return useQuery({
    queryKey: ["pending-approvals", storeId ?? ""],
    enabled: !!storeId,
    staleTime: 20_000,
    // A 30-second beat is enough for a queue that another till fills; a send
    // or review on this device refreshes the badge immediately (SALE_TOUCHED),
    // so the poll is only the cross-device catch-up.
    refetchInterval: 30_000,
    // A background tab must not keep polling the approval queue — leave the
    // tab and the poll pauses; the badge re-syncs on visibility change.
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const id = storeId as string; // enabled: gates on this being set
      const { data, error } = await supabase
        .from("sales")
        .select("id,store_id,created_at")
        .eq("status", "pending_approval")
        .eq("store_id", id)
        .order("created_at", { ascending: true })
        // The badge caps its read like the dashboard alert does; "99+" is
        // shown when the window is full so the count stays honest.
        .limit(100);
      if (error) throw error;
      return (data ?? []) as { id: string; store_id: string; created_at: string }[];
    },
  });
}

// Sale-item buying costs live in the gated sale_item_costs table (admin/manager
// only). Cashiers simply get an empty map and every cost fallback is 0.
// The key is the sorted-unique set of sale_item ids so a fresh `sales.data`
// array with the same rows still hits the same cache slot; without this the
// report page spawned a new ~10-chunk read every time a `sale_items` join
// arrived in a different order. AbortSignal propagates to PostgREST so a
// filter change mid-flight actually cancels the server read instead of
// finishing the full chunk-set for a stale key.
export function useSaleItemCosts(rows?: SaleRow[]) {
  const ids = useMemo(
    () =>
      Array.from(
        new Set((rows ?? []).flatMap((s) => (s.sale_items ?? []).map((i) => i.id))),
      ).sort(),
    [rows],
  );
  return useQuery({
    queryKey: ["sale-item-costs", ids],
    enabled: ids.length > 0,
    // Cost snapshots are immutable once recorded and the key is invalidated on
    // any sale-touching write, so load once and hold rather than re-pull.
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const CHUNK = 1_000;
      const map: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += CHUNK) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase.from as any)("sale_item_costs")
          .select("sale_item_id,cost")
          .in("sale_item_id", ids.slice(i, i + CHUNK));
        // postgrest-js exposes abortSignal(); guard so an older client
        // degrades to a plain read instead of throwing mid-loop.
        if (typeof q.abortSignal === "function") q = q.abortSignal(signal);
        const { data, error } = await q;
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
    // Tiny id→name dictionary reused by every list screen; only the staff
    // page edits it and it invalidates from there, so never let it go stale.
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff").select("id,name");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((s) => [s.id, s.name])) as Record<string, string>;
    },
  });
}

// The Sales list headline numbers (net revenue, collected, refunds, counts) are
// computed by a single SQL aggregate over the full period, so they stay exact
// even past 1000 sales and never pull rows to total them up in the browser.
export type SalesSummary = {
  revenue: number;
  collected: number;
  transactions: number;
  pending: number;
  refunds: number;
};

export function useSalesSummary(filter: { storeId?: string | undefined; since: string }) {
  const { rpc } = usePos();
  return useQuery({
    queryKey: ["sales-summary", filter],
    // Recomputed server-side on checkout/refund via SALE_TOUCHED; a short floor
    // keeps the cards resident across remounts instead of re-aggregating.
    staleTime: 60_000,
    queryFn: async () => {
      const r = await rpc<Record<string, unknown>>("sales_summary", {
        p_store: filter.storeId ?? null,
        p_from: filter.since,
        p_to: new Date().toISOString(),
      });
      return {
        revenue: Number(r?.["revenue"] ?? 0),
        collected: Number(r?.["collected"] ?? 0),
        transactions: Number(r?.["transactions"] ?? 0),
        pending: Number(r?.["pending"] ?? 0),
        refunds: Number(r?.["refunds"] ?? 0),
      } as SalesSummary;
    },
  });
}

// One page of the sales ledger, read straight from the server with an exact
// total, so the list never loads the whole period just to show 50 rows. Parent
// columns only — the table and pager don't render line items.
const SALE_PAGE_COLUMNS =
  "id,number,kind,status,total,paid,payment_method,customer_name,customer_phone,store_id,created_at,tax,refunded,created_by";

export function useSalesPage(filter: {
  storeId?: string | undefined;
  since: string;
  page: number;
  pageSize: number;
}) {
  return useQuery({
    queryKey: ["sales-page", filter],
    staleTime: 60_000,
    // Keep the previous page on screen while the next one loads to avoid a blank flash.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = (filter.page - 1) * filter.pageSize;
      let q = supabase
        .from("sales")
        .select(SALE_PAGE_COLUMNS, { count: "exact" })
        .gte("created_at", filter.since)
        .order("created_at", { ascending: false })
        .range(from, from + filter.pageSize - 1);
      if (filter.storeId) q = q.eq("store_id", filter.storeId);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as SaleRow[], total: count ?? 0 };
    },
  });
}

// CSV/PDF export is deliberately lazy: it fetches the whole period only when the
// button is clicked (bounded for safety), so ordinary browsing stays light while
// the download still contains every matching sale, not just the loaded page.
export type SaleExportRow = {
  number: number;
  created_at: string;
  store_id: string;
  status: string;
  payment_method: string | null;
  customer_name: string | null;
  total: number;
  tax: number;
  paid: number;
  refunded: number;
  created_by: string | null;
};

export async function fetchSalesForExport(filter: {
  storeId?: string | undefined;
  since: string;
}): Promise<SaleExportRow[]> {
  let q = supabase
    .from("sales")
    .select(
      "number,created_at,store_id,status,payment_method,customer_name,total,tax,paid,refunded,created_by",
    )
    .gte("created_at", filter.since)
    .order("created_at", { ascending: false })
    .limit(50_000);
  if (filter.storeId) q = q.eq("store_id", filter.storeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as SaleExportRow[];
}

// Flat sale-item rows for the line-items CSV sheet.
export type SaleItemExportRow = {
  sale_number: number;
  sale_created_at: string;
  sale_status: string;
  store_id: string;
  product_id: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

/**
 * Fetches sale line items joined to their parent sale for the full-detail CSV.
 * Called only on Export click — never in a hook.
 */
export async function fetchSaleItemsForExport(filter: {
  storeId?: string | undefined;
  since: string;
}): Promise<SaleItemExportRow[]> {
  let q = supabase
    .from("sale_items")
    .select("product_id,name,qty,price,sales!inner(number,created_at,status,store_id)")
    .gte("sales.created_at", filter.since)
    .order("sales.created_at", { ascending: false })
    // Cap kept modest: 50k rows per click is already heavy and matches the
    // sales-parent cap. A manager wanting more should use the paged CSV from
    // the Stores page or an accounting export.
    .limit(50_000);
  if (filter.storeId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = (q as any).eq("sales.store_id", filter.storeId);
  const { data, error } = await q;
  if (error) throw error;
  return (
    (data ?? []) as unknown as {
      product_id: string | null;
      name: string;
      qty: string | number;
      price: string | number;
      sales: { number: number; created_at: string; status: string; store_id: string };
    }[]
  ).map((r) => ({
    sale_number: r.sales.number,
    sale_created_at: r.sales.created_at,
    sale_status: r.sales.status,
    store_id: r.sales.store_id,
    product_id: r.product_id,
    product_name: r.name,
    qty: Number(r.qty),
    unit_price: Number(r.price),
    line_total: Number(r.qty) * Number(r.price),
  }));
}
