import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { useSales, type SaleRow } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  Field,
  NativeSelect,
  NoAccess,
  PageHeader,
  Status,
  fmtDate,
} from "@/components/pos/bits";
import { invalidateKeys, SALE_TOUCHED } from "@/lib/cache-invalidation";
import { methodLabel } from "@/lib/payment-methods";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/laybys")({
  head: () => ({
    meta: [
      { title: "Laybys | Storq" },
      { name: "description", content: "Track customer laybys and outstanding balances." },
      { property: "og:title", content: "Laybys | Storq" },
      { property: "og:description", content: "Track customer laybys and outstanding balances." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Laybys,
});

function Laybys() {
  const { can } = usePos();
  if (!can("sell", "view_sales")) return <NoAccess />;
  return <LaybysContent />;
}

function LaybysContent() {
  const { store, money, can, rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "done">("open");
  const open = useSales("laybys-open", { storeId: store?.id, statuses: ["layby_open"] });
  const done = useSales("laybys-done", {
    storeId: store?.id,
    statuses: ["layby_completed", "layby_cancelled"],
  });
  const [paying, setPaying] = useState<SaleRow | null>(null);
  const [q, setQ] = useState("");
  const rows = (tab === "open" ? open.data : done.data)?.filter(
    (s) =>
      !q ||
      `${s.customer_name} ${s.customer_phone} ${s.number}`.toLowerCase().includes(q.toLowerCase()),
  );

  async function cancel(s: SaleRow) {
    if (!confirm(t("laybys.cancelConfirm", { number: s.number, amount: money(s.paid) }))) return;
    try {
      await rpc("cancel_layby", { p_sale: s.id });
      toast.success(t("status.layby_cancelled"));
      invalidateKeys(qc, SALE_TOUCHED);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title={t("laybys.title")} sub={t("laybys.sub")} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={t("laybys.title")}
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "open", label: `${t("laybys.openTab")} (${open.data?.length ?? 0})` },
            { value: "done", label: t("laybys.closedTab") },
          ]}
        />
        <Input
          className="ml-auto h-9 w-60 bg-card"
          placeholder={t("laybys.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {rows?.length === 0 && <Empty>{t("laybys.none")}</Empty>}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows?.map((s) => {
          const pct = Math.min(100, (Number(s.paid) / Number(s.total)) * 100);
          return (
            <div key={s.id} className="pos-card min-w-0 p-3">
              <div className="flex min-w-0 justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{s.customer_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    #{s.number} · {s.customer_phone ?? t("laybys.noPhone")} ·{" "}
                    {fmtDate(s.created_at)}
                  </div>
                </div>
                <Status s={s.status} />
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <div className="tabular mt-2 flex items-end justify-between gap-2 text-[13px]">
                <span className="truncate text-muted-foreground">
                  {t("doc.paid")} {money(s.paid)}
                </span>
                <span className="truncate text-sm font-extrabold">
                  {t("laybys.owing")} {money(Number(s.total) - Number(s.paid))}
                </span>
              </div>
              <p className="mt-1.5 truncate text-xs text-muted-foreground">
                {s.sale_items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
              </p>
              {s.status === "layby_open" && (
                <div className="mt-3 flex gap-2">
                  {can("approvals") && (
                    <Button size="sm" variant="outline" onClick={() => cancel(s)}>
                      {t("common.cancel")}
                    </Button>
                  )}
                  {can("sell") && (
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={() => setPaying(s)}
                    >
                      {t("laybys.takePayment")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {paying && (
        <PayDialog
          s={paying}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            invalidateKeys(qc, SALE_TOUCHED);
          }}
        />
      )}
    </>
  );
}

function PayDialog({
  s,
  onClose,
  onPaid,
}: {
  s: SaleRow;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { money, rpc, paymentMethodsFor } = usePos();
  const { t } = useI18n();
  // The layby was opened at a store; its methods are the ones that can settle it.
  const methods = paymentMethodsFor(s.store_id);
  const owing = Number(s.total) - Number(s.paid);
  const [amt, setAmt] = useState(String(owing));
  const [method, setMethod] = useState("cash");
  async function pay() {
    try {
      const st = await rpc<string>("layby_pay", {
        p_sale: s.id,
        p_amount: Number(amt),
        p_method: method,
      });
      toast.success(st === "layby_completed" ? t("laybys.fullyPaid") : t("laybys.paymentRecorded"));
      onPaid();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("laybys.payTitle", { customer: s.customer_name ?? t("doc.walkInCustomer") })}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("laybys.owing")} {money(owing)}
        </p>
        <Field label={t("doc.amount")}>
          <Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </Field>
        <Field label={t("doc.method")}>
          <NativeSelect
            value={method}
            onChange={setMethod}
            options={methods.map((code) => ({ value: code, label: methodLabel(code) }))}
          />
        </Field>
        <Button variant="success" onClick={pay}>
          {t("laybys.recordPayment")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
