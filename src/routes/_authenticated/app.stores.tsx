import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePos, type Store } from "@/lib/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, PageHeader, StoreTypeTag } from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/app/stores")({ head: () => ({ meta: [{ title: "Stores — Storq" }, { name: "description", content: "Manage your Storq stores and tax settings." }, { property: "og:title", content: "Stores — Storq" }, { property: "og:description", content: "Manage your Storq stores and tax settings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: Stores });

function Stores() {
  const { stores, can, business } = usePos();
  const subscription = useSubscription(business?.id, stores.length);
  const [edit, setEdit] = useState<Partial<Store> | null>(null);
  if (!can("admin")) return <Empty>Only admins can manage stores.</Empty>;
  return (
    <>
      <PageHeader title="Stores" actions={<Button variant="accent" disabled={!subscription.data?.canAddStore} onClick={() => setEdit({ store_type: "direct" })}><HugeiconsIcon icon={PlusSignIcon} /> Add store</Button>} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4 text-sm">
        <p className="text-muted-foreground">{subscription.data?.trial ? "Free trial" : `${stores.length} stores · ${subscription.data?.capacity ?? 0} paid store slots`}</p>
        {!subscription.data?.canAddStore && <Link to="/app/billing" className="font-medium underline">Pay for more stores</Link>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {stores.map((s) => (
          <div key={s.id} className="pos-card flex items-center justify-between p-5">
            <div><div className="font-bold">{s.name}</div><div className="mt-1"><StoreTypeTag type={s.store_type} /></div></div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>Edit</Button>
          </div>
        ))}
      </div>
      <TaxSettings />
      {edit && <StoreDialog s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const types = [
  { v: "direct", t: "Direct sale", d: "Cashier rings up and takes payment. Stock leaves immediately." },
  { v: "approval", t: "Approval based", d: "Cashier creates an invoice. A manager or admin approves it before stock leaves and payment is recorded." },
] as const;

function StoreDialog({ s, onClose }: { s: Partial<Store>; onClose: () => void }) {
  const { rpc } = usePos();
  const qc = useQueryClient();
  const [name, setName] = useState(s.name ?? "");
  const [type, setType] = useState<Store["store_type"]>(s.store_type ?? "direct");
  async function save() {
    try { await rpc("save_store", { p_id: s.id ?? null, p_name: name, p_type: type }); toast.success("Saved"); qc.invalidateQueries(); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{s.id ? "Edit store" : "Add store"}</DialogTitle></DialogHeader>
        <Field label="Store name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="space-y-2">
          {types.map((t) => (
            <button key={t.v} onClick={() => setType(t.v)} className={cn("w-full rounded-lg border p-4 text-left", type === t.v ? "border-accent bg-accent/10" : "bg-card")}>
              <div className="font-semibold">{t.t}</div><div className="text-sm text-muted-foreground">{t.d}</div>
            </button>
          ))}
        </div>
        <Button size="lg" disabled={!name} onClick={save}>Save store</Button>
      </DialogContent>
    </Dialog>
  );
}

function TaxSettings() {
  const { business, rpc } = usePos();
  const qc = useQueryClient();
  const [rate, setRate] = useState(String(business?.tax_rate ?? 0));
  const [incl, setIncl] = useState(business?.tax_inclusive ?? true);
  async function save() {
    try { await rpc("save_tax_settings", { p_rate: Number(rate || 0), p_inclusive: incl }); toast.success("Tax settings saved"); qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="pos-card mt-8 max-w-xl space-y-4 p-6">
      <div><h3 className="text-lg font-bold">VAT / sales tax</h3><p className="text-sm text-muted-foreground">Applies to all stores. Set 0 if you are not VAT registered. Past sales keep the tax they were sold with.</p></div>
      <Field label="Tax rate (%)"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        {[[true, "Prices include VAT", "Shelf price is what the customer pays."], [false, "Add VAT at till", "VAT is added on top of the shelf price."]].map(([v, t, d]) => (
          <button key={String(v)} onClick={() => setIncl(v as boolean)} className={cn("rounded-lg border p-3 text-left", incl === v ? "border-accent bg-accent/10" : "bg-card")}>
            <div className="text-sm font-semibold">{t as string}</div><div className="text-xs text-muted-foreground">{d as string}</div>
          </button>
        ))}
      </div>
      <Button onClick={save}>Save tax settings</Button>
    </div>
  );
}
