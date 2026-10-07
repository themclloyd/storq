import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePos } from "@/lib/pos";
import { useSales, useStaffNames } from "@/lib/sales";
import { rangeDays, sinceFor, useExpenses } from "@/lib/expenses";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/reports")({
  head: () => ({ meta: [{ title: "Reports — Storq" }, { name: "description", content: "Profit, expenses and business performance." }] }),
  component: Reports,
});

const DONE = ["completed", "layby_completed"];

function Reports() {
  const { store, stores, money, can } = usePos();
  const [range, setRange] = useState<keyof typeof rangeDays>("30 days");
  const [all, setAll] = useState(false);
  const since = useMemo(() => sinceFor(range), [range]);
  const storeId = all ? undefined : store?.id;
  const sales = useSales("report", { storeId, since });
  const expenses = useExpenses({ storeId, since });
  const names = useStaffNames();

  const r = useMemo(() => {
    const rows = (sales.data ?? []).filter((s) => DONE.includes(s.status));
    const ex = expenses.data ?? [];
    let revenue = 0, cogs = 0;
    const items: Record<string, { name: string; qty: number; revenue: number; profit: number }> = {};
    const byStaff: Record<string, { sales: number; revenue: number }> = {};
    const byMethod: Record<string, number> = {};
    const byStore: Record<string, { revenue: number; profit: number; expenses: number }> = {};
    for (const s of rows) {
      let sp = 0;
      for (const i of s.sale_items) {
        const rev = i.qty * i.price, c = i.qty * Number(i.cost ?? 0);
        revenue += rev; cogs += c; sp += rev - c;
        const k = i.product_id ?? i.name;
        const it = (items[k] ??= { name: i.name, qty: 0, revenue: 0, profit: 0 });
        it.qty += Number(i.qty); it.revenue += rev; it.profit += rev - c;
      }
      const st = (byStaff[s.created_by ?? "?"] ??= { sales: 0, revenue: 0 });
      st.sales++; st.revenue += Number(s.total);
      byMethod[s.payment_method ?? "cash"] = (byMethod[s.payment_method ?? "cash"] ?? 0) + Number(s.total);
      const bs = (byStore[s.store_id] ??= { revenue: 0, profit: 0, expenses: 0 });
      bs.revenue += Number(s.total); bs.profit += sp;
    }
    const exByCat: Record<string, number> = {};
    let expTotal = 0, tillOut = 0;
    for (const e of ex) {
      const a = Number(e.amount); expTotal += a; if (e.source === "till") tillOut += a;
      exByCat[e.category] = (exByCat[e.category] ?? 0) + a;
      (byStore[e.store_id] ??= { revenue: 0, profit: 0, expenses: 0 }).expenses += a;
    }
    const cashIn = (sales.data ?? []).filter((s) => !["pending_approval", "rejected"].includes(s.status) && (s.payment_method ?? "cash") === "cash").reduce((a, s) => a + Number(s.paid), 0);
    const gross = revenue - cogs;
    return {
      revenue, cogs, gross, expTotal, net: gross - expTotal, margin: revenue ? (gross / revenue) * 100 : 0, count: rows.length,
      tillOut, cashIn, items: Object.values(items).sort((a, b) => b.profit - a.profit), byStaff, byMethod, exByCat, byStore,
      lowMargin: Object.values(items).filter((i) => i.revenue > 0 && i.profit / i.revenue < 0.1),
    };
  }, [sales.data, expenses.data]);

  if (!can("admin", "manager")) return <Empty>Only admins and managers can view reports.</Empty>;
  const loading = sales.isLoading || expenses.isLoading;

  return (
    <>
      <PageHeader title="Business report" sub={all ? "All stores" : store?.name}
        actions={<>
          {(Object.keys(rangeDays) as (keyof typeof rangeDays)[]).map((k) => (
            <Button key={k} size="sm" variant={range === k ? "default" : "outline"} onClick={() => setRange(k)} className="capitalize">{k}</Button>
          ))}
          {stores.length > 1 && <Button size="sm" variant={all ? "accent" : "outline"} onClick={() => setAll(!all)}>All stores</Button>}
        </>}
      />
      {loading ? <Empty>Loading report…</Empty> : (
        <div className="space-y-6">
          <div className="pos-card overflow-hidden">
            <div className="grid divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              <Stat k="Sales" v={money(r.revenue)} sub={`${r.count} transactions`} />
              <Stat k="Buying cost" v={`− ${money(r.cogs)}`} sub="Cost of items sold" />
              <Stat k="Gross profit" v={money(r.gross)} sub={`${r.margin.toFixed(1)}% margin`} />
              <Stat k="Expenses" v={`− ${money(r.expTotal)}`} sub={`${Object.keys(r.exByCat).length} categories`} />
              <Stat k="Net profit" v={money(r.net)} sub="What you keep" strong tone={r.net >= 0 ? "pos" : "neg"} />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Till cash check">
              <Row k="Cash taken from sales" v={money(r.cashIn)} />
              <Row k="Cash paid out (expenses)" v={`− ${money(r.tillOut)}`} />
              <Row k="Expected cash in till" v={money(r.cashIn - r.tillOut)} bold />
            </Card>
            <Card title="Sales by payment method">
              {Object.keys(r.byMethod).length === 0 ? <p className="text-sm text-muted-foreground">No sales.</p> :
                Object.entries(r.byMethod).map(([m, v]) => <Row key={m} k={<span className="capitalize">{m}</span>} v={money(v)} />)}
            </Card>
            <Card title="Expenses by category">
              {Object.keys(r.exByCat).length === 0 ? <p className="text-sm text-muted-foreground">No expenses.</p> :
                Object.entries(r.exByCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => <Bar key={c} label={c} value={v} max={r.expTotal} text={money(v)} />)}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Most profitable items">
              {r.items.length === 0 ? <p className="text-sm text-muted-foreground">No items sold.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="pb-2">Item</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Sales</th><th className="pb-2 text-right">Profit</th><th className="pb-2 text-right">Margin</th></tr></thead>
                  <tbody className="divide-y">
                    {r.items.slice(0, 10).map((i) => (
                      <tr key={i.name}><td className="py-2 font-medium">{i.name}</td><td className="tabular text-right">{i.qty}</td><td className="tabular text-right">{money(i.revenue)}</td><td className="tabular text-right font-semibold">{money(i.profit)}</td><td className="tabular text-right text-muted-foreground">{i.revenue ? ((i.profit / i.revenue) * 100).toFixed(0) : 0}%</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <div className="space-y-6">
              <Card title="Staff performance">
                {Object.keys(r.byStaff).length === 0 ? <p className="text-sm text-muted-foreground">No sales.</p> :
                  Object.entries(r.byStaff).sort((a, b) => b[1].revenue - a[1].revenue).map(([id, v]) => <Row key={id} k={`${names.data?.[id] ?? "Unknown"} · ${v.sales} sales`} v={money(v.revenue)} />)}
              </Card>
              {r.lowMargin.length > 0 && (
                <Card title="Low margin warning (under 10%)">
                  {r.lowMargin.map((i) => <Row key={i.name} k={i.name} v={`${((i.profit / i.revenue) * 100).toFixed(0)}%`} />)}
                  <p className="mt-2 text-xs text-muted-foreground">Check the selling and buying prices of these items in Inventory.</p>
                </Card>
              )}
            </div>
          </div>

          {all && stores.length > 1 && (
            <Card title="By store">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="pb-2">Store</th><th className="pb-2 text-right">Sales</th><th className="pb-2 text-right">Gross profit</th><th className="pb-2 text-right">Expenses</th><th className="pb-2 text-right">Net profit</th></tr></thead>
                <tbody className="divide-y">
                  {stores.map((s) => { const v = r.byStore[s.id] ?? { revenue: 0, profit: 0, expenses: 0 }; return (
                    <tr key={s.id}><td className="py-2 font-medium">{s.name}</td><td className="tabular text-right">{money(v.revenue)}</td><td className="tabular text-right">{money(v.profit)}</td><td className="tabular text-right">{money(v.expenses)}</td><td className="tabular text-right font-semibold">{money(v.profit - v.expenses)}</td></tr>
                  ); })}
                </tbody>
              </table>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">Profit uses the buying price set on each item at the time it was sold. Sales waiting for approval and open laybys are not counted until completed.</p>
        </div>
      )}
    </>
  );
}

function Stat({ k, v, sub, strong, tone }: { k: string; v: string; sub: string; strong?: boolean; tone?: "pos" | "neg" }) {
  return (
    <div className={cn("p-5", strong && "bg-secondary/60")}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={cn("tabular mt-2 text-2xl font-extrabold", tone === "neg" && "text-destructive", tone === "pos" && "text-accent")}>{v}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="pos-card p-5"><h3 className="mb-3 font-bold">{title}</h3><div className="space-y-2">{children}</div></div>;
}
function Row({ k, v, bold }: { k: React.ReactNode; v: string; bold?: boolean }) {
  return <div className={cn("flex justify-between gap-3 text-sm", bold && "border-t pt-2 font-bold")}><span className="text-muted-foreground">{k}</span><span className="tabular">{v}</span></div>;
}
function Bar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between"><span>{label}</span><span className="tabular">{text}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
    </div>
  );
}
