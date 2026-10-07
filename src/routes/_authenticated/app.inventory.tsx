import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/sales";
import { NativeSelect, fmtDate } from "@/components/pos/bits";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useProducts, useStock, type Product } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, PageHeader } from "@/components/pos/bits";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useCollections } from "@/lib/collections";

export const Route = createFileRoute("/_authenticated/app/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Storq" },
      { name: "description", content: "Manage Storq items, buying costs and store stock." },
      { property: "og:title", content: "Inventory — Storq" },
      { property: "og:description", content: "Manage Storq items, buying costs and store stock." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Inventory,
});

function Inventory() {
  const { store, money, can } = usePos();
  const products = useProducts();
  const stock = useStock(store?.id);
  const cols = useCollections();
  const colName = (pid: string) =>
    (cols.data?.byProduct[pid] ?? [])
      .map((id) => cols.data?.list.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [adj, setAdj] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  if (!can("admin", "manager"))
    return <Empty>Only admins and managers can manage inventory.</Empty>;
  const rows = (products.data ?? []).filter(
    (p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku?.includes(q),
  );
  const value = rows.reduce((a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.cost), 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        sub={`${store?.name} · stock value at cost ${money(value)}`}
        actions={
          <Button variant="accent" onClick={() => setEdit({ active: true, price: 0, cost: 0 })}>
            <HugeiconsIcon icon={PlusSignIcon} /> New item
          </Button>
        }
      />
      <Input
        className="mb-3 max-w-xs bg-card"
        placeholder="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {rows.length === 0 ? (
        <Empty>No items yet.</Empty>
      ) : (
        <div className="pos-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-2 text-[11px] uppercase tracking-wide">
                  Item
                </TableHead>
                <TableHead className="py-2 text-[11px] uppercase tracking-wide">SKU</TableHead>
                <TableHead className="py-2 text-[11px] uppercase tracking-wide">
                  Collections
                </TableHead>
                <TableHead className="py-2 text-right text-[11px] uppercase tracking-wide">
                  Cost
                </TableHead>
                <TableHead className="py-2 text-right text-[11px] uppercase tracking-wide">
                  Price
                </TableHead>
                <TableHead className="py-2 text-right text-[11px] uppercase tracking-wide">
                  In stock
                </TableHead>
                <TableHead className="px-4 py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const s = stock.data?.[p.id] ?? 0;
                return (
                  <TableRow key={p.id} className={cn(!p.active && "opacity-50")}>
                    <TableCell className="px-4 py-2 font-semibold">{p.name}</TableCell>
                    <TableCell className="py-2 text-muted-foreground">{p.sku}</TableCell>
                    <TableCell className="max-w-40 truncate py-2 text-muted-foreground">
                      {colName(p.id)}
                    </TableCell>
                    <TableCell className="tabular py-2 text-right">{money(p.cost)}</TableCell>
                    <TableCell className="tabular py-2 text-right font-semibold">
                      {money(p.price)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular py-2 text-right font-bold",
                        s <= 0 && "text-destructive",
                      )}
                    >
                      {s}
                    </TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap px-4 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setAdj(p)}>
                        Stock
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {edit && (
        <ProductDialog
          p={edit}
          currentQty={stock.data?.[edit.id!] ?? 0}
          onClose={() => setEdit(null)}
        />
      )}
      {adj && <StockDialog p={adj} onClose={() => setAdj(null)} />}
    </>
  );
}

function ProductDialog({
  p,
  currentQty,
  onClose,
}: {
  p: Partial<Product>;
  currentQty: number;
  onClose: () => void;
}) {
  const { rpc, store, can } = usePos();
  const qc = useQueryClient();
  const cols = useCollections();
  const [sel, setSel] = useState<string[] | null>(null);
  const chosen = sel ?? (p.id ? (cols.data?.byProduct[p.id] ?? []) : []);
  const [f, setF] = useState({
    name: p.name ?? "",
    sku: p.sku ?? "",
    category: p.category ?? "",
    price: String(p.price ?? ""),
    cost: String(p.cost ?? ""),
    qty: p.id ? String(currentQty) : "",
    active: p.active ?? true,
  });
  async function save() {
    try {
      const pid =
        ((await rpc("save_product", {
          p_id: p.id ?? null,
          p_name: f.name,
          p_sku: f.sku || null,
          p_category: null,
          p_price: Number(f.price || 0),
          p_cost: Number(f.cost || 0),
          p_active: f.active,
        })) as string | null) ?? p.id;
      if (pid) await rpc("set_product_collections", { p_product: pid, p_collections: chosen });
      const qty = f.qty === "" ? null : Number(f.qty);
      if (pid && qty !== null && qty !== currentQty && store?.id) {
        await rpc("adjust_stock_reason", {
          p_store: store.id,
          p_product: pid,
          p_delta: qty - currentQty,
          p_reason: "correction",
          p_note: "Edited on item",
        });
      }
      toast.success("Saved");
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const stockEditable = can("admin", "manager") && !!store;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p.id ? "Edit item" : "New item"}</DialogTitle>
        </DialogHeader>
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="SKU / barcode">
            <Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
          </Field>
          <Field label="Cost price">
            <Input
              inputMode="decimal"
              value={f.cost}
              onChange={(e) => setF({ ...f, cost: e.target.value })}
            />
          </Field>
          <Field label="Selling price">
            <Input
              inputMode="decimal"
              value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Collections">
          <div className="flex flex-wrap gap-1.5">
            {(cols.data?.list ?? []).map((c) => {
              const on = chosen.includes(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setSel(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id])}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                  )}
                >
                  {c.name}
                  {c.discount_pct > 0 ? ` −${c.discount_pct}%` : ""}
                </button>
              );
            })}
            {(cols.data?.list ?? []).length === 0 && (
              <span className="text-xs text-muted-foreground">
                No collections yet — create them under Collections.
              </span>
            )}
          </div>
        </Field>
        {stockEditable && (
          <div className="rounded-lg border bg-muted/40 p-2.5">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Quantity — {store?.name}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="max-w-32"
                inputMode="decimal"
                placeholder={p.id ? String(currentQty) : "0"}
                value={f.qty}
                onChange={(e) => setF({ ...f, qty: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                {p.id
                  ? `currently ${currentQty} in stock — leave blank to keep`
                  : "starting stock for this store"}
              </span>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={f.active}
            onCheckedChange={(v) => setF({ ...f, active: v === true })}
          />{" "}
          Available for sale
        </label>
        <Button disabled={!f.name} onClick={save}>
          Save item
        </Button>
      </DialogContent>
    </Dialog>
  );
}

const reasons = {
  in: [
    ["supplier_intake", "Delivery from supplier"],
    ["transfer_in", "Transfer from another store"],
    ["correction", "Count correction"],
  ],
  out: [
    ["damage", "Damaged"],
    ["shrinkage", "Lost / stolen"],
    ["return_to_supplier", "Returned to supplier"],
    ["transfer_out", "Transfer to another store"],
    ["correction", "Count correction"],
  ],
} as const;
const reasonText: Record<string, string> = {
  sale: "Sold",
  sale_reversal: "Sale cancelled",
  refund_restock: "Customer return",
  stocktake: "Stock take",
  opening_balance: "Opening balance",
  adjustment: "Adjustment",
  supplier_intake: "Supplier delivery",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  correction: "Correction",
  damage: "Damaged",
  shrinkage: "Lost / stolen",
  return_to_supplier: "Returned to supplier",
};

function StockDialog({ p, onClose }: { p: Product; onClose: () => void }) {
  const { rpc, store } = usePos();
  const qc = useQueryClient();
  const names = useStaffNames();
  const [n, setN] = useState("");
  const [mode, setMode] = useState<"in" | "out">("in");
  const [reason, setReason] = useState<string>("supplier_intake");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"adjust" | "history">("adjust");
  const hist = useQuery({
    queryKey: ["movements", store?.id, p.id],
    enabled: tab === "history" && !!store,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("stock_movements")
        .select("*")
        .eq("store_id", store!.id)
        .eq("product_id", p.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as {
        id: string;
        delta: number;
        balance_after: number;
        reason: string;
        note: string | null;
        staff_id: string | null;
        created_at: string;
      }[];
    },
  });
  async function save() {
    try {
      await rpc("adjust_stock_reason", {
        p_store: store!.id,
        p_product: p.id,
        p_delta: (mode === "in" ? 1 : -1) * Number(n),
        p_reason: reason,
        p_note: note || null,
      });
      toast.success("Stock updated");
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {p.name} — {store?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-secondary p-1">
          {(["adjust", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full py-1.5 text-[13px] font-semibold",
                tab === t && "bg-card shadow-sm",
              )}
            >
              {t === "adjust" ? "Change stock" : "History"}
            </button>
          ))}
        </div>
        {tab === "adjust" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={mode === "in" ? "success" : "outline"}
                onClick={() => {
                  setMode("in");
                  setReason("supplier_intake");
                }}
              >
                Add stock
              </Button>
              <Button
                variant={mode === "out" ? "destructive" : "outline"}
                onClick={() => {
                  setMode("out");
                  setReason("damage");
                }}
              >
                Remove stock
              </Button>
            </div>
            <Field label="Reason">
              <NativeSelect
                value={reason}
                onChange={setReason}
                options={reasons[mode].map(([v, t]) => ({ value: v, label: t }))}
              />
            </Field>
            <Field label="Quantity">
              <Input inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Invoice no., who delivered…"
              />
            </Field>
            <Button disabled={!Number(n)} onClick={save}>
              Save
            </Button>
          </>
        ) : (
          <div className="max-h-80 divide-y overflow-y-auto rounded-lg border text-[13px]">
            {(hist.data ?? []).length === 0 ? (
              <p className="p-3 text-muted-foreground">
                {hist.isLoading ? "Loading…" : "No movements yet."}
              </p>
            ) : (
              hist.data!.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-1.5">
                  <div className="flex-1">
                    <div className="font-semibold">{reasonText[m.reason] ?? m.reason}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(m.created_at)}
                      {m.staff_id && ` · ${names.data?.[m.staff_id] ?? ""}`}
                      {m.note && ` · ${m.note}`}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "tabular font-bold",
                      m.delta < 0 ? "text-destructive" : "text-success",
                    )}
                  >
                    {m.delta > 0 ? "+" : ""}
                    {m.delta}
                  </span>
                  <span className="tabular w-12 text-right text-muted-foreground">
                    {m.balance_after}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
