import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, NativeSelect, Status, fmtDate } from "@/components/pos/bits";
import { REFUNDABLE, useRefunds } from "@/lib/refunds";
import type { SaleRow } from "@/lib/sales";
import { useStaffNames } from "@/lib/sales";
import { usePos } from "@/lib/pos";

export const Route = createFileRoute("/_authenticated/app/sales_/$id")({
  head: () => ({ meta: [{ title: "Sale details — Storq" }, { name: "description", content: "Sale details, payments and refunds in Storq." }, { property: "og:title", content: "Sale details — Storq" }, { property: "og:description", content: "Sale details, payments and refunds in Storq." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: SaleDetail,
});

const methodLabel: Record<string, string> = { cash: "Cash", card: "Card", mobile: "Mobile money", store_credit: "Store credit" };

function SaleDetail() {
  const { id } = Route.useParams();
  const { money, can, stores } = usePos();
  const names = useStaffNames();
  const [refundOpen, setRefundOpen] = useState(false);
  const sale = useQuery({
    queryKey: ["sale", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales").select("*, sale_items(id,refunded_qty,name,qty,price,cost,product_id)").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as unknown as SaleRow | null;
    },
  });
  const refunds = useRefunds({ saleId: id });
  const s = sale.data;
  if (sale.isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  if (!s) return <Empty>Sale not found. <Link to="/app/sales" className="underline">Back to sales</Link></Empty>;

  const subtotal = s.sale_items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0);
  const tax = Number(s.tax);
  const balance = Number(s.total) - Number(s.paid);
  const storeName = stores.find((x) => x.id === s.store_id)?.name;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/app/sales" className="text-sm text-muted-foreground hover:text-foreground">← Sales</Link>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">Sale #{s.number}</h1>
            <Status s={s.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtDate(s.created_at)} · {storeName}{s.created_by && ` · by ${names.data?.[s.created_by] ?? "staff"}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
          {can("admin", "manager") && REFUNDABLE.includes(s.status) && (
            <Button variant="destructive" onClick={() => setRefundOpen(true)}>Return / refund</Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[["Total", money(s.total)], ["Paid", money(s.paid)], ["Refunded", money(s.refunded)], ["Net", money(Number(s.total) - Number(s.refunded))]].map(([k, v]) => (
          <div key={k} className="pos-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="tabular mt-1 text-xl font-bold">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="pos-card">
            <h2 className="border-b px-5 py-3 font-semibold">Items</h2>
            <div className="divide-y">
              {s.sale_items.map((i) => (
                <div key={i.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{money(i.price)} × {i.qty}{Number(i.refunded_qty) > 0 && <span className="text-destructive"> · {i.refunded_qty} returned</span>}</div>
                  </div>
                  <div className="tabular font-semibold">{money(Number(i.qty) * Number(i.price))}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t px-5 py-4 text-sm">
              <Row k="Subtotal" v={money(subtotal)} />
              {tax > 0 && <Row k="VAT" v={money(tax)} />}
              <Row k="Total" v={money(s.total)} bold />
              {Number(s.refunded) > 0 && <Row k="Refunded" v={`− ${money(s.refunded)}`} className="text-destructive" />}
            </div>
          </section>

          <section className="pos-card">
            <h2 className="border-b px-5 py-3 font-semibold">Refunds</h2>
            {(refunds.data ?? []).length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No refunds on this sale.</p>
            ) : (
              <div className="divide-y">
                {refunds.data!.map((r) => (
                  <div key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-semibold">Refund #{r.number} · {methodLabel[r.method] ?? r.method}</span>
                      <span className="tabular font-semibold text-destructive">− {money(r.amount)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(r.created_at)}{r.staff_id && ` · ${names.data?.[r.staff_id] ?? ""}`}{r.reason && ` · ${r.reason}`}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.refund_items.map((i) => `${i.qty} × ${i.name}${i.restock ? "" : " (scrapped)"}`).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="pos-card p-5 text-sm">
            <h2 className="mb-3 font-semibold">Payment</h2>
            <Row k="Method" v={s.payment_method ? (methodLabel[s.payment_method] ?? s.payment_method) : "—"} />
            <Row k="Paid" v={money(s.paid)} />
            {balance > 0.009 && <Row k="Balance due" v={money(balance)} className="text-destructive" />}
            {s.approved_by && <Row k="Approved by" v={names.data?.[s.approved_by] ?? "—"} />}
          </section>
          <section className="pos-card p-5 text-sm">
            <h2 className="mb-3 font-semibold">Customer</h2>
            {s.customer_name || s.customer_phone ? (
              <><div className="font-medium">{s.customer_name}</div><div className="text-muted-foreground">{s.customer_phone}</div></>
            ) : <p className="text-muted-foreground">Walk-in customer</p>}
          </section>
          {s.note && <section className="pos-card p-5 text-sm"><h2 className="mb-2 font-semibold">Note</h2><p className="text-muted-foreground">{s.note}</p></section>}
        </aside>
      </div>
      {refundOpen && <RefundDialog sale={s} onClose={() => setRefundOpen(false)} />}
    </div>
  );
}

function Row({ k, v, bold, className }: { k: string; v: string; bold?: boolean; className?: string }) {
  return <div className={`flex justify-between py-0.5 ${bold ? "font-bold" : ""} ${className ?? ""}`}><span className={bold ? "" : "text-muted-foreground"}>{k}</span><span className="tabular">{v}</span></div>;
}

function RefundDialog({ sale, onClose }: { sale: SaleRow; onClose: () => void }) {
  const { rpc, money } = usePos();
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState(sale.payment_method ?? "cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Same rule as the server: each item's share of what the customer actually paid (VAT included once).
  const sub = sale.sale_items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0);
  const raw = sale.sale_items.reduce((a, i) => a + (sub > 0 ? Math.round((Number(sale.total) * Number(qty[i.id] || 0) * Number(i.price) / sub) * 100) / 100 : 0), 0);
  const amount = Math.min(raw, Number(sale.total) - Number(sale.refunded));
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
        <p className="text-xs text-muted-foreground">Refund amount includes any VAT the customer paid. Untick "Back to shelf" for damaged items.</p>
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
