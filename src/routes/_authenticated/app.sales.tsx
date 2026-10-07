import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { COUNTED, useRefunds } from "@/lib/refunds";
import { usePos } from "@/lib/pos";
import { useSales, useStaffNames } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Status, fmtDate } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/sales")({ head: () => ({ meta: [{ title: "Sales — Storq" }, { name: "description", content: "Review Storq sales, receipts and refunds." }, { property: "og:title", content: "Sales — Storq" }, { property: "og:description", content: "Review Storq sales, receipts and refunds." }, { name: "robots", content: "noindex, nofollow" }] }), component: Sales });

const ranges = { today: 0, "7 days": 7, "30 days": 30 } as const;

function Sales() {
  const { store, stores, money, can } = usePos();
  const [range, setRange] = useState<keyof typeof ranges>("today");
  const [all, setAll] = useState(false);
  const since = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ranges[range]); return d.toISOString();
  }, [range]);
  const sales = useSales("history", { storeId: all ? undefined : store?.id, since });
  const names = useStaffNames();
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
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Net sales", money(revenue)],
          ["Collected", money(collected)],
          ["Refunds", money((refunds.data ?? []).reduce((a, r) => a + Number(r.amount), 0))],
          ["Transactions", String(done.length)],
          ...((all ? stores.some((s) => s.store_type === "approval") : store?.store_type === "approval") ? [["Awaiting approval", String(pending)]] : []),
        ].map(([k, v]) => (
          <div key={k} className="pos-card p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="tabular mt-1 truncate text-base font-extrabold">{v}</div>
          </div>
        ))}
      </div>
      {rows.length === 0 ? <Empty>No sales in this period.</Empty> : (
        <div className="pos-card divide-y">
          {rows.map((s) => (
            <div key={s.id}>
              <Link to="/app/sales/$id" params={{ id: s.id }} className="flex w-full items-center gap-3 px-4 py-2 text-[13px] hover:bg-secondary/60">
                <span className="w-14 font-bold">#{s.number}</span>
                <span className="w-28 text-muted-foreground">{fmtDate(s.created_at)}</span>
                <Status s={s.status} />
                <span className="hidden flex-1 truncate text-muted-foreground sm:block">
                  {all && `${storeName(s.store_id)} · `}{names.data?.[s.created_by ?? ""]}{s.customer_name && ` · ${s.customer_name}`}
                </span>
                <span className="ml-auto tabular font-semibold">{money(s.total)}</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
