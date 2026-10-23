import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { NoAccess } from "@/components/pos/bits";
import { ReceiptIcon, Refresh01Icon } from "@/lib/icons";
import { REFUNDABLE, useRefunds } from "@/lib/refunds";
import type { SaleRow } from "@/lib/sales";
import { useStaffNames } from "@/lib/sales";
import { usePos, type Store } from "@/lib/pos";
import { downloadPdf, downloadReceiptPdf } from "@/lib/pdf";
import { saleToReceipt } from "@/lib/receipts";
import { methodLabel } from "@/lib/payment-methods";
import { invalidateKeys, SALE_TOUCHED } from "@/lib/cache-invalidation";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/sales_/$id")({
  head: () => ({
    meta: [
      { title: "Sale details | Storq" },
      { name: "description", content: "Sale details, payments and refunds in Storq." },
      { property: "og:title", content: "Sale details | Storq" },
      { property: "og:description", content: "Sale details, payments and refunds in Storq." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SaleDetail,
});

// Sale, refund and payment rows all label methods through the shared catalogue.
const mLabel = methodLabel;

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// Action tiles share one filled style: the order-sheet pattern's Receipt /
// Return tiles — big touch targets, icon top-left, label bottom-left.
const TILE_CLASS =
  "flex h-20 w-36 flex-col items-start justify-between rounded-xl bg-accent/15 p-3.5 " +
  "text-accent transition-colors hover:bg-accent/25 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring";

// Lifecycle states the payment/refund axes don't describe, mapped to dot color.
const dotColor: Record<string, string> = {
  pending_approval: "bg-warning",
  layby_open: "bg-accent",
  rejected: "bg-destructive",
  layby_cancelled: "bg-destructive",
  open: "bg-accent",
  closed: "bg-muted-foreground",
};

// Payment, refund and lifecycle state as independent dot indicators: a layby
// reads "Layby open · Balance due", a part-refunded sale "Paid · Part refunded" —
// instead of one compound status badge.
function StateDots({ s }: { s: SaleRow }) {
  const { t } = useI18n();
  const total = Number(s.total);
  const paid = Number(s.paid);
  const refunded = Number(s.refunded);
  const dots: { key: string; label: string; color: string }[] = [];
  if (!["completed", "layby_completed", "refunded", "partially_refunded"].includes(s.status)) {
    dots.push({
      key: "state",
      label: t(`status.${s.status}`),
      color: dotColor[s.status] ?? "bg-muted-foreground",
    });
  }
  if (total - paid <= 0.009) {
    dots.push({
      key: "paid",
      label: t(s.kind === "layby" ? "status.layby_completed" : "status.completed"),
      color: "bg-success",
    });
  } else if (paid > 0) {
    dots.push({ key: "paid", label: t("sdetail.balanceDue"), color: "bg-warning" });
  } else {
    dots.push({ key: "paid", label: t("status.unpaid"), color: "bg-muted-foreground" });
  }
  if (refunded > 0) {
    const full = refunded >= total - 0.009;
    dots.push({
      key: "refund",
      label: t(full ? "status.refunded" : "status.partially_refunded"),
      color: full ? "bg-destructive" : "bg-warning",
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {dots.map((d) => (
        <span
          key={d.key}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span className={cn("size-2 rounded-full", d.color)} />
          {d.label}
        </span>
      ))}
    </div>
  );
}

function SaleDetail() {
  const { can } = usePos();
  if (!can("sell", "view_sales")) return <NoAccess />;
  return <SaleDetailContent />;
}

function SaleDetailContent() {
  const { id } = Route.useParams();
  const { money, can, stores } = usePos();
  const { t } = useI18n();
  const mLabel = methodLabel;
  const names = useStaffNames();
  const [refundOpen, setRefundOpen] = useState(false);
  const sale = useQuery({
    queryKey: ["sale", id],
    // A sale is immutable except for refunds/reversals, which wipe the cache;
    // ["sale"] is also in SALE_TOUCHED, so revisit deep links load instantly.
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, sale_items(id,refunded_qty,name,qty,price,product_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SaleRow | null;
    },
  });
  const refunds = useRefunds({ saleId: id });
  const s = sale.data;
  if (sale.isLoading)
    return <div className="p-4 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (!s)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {t("sdetail.notFound")}{" "}
        <Link to="/app/sales" className="underline">
          {t("sdetail.backToSales")}
        </Link>
      </Card>
    );

  const subtotal = s.sale_items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0);
  const tax = Number(s.tax);
  const balance = Number(s.total) - Number(s.paid);
  const store = stores.find((x) => x.id === s.store_id);
  // The record speaks the language of the store that created it: approval
  // stores raise invoices (layby included), direct stores ring up sales.
  const approvalStore = store?.store_type === "approval";
  // The customer reads best in the meta row: name, phone, or both — whichever
  // the sale carries.
  const customerLabel = [s.customer_name, s.customer_phone].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/app/sales" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t(approvalStore ? "sales.titleApproval" : "sales.title")}
      </Link>
      <div className="mt-2 mb-4">
        <h1 className="text-xl font-semibold">
          {t(approvalStore ? "sdetail.invoiceTitle" : "sdetail.saleTitle", { number: s.number })}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fmtDate(s.created_at)} · {store?.name}
          {s.created_by &&
            ` · ${t("sdetail.by", { name: names.data?.[s.created_by] ?? t("sdetail.staffWord") })}`}
          {customerLabel && ` · ${t("sdetail.forCustomer", { name: customerLabel })}`}
          {s.approved_by && ` · ${t("sdetail.approvedBy")} ${names.data?.[s.approved_by] ?? "—"}`}
        </p>
        <div className="mt-2">
          <StateDots s={s} />
        </div>
        {/* Amount + payment method on the left, action tiles on the right —
            one row instead of two stacked bands; tiles wrap under on phones. */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="tabular text-3xl font-bold tracking-tight">{money(s.total)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {s.payment_method ? mLabel(s.payment_method) : "—"}
            </div>
          </div>
          <div className="flex gap-2">
            <ReceiptTile
              s={s}
              store={store}
              staff={names.data ?? {}}
              refunds={refunds.data ?? []}
            />
            {can("approvals") && REFUNDABLE.includes(s.status) && (
              <button type="button" onClick={() => setRefundOpen(true)} className={TILE_CLASS}>
                <HugeiconsIcon icon={Refresh01Icon} size={20} />
                <span className="text-sm font-semibold">{t("sdetail.returnRefund")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* One column in receipt order: lines → money → refunds → note. No rail,
          so nothing floats and the card edges line up with the header above. */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm font-semibold">{t("sdetail.itemsCard")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] uppercase">{t("doc.item")}</TableHead>
                  <TableHead className="text-[11px] uppercase">{t("doc.amount")}</TableHead>
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
                          <span className="text-destructive">
                            {" "}
                            · {i.refunded_qty} {t("sdetail.returned")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular font-semibold">
                      {money(Number(i.qty) * Number(i.price))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* Totals reconcile directly under the lines, like a printed roll. */}
            <div className="space-y-1 border-t px-4 py-3 text-[13px]">
              <Row k={t("doc.subtotal")} v={money(subtotal)} />
              {tax > 0 && <Row k={t("till.vat")} v={money(tax)} />}
              <Row k={t("common.total")} v={money(s.total)} bold />
              <Row k={t("doc.paid")} v={money(s.paid)} />
              {balance > 0.009 && (
                <Row k={t("sdetail.balanceDue")} v={money(balance)} className="text-destructive" />
              )}
              {Number(s.refunded) > 0 && (
                <>
                  <Row
                    k={t("status.refunded")}
                    v={`− ${money(s.refunded)}`}
                    className="text-destructive"
                  />
                  <Row k={t("sdetail.net")} v={money(Number(s.total) - Number(s.refunded))} bold />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm font-semibold">{t("sdetail.refundsCard")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(refunds.data ?? []).length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                {t("sdetail.noRefunds")}
              </p>
            ) : (
              <div className="divide-y">
                {refunds.data!.map((r) => (
                  <div key={r.id} className="px-4 py-2 text-[13px]">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">
                        {t("sdetail.refundNumber", { number: r.number })} · {mLabel(r.method)}
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
                        .map(
                          (i) =>
                            `${i.qty} × ${i.name}${i.restock ? "" : ` ${t("sdetail.scrapped")}`}`,
                        )
                        .join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {s.note && (
          <Card className="p-3 text-[13px]">
            <CardTitle className="mb-2 text-sm font-semibold">{t("sdetail.noteCard")}</CardTitle>
            <p className="text-muted-foreground">{s.note}</p>
          </Card>
        )}
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
  const { rpc, money, paymentMethodsFor } = usePos();
  const { t } = useI18n();
  const mLabel = methodLabel;
  const qc = useQueryClient();
  // Refund in the same location that took the money; methods follow that store.
  const methods = paymentMethodsFor(sale.store_id);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState(
    methods.includes(sale.payment_method ?? "") ? (sale.payment_method as string) : "cash",
  );
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
      toast.success(t("sdetail.refundToast", { number: r.number, amount: money(r.amount) }));
      invalidateKeys(qc, SALE_TOUCHED);
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
          <DialogTitle>{t("sdetail.returnTitle", { number: sale.number })}</DialogTitle>
        </DialogHeader>
        <Card>
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
                          {t("sdetail.returnableOf", { left, qty: i.qty })} · {money(i.price)}{" "}
                          {t("sdetail.each")}
                        </div>
                      </TableCell>
                      <TableCell className="w-1 whitespace-nowrap">
                        <label className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={restock[i.id] ?? true}
                            onCheckedChange={(v) => setRestock({ ...restock, [i.id]: v === true })}
                          />{" "}
                          {t("sdetail.backToShelf")}
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
        <p className="text-xs text-muted-foreground">{t("sdetail.refundHint")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("sdetail.refundBy")}
            </span>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {methods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {mLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("inv.reasonLabel")}
            </span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("sdetail.reasonPlaceholder")}
            />
          </Label>
        </div>
        <Button
          variant="destructive"
          disabled={busy || amount <= 0 || !reason.trim()}
          onClick={submit}
        >
          {t("sdetail.refundBtn", { amount: money(amount) })}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptTile({
  s,
  store,
  staff,
  refunds,
}: {
  s: SaleRow;
  store?: Store | undefined;
  staff: Record<string, string>;
  refunds: {
    number: number;
    amount: number;
    method: string;
    reason: string | null;
    created_at: string;
  }[];
}) {
  const { money, business } = usePos();
  const { t } = useI18n();
  const mLabel = methodLabel;
  const sub = s.sale_items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0);
  const isInvoice = s.status === "pending_approval" || s.status === "rejected";
  const docType =
    s.kind === "layby"
      ? t("doc.laybyStatement")
      : isInvoice
        ? t("doc.invoice")
        : t("doc.taxInvoice");
  return (
    <button
      type="button"
      className={TILE_CLASS}
      onClick={() => {
        // Approval invoices stay on the A4 builder (the till never issues a
        // receipt for them); everything else exports on the till's 80mm roll.
        if (!isInvoice) {
          void downloadReceiptPdf(
            saleToReceipt(s, {
              bizName: business?.name ?? "Storq",
              store,
              cashier: staff[s.created_by ?? ""] ?? t("sdetail.staffWord"),
            }),
            money,
          ).then(() => toast.success(t("till.receiptDownloaded")));
          return;
        }
        void downloadPdf({
          filename: `storq-${s.kind === "layby" ? "layby" : "sale"}-${s.number}`,
          title: `${docType} #${s.number}`,
          business: business?.name,
          subtitle: store?.name ?? "",
          badge:
            (
              {
                completed: t("doc.badgePaid"),
                layby_completed: t("doc.badgePaid"),
                refunded: t("doc.badgeRefunded"),
                partially_refunded: t("doc.badgePartRefunded"),
                pending_approval: t("doc.badgeAwaiting"),
                rejected: t("doc.badgeRejected"),
                layby_open: t("doc.badgeLaybyOpen"),
                layby_cancelled: t("doc.badgeCancelled"),
              } as Record<string, string>
            )[s.status] ?? s.status.toUpperCase(),
          meta: [
            [
              t("doc.date"),
              new Date(s.created_at).toLocaleString("en-ZA", {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            ],
            [
              t("sdetail.billedTo"),
              s.customer_name
                ? `${s.customer_name}${s.customer_phone ? ` · ${s.customer_phone}` : ""}`
                : t("doc.walkInCustomer"),
            ],
            [t("doc.servedBy"), staff[s.created_by ?? ""] ?? "—"],
            [t("doc.payment"), s.payment_method ? mLabel(s.payment_method) : "—"],
          ],
          sections: [
            {
              type: "table",
              head: [t("doc.item"), t("doc.qty"), t("doc.unitPrice"), t("doc.amount")],
              align: ["left", "right", "right", "right"],
              body: s.sale_items.map((i) => [
                i.name +
                  (Number(i.refunded_qty) > 0
                    ? ` (${t("sdetail.returnedCount", { count: i.refunded_qty })})`
                    : ""),
                i.qty,
                money(i.price),
                money(Number(i.qty) * Number(i.price)),
              ]),
            },
            ...(refunds.length
              ? [
                  {
                    type: "table" as const,
                    heading: t("sdetail.refundsCard"),
                    head: [
                      t("sdetail.refundWord"),
                      t("doc.date"),
                      t("doc.method"),
                      t("inv.reasonLabel"),
                      t("doc.amount"),
                    ],
                    align: ["left", "left", "left", "left", "right"] as ("left" | "right")[],
                    body: refunds.map((r) => [
                      `#${r.number}`,
                      new Date(r.created_at).toLocaleDateString("en-ZA"),
                      mLabel(r.method),
                      r.reason ?? "",
                      `-${money(r.amount)}`,
                    ]),
                  },
                ]
              : []),
          ],
          totals: [
            [t("doc.subtotal"), money(sub)],
            ...(Number(s.tax) > 0 ? [[t("till.vat"), money(s.tax)] as [string, string]] : []),
            [t("doc.paid"), money(s.paid)],
            ...(Number(s.refunded) > 0
              ? [[t("status.refunded"), `-${money(s.refunded)}`] as [string, string]]
              : []),
            ...(Number(s.total) - Number(s.paid) > 0.009
              ? [
                  [t("sdetail.balanceDue"), money(Number(s.total) - Number(s.paid))] as [
                    string,
                    string,
                  ],
                ]
              : []),
            [t("common.total"), money(s.total)],
          ],
          footerNote: s.note
            ? `${t("doc.noteLabel")} ${s.note}

${t("doc.thankYouBusiness")}`
            : t("doc.thankYouBusiness"),
        });
      }}
    >
      <HugeiconsIcon icon={ReceiptIcon} size={20} />
      <span className="text-sm font-semibold">{t("doc.receipt")}</span>
    </button>
  );
}
