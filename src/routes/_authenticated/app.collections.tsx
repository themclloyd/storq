import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, Share01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { useCollections, shareUrl, type Collection } from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, PageHeader } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/collections")({ component: Collections });

function Collections() {
  const { can } = usePos();
  const cols = useCollections();
  const [edit, setEdit] = useState<Partial<Collection> | null>(null);
  if (!can("admin", "manager")) return <Empty>Only admins and managers can manage collections.</Empty>;
  const list = cols.data?.list ?? [];
  const count = (id: string) => Object.values(cols.data?.byProduct ?? {}).filter((ids) => ids.includes(id)).length;

  async function share(c: Collection) {
    const url = shareUrl(c.share_slug);
    try {
      if (navigator.share) await navigator.share({ title: c.name, url });
      else { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  }

  return (
    <>
      <PageHeader
        title="Collections"
        sub="Group items, share them with customers and run discounts on a whole collection."
        actions={<Button variant="accent" onClick={() => setEdit({ discount_pct: 0, is_shared: true })}><HugeiconsIcon icon={PlusSignIcon} /> New collection</Button>}
      />
      {list.length === 0 ? <Empty>No collections yet.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <div key={c.id} className="pos-card flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{count(c.id)} items</div>
                </div>
                {c.discount_pct > 0 && <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground">−{c.discount_pct}%</span>}
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEdit(c)}>Edit</Button>
                <Button size="sm" variant="ghost" disabled={!c.is_shared} onClick={() => share(c)}><HugeiconsIcon icon={Share01Icon} /> {c.is_shared ? "Share" : "Not shared"}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <CollectionDialog c={edit} members={Object.entries(cols.data?.byProduct ?? {}).filter(([, ids]) => edit.id && ids.includes(edit.id)).map(([pid]) => pid)} onClose={() => setEdit(null)} />}
    </>
  );
}

function CollectionDialog({ c, members, onClose }: { c: Partial<Collection>; members: string[]; onClose: () => void }) {
  const { rpc, money } = usePos();
  const qc = useQueryClient();
  const products = useProducts();
  const [f, setF] = useState({ name: c.name ?? "", discount: String(c.discount_pct ?? 0), shared: c.is_shared ?? true });
  const [sel, setSel] = useState<Set<string>>(new Set(members));
  const [q, setQ] = useState("");
  const rows = (products.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  async function save() {
    try {
      const id = (await rpc<string>("save_collection", { p_id: c.id ?? null, p_name: f.name, p_discount: Number(f.discount || 0), p_shared: f.shared })) ?? c.id;
      await rpc("set_collection_products", { p_collection: id, p_products: [...sel] });
      toast.success("Collection saved"); qc.invalidateQueries(); onClose();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function remove() {
    if (!c.id || !confirm("Delete this collection? Items stay in inventory.")) return;
    try { await rpc("delete_collection", { p_id: c.id }); qc.invalidateQueries(); onClose(); } catch (e) { toast.error((e as Error).message); }
  }
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{c.id ? "Edit collection" : "New collection"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Discount %"><Input inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">The discount applies to every item in this collection at checkout. If an item is in several collections, the biggest discount is used.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} /> Anyone with the link can view this collection</label>
        <div className="rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b p-2">
            <Input className="h-8" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="whitespace-nowrap text-xs text-muted-foreground">{sel.size} selected</span>
          </div>
          <div className="max-h-64 divide-y overflow-y-auto">
            {rows.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="tabular text-muted-foreground">{money(p.price)}</span>
              </label>
            ))}
            {rows.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">No items.</p>}
          </div>
        </div>
        <div className="flex gap-2">
          {c.id && <Button variant="ghost" onClick={remove}><HugeiconsIcon icon={Delete02Icon} /> Delete</Button>}
          <Button size="lg" className="flex-1" disabled={!f.name} onClick={save}>Save collection</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
