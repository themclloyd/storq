import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/pos/bits";
import { REFUNDABLE, COUNTED, useRefunds } from "@/lib/refunds";
import type { SaleRow } from "@/lib/sales";
import { usePos } from "@/lib/pos";
import { useSales, useStaffNames } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Status, fmtDate } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/sales")({ head: () => ({ meta: [{ title: "Sales — Storq" }, { name: "description", content: "Review Storq sales, receipts and refunds." }, { property: "og:title", content: "Sales — Storq" }, { property: "og:description", content: "Review Storq sales, receipts and refunds." }, { name: "robots", content: "noindex, nofollow" }] }), component: Sales });

const ranges = { today: 0, "7 days": 7, "30 days": 30 } as const;

function Sales() {
  const { store, stores, money, can } = usePos();
  const [refund, setRefund] = useState<SaleRow | null>(null);
  const [range, setRange] = useState<keyof typeof ranges>("today");
  const [all, setAll] = useState(false);
  const since = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ranges[range]); return d.toISOString();
  }, [range]);
  const sales = useSales("history", { storeId: all ? undefined : store?.id, since });
  const names = useStaffNames();
  const [open, setOpen] = useState<string | null>(null);
  const rows = sales.data ?? [];
  const done = rows.filter((s) => COUNTED.includes(s.status));
  const revenue = done.reduce((a, s) => a + Number(s.total) - Number(s.refunded ?? 0), 0);
  const refunds = useRefunds({ storeId: all ? undefined : store?.id, since });
  const collected = rows.filter((s) => s.status !== "pending_approval" && s.status !== "rejected").reduce((a, s) => a + Number(s.paid), 0);
  const pending = rows.filter((s) => s.status === "pending_approval").length;
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Sales"
        actions={
          <>
            {(Object.keys(ranges) as (keyof typeof ranges)[]).map((r) => (
              <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="capitalize">{r}</Button>
            ))}
            {stores.length > 1 && can("admin", "manager") && <Button size="sm" variant={all ? "accent" : "outline"} onClick={() => setAll(!all)}>All stores</Button>}
          </>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Net sales", money(revenue)],
          ["Collected", money(collected)],
          ["Refunds", money((refunds.data ?? []).reduce((a, r) => a + Number(r.amount), 0))],
          ["Transactions", String(done.length)],
          ...((all ? stores.some((s) => s.store_type === "approval") : store?.store_type === "approval") ? [["Awaiting approval", String(pending)]] : []),
        ].map(([k, v]) => (
          <div key={k} className="pos-card p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="tabular mt-2 text-2xl font-extrabold">{v}</div>
          </div>
        ))}
      </div>
      {rows.length === 0 ? <Empty>No sales in this period.</Empty> : (
        <div className="pos-card divide-y">
          {rows.map((s) => (
            <div key={s.id}>
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-4 px-5 py-3 text-left text-sm hover:bg-secondary/60">
                <span className="w-14 font-bold">#{s.number}</span>
                <span className="w-28 text-muted-foreground">{fmtDate(s.created_at)}</span>
                <Status s={s.status} />
                <span className="hidden flex-1 truncate text-muted-foreground sm:block">
                  {all && `${storeName(s.store_id)} · `}{names.data?.[s.created_by ?? ""]}{s.customer_name && ` · ${s.customer_name}`}
                </span>
                <span className="ml-auto tabular font-semibold">{money(s.total)}</span>
              </button>
              {open === s.id && (
                <div className="bg-secondary/50 px-5 py-3 text-sm">
                  {s.sale_items.map((i, k) => (
                    <div key={k} className="flex justify-between"><span>{i.qty} × {i.name}</span><span className="tabular">{money(i.qty * i.price)}</span></div>
                  ))}
                  <div className="mt-2 text-xs text-muted-foreground">
                    Paid {money(s.paid)} {s.payment_method && `by ${s.payment_method}`}{s.approved_by && ` · approved by ${names.data?.[s.approved_by]}`}
                  </div>
                  {Number(s.tax) > 0 && <div className="text-xs text-muted-foreground">Includes VAT {money(s.tax)}</div>}
                  {Number(s.refunded) > 0 && <div className="text-xs font-semibold text-destructive">Refunded {money(s.refunded)}</div>}
                  {can("admin", "manager") && REFUNDABLE.includes(s.status) && (
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => setRefund(s)}>Return / refund</Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {refund && <RefundDialog sale={refund} onClose={() => setRefund(null)} />}
    </>
  );
}

function RefundDialog({ sale, onClose }: { sale: SaleRow; onClose: () => void }) {
  const { rpc, money, business } = usePos();
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState(sale.payment_method ?? "cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const addTax = Number(business?.tax_rate ?? 0) > 0 && business?.tax_inclusive === false ? 1 + Number(business?.tax_rate) / 100 : 1;
  const amount = sale.sale_items.reduce((a, i) => a + Number(qty[i.id] || 0) * i.price * addTax, 0);
  async function submit() {
    setBusy(true);
    try {
      const items = sale.sale_items.filter((i) => Number(qty[i.id]) > 0).map((i) => ({ sale_item_id: i.id, qty: Number(qty[i.id]), restock: restock[i.id] ?? true }));
      const r = await rpc<{ number: number; amount: number }>("process_refund", { p_sale: sale.id, p_items: items, p_method: method, p_reason: reason });
      toast.success(`Refund #${r.number} — give back ${money(r.amount)}`); qc.invalidateQueries(); onClose();
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Return items from sale #{sale.number}</DialogTitle></DialogHeader>
        <div className="divide-y rounded-lg border">
          {sale.sale_items.map((i) => {
            const left = Number(i.qty) - Number(i.refunded_qty ?? 0);
            return (
              <div key={i.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="flex-1"><div className="font-semibold">{i.name}</div><div className="text-xs text-muted-foreground">{left} of {i.qty} returnable · {money(i.price)} each</div></div>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={restock[i.id] ?? true} onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} /> Back to shelf</label>
                <Input className="w-16" inputMode="decimal" disabled={left <= 0} value={qty[i.id] ?? ""} placeholder="0"
                  onChange={(e) => setQty({ ...qty, [i.id]: String(Math.min(left, Number(e.target.value) || 0) || "") })} />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Untick "Back to shelf" for damaged items — they will not be added back to stock.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Refund by"><NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="mobile">Mobile money</option><option value="store_credit">Store credit</option>
          </NativeSelect></Field>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Faulty, wrong size…" /></Field>
        </div>
        <Button size="lg" variant="destructive" disabled={busy || amount <= 0 || !reason.trim()} onClick={submit}>Refund {money(amount)}</Button>
      </DialogContent>
    </Dialog>
  );
}
