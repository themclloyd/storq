import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Delete02Icon, Share01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { useCollections, shareUrl } from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Field, PageHeader } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/collections/$id")({ head: () => ({ meta: [{ title: "Edit collection — Storq" }, { name: "description", content: "Edit collection details, discounts and product membership." }, { property: "og:title", content: "Edit collection — Storq" }, { property: "og:description", content: "Edit collection details, discounts and product membership." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: CollectionPage });

function CollectionPage() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const { can, rpc, money } = usePos();
  const qc = useQueryClient();
  const nav = useNavigate();
  const cols = useCollections();
  const products = useProducts();
  const c = isNew ? undefined : cols.data?.list.find((x) => x.id === id);

  const [f, setF] = useState({ name: "", discount: "0", shared: true });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded || !cols.data) return;
    if (c) {
      setF({ name: c.name, discount: String(c.discount_pct), shared: c.is_shared });
      setSel(new Set(Object.entries(cols.data.byProduct).filter(([, ids]) => ids.includes(c.id)).map(([pid]) => pid)));
    }
    setLoaded(true);
  }, [cols.data, c, loaded]);

  if (!can("admin", "manager")) return <Empty>Only admins and managers can manage collections.</Empty>;
  if (!isNew && cols.data && !c) return <Empty>Collection not found.</Empty>;

  const all = products.data ?? [];
  const inCol = all.filter((p) => sel.has(p.id));
  const available = all.filter((p) => !sel.has(p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  const pct = Number(f.discount || 0);
  const toggle = (pid: string) => setSel((s) => { const n = new Set(s); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });

  async function save() {
    setSaving(true);
    try {
      const newId = (await rpc<string>("save_collection", { p_id: c?.id ?? null, p_name: f.name, p_discount: pct, p_shared: f.shared })) ?? c?.id;
      await rpc("set_collection_products", { p_collection: newId, p_products: [...sel] });
      toast.success("Collection saved");
      await qc.invalidateQueries();
      if (isNew && newId) nav({ to: "/app/collections/$id", params: { id: newId }, replace: true });
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }
  async function remove() {
    if (!c || !confirm("Delete this collection? Items stay in inventory.")) return;
    try { await rpc("delete_collection", { p_id: c.id }); await qc.invalidateQueries(); nav({ to: "/app/collections" }); } catch (e) { toast.error((e as Error).message); }
  }
  async function share() {
    if (!c) return;
    const url = shareUrl(c.share_slug);
    try {
      if (navigator.share) await navigator.share({ title: c.name, url });
      else { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  }

  return (
    <>
      <Link to="/app/collections" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} /> Collections
      </Link>
      <PageHeader
        title={isNew ? "New collection" : f.name || "Collection"}
        sub={`${sel.size} items${pct > 0 ? ` · −${pct}% off` : ""}`}
        actions={
          <div className="flex gap-2">
            {c && c.is_shared && <Button variant="outline" onClick={share}><HugeiconsIcon icon={Share01Icon} /> Share</Button>}
            {c && <Button variant="ghost" onClick={remove}><HugeiconsIcon icon={Delete02Icon} /> Delete</Button>}
            <Button variant="accent" disabled={!f.name || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="pos-card flex flex-col gap-4 self-start p-5">
          <div className="font-bold">Details</div>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Discount %"><Input inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Applies to every item in this collection at checkout. If an item is in several collections, the biggest discount is used.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} /> Anyone with the link can view</label>
        </div>

        <div className="flex flex-col gap-4">
          <div className="pos-card">
            <div className="border-b p-4 font-bold">Items in this collection ({inCol.length})</div>
            <div className="divide-y">
              {inCol.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                  {pct > 0 && <span className="tabular text-muted-foreground line-through">{money(p.price)}</span>}
                  <span className="tabular font-semibold">{money(p.price * (1 - pct / 100))}</span>
                  <Button size="sm" variant="ghost" onClick={() => toggle(p.id)} aria-label="Remove"><HugeiconsIcon icon={Cancel01Icon} size={16} /></Button>
                </div>
              ))}
              {inCol.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No items yet. Add some below.</p>}
            </div>
          </div>

          <div className="pos-card">
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <div className="font-bold">Add items</div>
              <Input className="h-9 max-w-xs" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="max-h-96 divide-y overflow-y-auto">
              {available.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="tabular text-muted-foreground">{money(p.price)}</span>
                  <Button size="sm" variant="outline" onClick={() => toggle(p.id)}>Add</Button>
                </div>
              ))}
              {available.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No more items to add.</p>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Changes are kept when you press Save.</p>
        </div>
      </div>
    </>
  );
}
