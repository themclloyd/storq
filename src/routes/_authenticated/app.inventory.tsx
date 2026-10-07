import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useProducts, useStock, type Product } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, PageHeader } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/inventory")({ component: Inventory });

function Inventory() {
  const { store, money, can } = usePos();
  const products = useProducts();
  const stock = useStock(store?.id);
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [adj, setAdj] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  if (!can("admin", "manager")) return <Empty>Only admins and managers can manage inventory.</Empty>;
  const rows = (products.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku?.includes(q));
  const value = rows.reduce((a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.cost), 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        sub={`${store?.name} · stock value at cost ${money(value)}`}
        actions={<Button variant="accent" onClick={() => setEdit({ active: true, price: 0, cost: 0 })}><HugeiconsIcon icon={PlusSignIcon} /> New item</Button>}
      />
      <Input className="mb-4 max-w-sm bg-card" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length === 0 ? <Empty>No items yet.</Empty> : (
        <div className="pos-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b"><th className="px-5 py-3">Item</th><th>SKU</th><th>Category</th><th className="text-right">Cost</th><th className="text-right">Price</th><th className="text-right">In stock</th><th className="px-5" /></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const s = stock.data?.[p.id] ?? 0;
                return (
                  <tr key={p.id} className={cn(!p.active && "opacity-50")}>
                    <td className="px-5 py-3 font-semibold">{p.name}</td>
                    <td className="text-muted-foreground">{p.sku}</td>
                    <td className="text-muted-foreground">{p.category}</td>
                    <td className="tabular text-right">{money(p.cost)}</td>
                    <td className="tabular text-right font-semibold">{money(p.price)}</td>
                    <td className={cn("tabular text-right font-bold", s <= 0 && "text-destructive")}>{s}</td>
                    <td className="space-x-1 whitespace-nowrap px-5 text-right">
                      <Button size="sm" variant="outline" onClick={() => setAdj(p)}>Stock</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ProductDialog p={edit} currentQty={stock.data?.[edit.id!] ?? 0} onClose={() => setEdit(null)} />}
      {adj && <StockDialog p={adj} onClose={() => setAdj(null)} />}
    </>
  );
}

function ProductDialog({ p, currentQty, onClose }: { p: Partial<Product>; currentQty: number; onClose: () => void }) {
  const { rpc, store, can } = usePos();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: p.name ?? "", sku: p.sku ?? "", category: p.category ?? "", price: String(p.price ?? ""), cost: String(p.cost ?? ""), qty: p.id ? String(currentQty) : "", active: p.active ?? true });
  async function save() {
    try {
      const pid = ((await rpc("save_product", { p_id: p.id ?? null, p_name: f.name, p_sku: f.sku || null, p_category: f.category || null, p_price: Number(f.price || 0), p_cost: Number(f.cost || 0), p_active: f.active })) as string | null) ?? p.id;
      const qty = f.qty === "" ? null : Number(f.qty);
      if (pid && qty !== null && qty !== currentQty && store?.id) {
        await rpc("adjust_stock", { p_store: store.id, p_product: pid, p_delta: qty - currentQty });
      }
      toast.success("Saved"); qc.invalidateQueries(); onClose();
    } catch (e) { toast.error((e as Error).message); }
  }
  const stockEditable = can("admin", "manager") && !!store;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{p.id ? "Edit item" : "New item"}</DialogTitle></DialogHeader>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU / barcode"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          <Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Cost price"><Input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
          <Field label="Selling price"><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        {stockEditable && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantity — {store?.name}</div>
            <div className="flex items-center gap-2">
              <Input className="max-w-32" inputMode="decimal" placeholder={p.id ? String(currentQty) : "0"} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
              <span className="text-xs text-muted-foreground">{p.id ? `currently ${currentQty} in stock — leave blank to keep` : "starting stock for this store"}</span>
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Available for sale</label>
        <Button size="lg" disabled={!f.name} onClick={save}>Save item</Button>
      </DialogContent>
    </Dialog>
  );
}

function StockDialog({ p, onClose }: { p: Product; onClose: () => void }) {
  const { rpc, store } = usePos();
  const qc = useQueryClient();
  const [n, setN] = useState("");
  const [mode, setMode] = useState<"in" | "out">("in");
  async function save() {
    try {
      await rpc("adjust_stock", { p_store: store!.id, p_product: p.id, p_delta: (mode === "in" ? 1 : -1) * Number(n) });
      toast.success("Stock updated"); qc.invalidateQueries(); onClose();
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{p.name} — {store?.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button variant={mode === "in" ? "success" : "outline"} onClick={() => setMode("in")}>Receive stock</Button>
          <Button variant={mode === "out" ? "destructive" : "outline"} onClick={() => setMode("out")}>Remove (damage/loss)</Button>
        </div>
        <Field label="Quantity"><Input inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <Button size="lg" disabled={!Number(n)} onClick={save}>Save</Button>
      </DialogContent>
    </Dialog>
  );
}
