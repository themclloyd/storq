// Stock transfers + low-stock reads. Tables are SELECT-only under RLS
// (managers/admins); every write goes through the require_staff RPCs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";

export type TransferLine = {
  id: string;
  product_id: string;
  name: string;
  qty: number;
};
export type Transfer = {
  id: string;
  number: number;
  status: "in_transit" | "received" | "cancelled";
  note: string | null;
  created_at: string;
  received_at: string | null;
  created_by: string | null;
  received_by: string | null;
  from_store: string;
  to_store: string;
  stock_transfer_lines: TransferLine[];
};

export const TRANSFER_STATUS_LABELS: Record<Transfer["status"], string> = {
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export type LowStockRow = {
  product_id: string;
  name: string;
  sku: string | null;
  qty: number;
  reorder_point: number;
  shortfall: number;
};

type TransferLineRaw = {
  id: string;
  product_id: string;
  qty: string | number;
  products: { name: string } | null;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

/** Transfers touching either side of the given store, newest first. */
export function useTransfers(storeId?: string) {
  return useQuery({
    queryKey: ["transfers", storeId],
    enabled: !!storeId,
    staleTime: 30_000,
    queryFn: async () => {
      // the new transfer tables predate type regeneration — read via any-cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("stock_transfers")
        .select(
          "id,number,status,note,created_at,received_at,created_by,received_by,from_store,to_store,stock_transfer_lines(id,product_id,qty,products(name))",
        )
        .or(`from_store.eq.${storeId},to_store.eq.${storeId}`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as Raw[]).map((r) => ({
        id: r["id"],
        number: r["number"],
        status: r["status"],
        note: r["note"],
        created_at: r["created_at"],
        received_at: r["received_at"],
        created_by: r["created_by"],
        received_by: r["received_by"],
        from_store: r["from_store"],
        to_store: r["to_store"],
        stock_transfer_lines: (
          (r["stock_transfer_lines"] ?? []) as unknown as TransferLineRaw[]
        ).map((l) => ({
          id: l.id,
          product_id: l.product_id,
          name: l.products?.name ?? "Item",
          qty: Number(l.qty),
        })),
      })) as Transfer[];
    },
  });
}

/** Products at or below their reorder point for one store, worst first. */
export function useLowStock(storeId?: string) {
  const { rpc } = usePos();
  return useQuery({
    queryKey: ["low-stock", storeId],
    enabled: !!storeId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!storeId) return [] as LowStockRow[];
      const r = await rpc<unknown>("low_stock", { p_store: storeId });
      return (Array.isArray(r) ? r : []).map((v) => {
        const x = v as Record<string, unknown>;
        return {
          product_id: String(x["product_id"]),
          name: String(x["name"] ?? ""),
          sku: x["sku"] == null ? null : String(x["sku"]),
          qty: Number(x["qty"] ?? 0),
          reorder_point: Number(x["reorder_point"] ?? 0),
          shortfall: Number(x["shortfall"] ?? 0),
        };
      });
    },
  });
}

/** Dispatch/receive/cancel via RPC; one mutation so busy state is shared. */
export function useTransferMutations(onDone?: () => void) {
  const { rpc } = usePos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      action: "create_transfer" | "receive_transfer" | "cancel_transfer";
      args: Record<string, unknown>;
    }) => rpc(vars.action, vars.args),
    onSuccess: () => {
      // a moved unit changes the ledger, the stock map and reorder alerts
      for (const queryKey of [
        ["transfers"],
        ["stock"],
        ["low-stock"],
        ["dash-alerts"],
        ["movements"],
      ])
        void qc.invalidateQueries({ queryKey });
      onDone?.();
    },
  });
}
