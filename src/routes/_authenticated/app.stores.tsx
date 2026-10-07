import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_authenticated/app/stores")({ component: Stores });

function Stores() {
  const { stores, can } = usePos();
  const [edit, setEdit] = useState<Partial<Store> | null>(null);
  if (!can("admin")) return <Empty>Only admins can manage stores.</Empty>;
  return (
    <>
      <PageHeader title="Stores" actions={<Button variant="accent" onClick={() => setEdit({ store_type: "direct" })}><HugeiconsIcon icon={PlusSignIcon} /> Add store</Button>} />
      <div className="grid gap-3 md:grid-cols-2">
        {stores.map((s) => (
          <div key={s.id} className="pos-card flex items-center justify-between p-5">
            <div><div className="font-bold">{s.name}</div><div className="mt-1"><StoreTypeTag type={s.store_type} /></div></div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>Edit</Button>
          </div>
        ))}
      </div>
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
