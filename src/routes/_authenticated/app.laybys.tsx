import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { useSales, type SaleRow } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, NativeSelect, PageHeader, Status, fmtDate } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/laybys")({ component: Laybys });

function Laybys() {
  const { store, money, can, rpc } = usePos();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "done">("open");
  const open = useSales("laybys-open", { storeId: store?.id, statuses: ["layby_open"] });
  const done = useSales("laybys-done", { storeId: store?.id, statuses: ["layby_completed", "layby_cancelled"] });
  const [paying, setPaying] = useState<SaleRow | null>(null);
  const [q, setQ] = useState("");
  const rows = (tab === "open" ? open.data : done.data)?.filter(
    (s) => !q || `${s.customer_name} ${s.customer_phone} ${s.number}`.toLowerCase().includes(q.toLowerCase()),
  );

  async function cancel(s: SaleRow) {
    if (!confirm(`Cancel layby #${s.number}? Items go back into stock. Refund ${money(s.paid)} separately.`)) return;
    try { await rpc("cancel_layby", { p_sale: s.id }); toast.success("Layby cancelled"); qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Laybys" sub="Stock is reserved while the customer pays it off." />
      <div className="mb-4 flex flex-wrap gap-2">
        {(["open", "done"] as const).map((t) => (
          <Button key={t} variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t === "open" ? `Open (${open.data?.length ?? 0})` : "Closed"}</Button>
        ))}
        <Input className="ml-auto w-64 bg-card" placeholder="Search customer or number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows?.length === 0 && <Empty>No laybys here.</Empty>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows?.map((s) => {
          const pct = Math.min(100, (Number(s.paid) / Number(s.total)) * 100);
          return (
            <div key={s.id} className="pos-card p-5">
              <div className="flex justify-between">
                <div>
                  <div className="font-bold">{s.customer_name}</div>
                  <div className="text-xs text-muted-foreground">#{s.number} · {s.customer_phone ?? "no phone"} · {fmtDate(s.created_at)}</div>
                </div>
                <Status s={s.status} />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
              <div className="tabular mt-2 flex justify-between text-sm">
                <span>Paid {money(s.paid)}</span><span className="font-bold">Owing {money(Number(s.total) - Number(s.paid))}</span>
              </div>
              <p className="mt-2 truncate text-xs text-muted-foreground">{s.sale_items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</p>
              {s.status === "layby_open" && (
                <div className="mt-4 flex gap-2">
                  {can("admin", "manager") && <Button variant="outline" onClick={() => cancel(s)}>Cancel</Button>}
                  <Button variant="accent" className="flex-1" onClick={() => setPaying(s)}>Take payment</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {paying && <PayDialog s={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); qc.invalidateQueries(); }} />}
    </>
  );
}

function PayDialog({ s, onClose, onPaid }: { s: SaleRow; onClose: () => void; onPaid: () => void }) {
  const { money, rpc } = usePos();
  const owing = Number(s.total) - Number(s.paid);
  const [amt, setAmt] = useState(String(owing));
  const [method, setMethod] = useState("cash");
  async function pay() {
    try {
      const st = await rpc<string>("layby_pay", { p_sale: s.id, p_amount: Number(amt), p_method: method });
      toast.success(st === "layby_completed" ? "Layby fully paid — hand over the goods" : "Payment recorded");
      onPaid();
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Layby payment — {s.customer_name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Owing {money(owing)}</p>
        <Field label="Amount"><Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Method">
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="mobile">Mobile money</option>
          </NativeSelect>
        </Field>
        <Button size="lg" variant="success" onClick={pay}>Record payment</Button>
      </DialogContent>
    </Dialog>
  );
}
