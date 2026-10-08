import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { REFUNDABLE, useRefunds } from "@/lib/refunds";
import type { SaleRow } from "@/lib/sales";
import { useStaffNames } from "@/lib/sales";
import { usePos } from "@/lib/pos";

export const Route = createFileRoute("/_authenticated/app/sales_/$id")({
  head: () => ({
    meta: [
      { title: "Sale details — Storq" },
      { name: "description", content: "Sale details, payments and refunds in Storq." },
      { property: "og:title", content: "Sale details — Storq" },
      { property: "og:description", content: "Sale details, payments and refunds in Storq." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SaleDetail,
});

const methodLabel: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  mobile: "Mobile money",
  store_credit: "Store credit",
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const statusStyle: Record<string, string> = {
  completed: "bg-success/15 text-success",
  layby_completed: "bg-success/15 text-success",
  pending_approval: "bg-warning/25 text-warning-foreground",
  layby_open: "bg-accent/15 text-accent",
  rejected: "bg-destructive/15 text-destructive",
  layby_cancelled: "bg-destructive/15 text-destructive",
  open: "bg-accent/15 text-accent",
  closed: "bg-secondary text-muted-foreground",
  refunded: "bg-destructive/15 text-destructive",
  partially_refunded: "bg-warning/25 text-warning-foreground",
};
const statusText: Record<string, string> = {
  completed: "Paid",
  layby_completed: "Layby paid",
  pending_approval: "Awaiting approval",
  layby_open: "Layby open",
  rejected: "Rejected",
  layby_cancelled: "Layby cancelled",
  open: "Open",
  closed: "Closed",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
};

function StatusBadge({ s }: { s: string }) {
  return (
    <Badge className={cn("rounded-full border-transparent px-2.5 py-0.5", statusStyle[s])}>
      {statusText[s] ?? s}
    </Badge>
  );
}

function SaleDetail() {
  const { id } = Route.useParams();
  const { money, can, stores } = usePos();
  const names = useStaffNames();
  const [refundOpen, setRefundOpen] = useState(false);
  const sale = useQuery({
    queryKey: ["sale", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, sale_items(id,refunded_qty,name,qty,price,cost,product_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SaleRow | null;
    },
  });
  const refunds = useRefunds({ saleId: id });
  const s = sale.data;
  if (sale.isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!s)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
        Sale not found.{" "}
        <Link to="/app/sales" className="underline">
          Back to sales
        </Link>
      </Card>
    );

  const subtotal = s.sale_items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0);
  const tax = Number(s.tax);
  const balance = Number(s.total) - Number(s.paid);
  const storeName = stores.find((x) => x.id === s.store_id)?.name;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/app/sales" className="text-sm text-muted-foreground hover:text-foreground">
        ← Sales
      </Link>
      <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Sale #{s.number}</h1>
            <StatusBadge s={s.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {fmtDate(s.created_at)} · {storeName}
            {s.created_by && ` · by ${names.data?.[s.created_by] ?? "staff"}`}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Print
          </Button>
          {can("admin", "manager") && REFUNDABLE.includes(s.status) && (
            <Button variant="destructive" size="sm" onClick={() => setRefundOpen(true)}>
              Return / refund
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {[
          ["Total", money(s.total)],
          ["Paid", money(s.paid)],
          ["Refunded", money(s.refunded)],
          ["Net", money(Number(s.total) - Number(s.refunded))],
        ].map(([k, v]) => (
          <Card key={k} className="p-3 shadow-none">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {k}
            </div>
            <div className="tabular mt-1 truncate text-base font-bold">{v}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card className="shadow-none">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm font-semibold">Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] uppercase">Item</TableHead>
                    <TableHead className="text-right text-[11px] uppercase">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.sale_items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="truncate font-medium">{i.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {money(i.price)} × {i.qty}
                          {Number(i.refunded_qty) > 0 && (
                            <span className="text-destructive"> · {i.refunded_qty} returned</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">
                        {money(Number(i.qty) * Number(i.price))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="space-y-1 border-t px-4 py-3 text-[13px]">
                <Row k="Subtotal" v={money(subtotal)} />
                {tax > 0 && <Row k="VAT" v={money(tax)} />}
                <Row k="Total" v={money(s.total)} bold />
                {Number(s.refunded) > 0 && (
                  <Row k="Refunded" v={`− ${money(s.refunded)}`} className="text-destructive" />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader className="border-b py-3">
              <CardTitle className="text-sm font-semibold">Refunds</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(refunds.data ?? []).length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-muted-foreground">
                  No refunds on this sale.
                </p>
              ) : (
                <div className="divide-y">
                  {refunds.data!.map((r) => (
                    <div key={r.id} className="px-4 py-2 text-[13px]">
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold">
                          Refund #{r.number} · {methodLabel[r.method] ?? r.method}
                        </span>
                        <span className="tabular font-semibold text-destructive">
                          − {money(r.amount)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDate(r.created_at)}
                        {r.staff_id && ` · ${names.data?.[r.staff_id] ?? ""}`}
                        {r.reason && ` · ${r.reason}`}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {r.refund_items
                          .map((i) => `${i.qty} × ${i.name}${i.restock ? "" : " (scrapped)"}`)
                          .join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-3">
          <Card className="p-3 text-[13px] shadow-none">
            <CardTitle className="mb-2 text-sm font-semibold">Payment</CardTitle>
            <Row
              k="Method"
              v={s.payment_method ? (methodLabel[s.payment_method] ?? s.payment_method) : "—"}
            />
            <Row k="Paid" v={money(s.paid)} />
            {balance > 0.009 && (
              <Row k="Balance due" v={money(balance)} className="text-destructive" />
            )}
            {s.approved_by && <Row k="Approved by" v={names.data?.[s.approved_by] ?? "—"} />}
          </Card>
          <Card className="p-3 text-[13px] shadow-none">
            <CardTitle className="mb-2 text-sm font-semibold">Customer</CardTitle>
            {s.customer_name || s.customer_phone ? (
              <>
                <div className="font-medium">{s.customer_name}</div>
                <div className="text-muted-foreground">{s.customer_phone}</div>
              </>
            ) : (
              <p className="text-muted-foreground">Walk-in customer</p>
            )}
          </Card>
          {s.note && (
            <Card className="p-3 text-[13px] shadow-none">
              <CardTitle className="mb-2 text-sm font-semibold">Note</CardTitle>
              <p className="text-muted-foreground">{s.note}</p>
            </Card>
          )}
        </aside>
      </div>
      {refundOpen && <RefundDialog sale={s} onClose={() => setRefundOpen(false)} />}
    </div>
  );
}

function Row({
  k,
  v,
  bold,
  className,
}: {
  k: string;
  v: string;
  bold?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-bold" : ""} ${className ?? ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{k}</span>
      <span className="tabular">{v}</span>
    </div>
  );
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
  const raw = sale.sale_items.reduce(
    (a, i) =>
      a +
      (sub > 0
        ? Math.round(
            ((Number(sale.total) * Number(qty[i.id] || 0) * Number(i.price)) / sub) * 100,
          ) / 100
        : 0),
    0,
  );
  const amount = Math.min(raw, Number(sale.total) - Number(sale.refunded));
  async function submit() {
    setBusy(true);
    try {
      const items = sale.sale_items
        .filter((i) => Number(qty[i.id]) > 0)
        .map((i) => ({
          sale_item_id: i.id,
          qty: Number(qty[i.id]),
          restock: restock[i.id] ?? true,
        }));
      const r = await rpc<{ number: number; amount: number }>("process_refund", {
        p_sale: sale.id,
        p_items: items,
        p_method: method,
        p_reason: reason,
      });
      toast.success(`Refund #${r.number} — give back ${money(r.amount)}`);
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Return items from sale #{sale.number}</DialogTitle>
        </DialogHeader>
        <Card className="shadow-none">
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {sale.sale_items.map((i) => {
                  const left = Number(i.qty) - Number(i.refunded_qty ?? 0);
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="truncate font-semibold">{i.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {left} of {i.qty} returnable · {money(i.price)} each
                        </div>
                      </TableCell>
                      <TableCell className="w-1 whitespace-nowrap">
                        <label className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={restock[i.id] ?? true}
                            onCheckedChange={(v) => setRestock({ ...restock, [i.id]: v === true })}
                          />{" "}
                          Back to shelf
                        </label>
                      </TableCell>
                      <TableCell className="w-1 text-right">
                        <Input
                          className="h-8 w-16"
                          inputMode="decimal"
                          disabled={left <= 0}
                          value={qty[i.id] ?? ""}
                          placeholder="0"
                          onChange={(e) =>
                            setQty({
                              ...qty,
                              [i.id]: String(Math.min(left, Number(e.target.value) || 0) || ""),
                            })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Refund amount includes any VAT the customer paid. Untick "Back to shelf" for damaged
          items.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Refund by</span>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="mobile">Mobile money</SelectItem>
                <SelectItem value="store_credit">Store credit</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Reason</span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Faulty, wrong size…"
            />
          </Label>
        </div>
        <Button
          variant="destructive"
          disabled={busy || amount <= 0 || !reason.trim()}
          onClick={submit}
        >
          Refund {money(amount)}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
