import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePos } from "@/lib/pos";
import { useSales, useStaffNames } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Status, fmtDate } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/sales")({ component: Sales });

const ranges = { today: 0, "7 days": 7, "30 days": 30 } as const;

function Sales() {
  const { store, stores, money } = usePos();
  const [range, setRange] = useState<keyof typeof ranges>("today");
  const [all, setAll] = useState(false);
  const since = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ranges[range]); return d.toISOString();
  }, [range]);
  const sales = useSales("history", { storeId: all ? undefined : store?.id, since });
  const names = useStaffNames();
  const [open, setOpen] = useState<string | null>(null);
  const rows = sales.data ?? [];
  const done = rows.filter((s) => ["completed", "layby_completed"].includes(s.status));
  const revenue = done.reduce((a, s) => a + Number(s.total), 0);
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
            {stores.length > 1 && <Button size="sm" variant={all ? "accent" : "outline"} onClick={() => setAll(!all)}>All stores</Button>}
          </>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["Completed sales", money(revenue)],
          ["Cash collected", money(collected)],
          ["Transactions", String(done.length)],
          ["Awaiting approval", String(pending)],
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
