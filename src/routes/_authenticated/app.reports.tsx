import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePos } from "@/lib/pos";
import { useSaleItemCosts, useSales, useStaffNames } from "@/lib/sales";
import { rangeDays, sinceFor, useExpenses } from "@/lib/expenses";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { downloadPdf, fileStamp } from "@/lib/pdf";
import { COUNTED, useRefunds } from "@/lib/refunds";
import {
  HBarsChart,
  PaymentMethods,
  ProfitTrendChart,
  type MethodSlice,
  type ProfitTrendPoint,
} from "@/components/dashboard";

export const Route = createFileRoute("/_authenticated/app/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Storq" },
      { name: "description", content: "Review profit, expenses and store performance." },
      { property: "og:title", content: "Reports — Storq" },
      { property: "og:description", content: "Review profit, expenses and store performance." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Reports,
});

const DONE = COUNTED;

function Reports() {
  const { store, stores, money, can, business } = usePos();
  const [range, setRange] = useState<keyof typeof rangeDays>("30 days");
  const [all, setAll] = useState(false);
  const since = useMemo(() => sinceFor(range), [range]);
  const storeId = all ? undefined : store?.id;
  const sales = useSales("report", { storeId, since });
  const expenses = useExpenses({ storeId, since });
  const names = useStaffNames();
  const refundsQ = useRefunds({ storeId, since });
  // Sale-item costs now live in their own gated table (admin/manager reads it; reports are gated too).
  const costs = useSaleItemCosts(sales.data);

  const r = useMemo(() => {
    const rows = (sales.data ?? []).filter((s) => DONE.includes(s.status));
    const ex = expenses.data ?? [];
    let revenue = 0,
      cogs = 0;
    const items: Record<string, { name: string; qty: number; revenue: number; profit: number }> =
      {};
    const byStaff: Record<string, { sales: number; revenue: number }> = {};
    const byMethod: Record<string, number> = {};
    const byStore: Record<string, { revenue: number; profit: number; expenses: number }> = {};
    for (const s of rows) {
      let sp = 0;
      for (const i of s.sale_items) {
        const rev = i.qty * i.price,
          c = i.qty * Number(costs.data?.[i.id] ?? 0);
        revenue += rev;
        cogs += c;
        sp += rev - c;
        const k = i.product_id ?? i.name;
        const it = (items[k] ??= { name: i.name, qty: 0, revenue: 0, profit: 0 });
        it.qty += Number(i.qty);
        it.revenue += rev;
        it.profit += rev - c;
      }
      const st = (byStaff[s.created_by ?? "?"] ??= { sales: 0, revenue: 0 });
      st.sales++;
      st.revenue += Number(s.total);
      byMethod[s.payment_method ?? "cash"] =
        (byMethod[s.payment_method ?? "cash"] ?? 0) + Number(s.total);
      const bs = (byStore[s.store_id] ??= { revenue: 0, profit: 0, expenses: 0 });
      bs.revenue += Number(s.total);
      bs.profit += sp;
    }
    let refunds = 0,
      refundCost = 0,
      tax = 0,
      refundTax = 0;
    for (const s of rows) tax += Number(s.tax ?? 0);
    for (const f of refundsQ.data ?? []) {
      refunds += Number(f.amount);
      refundCost += Number(f.cost);
      refundTax += Number(f.tax);
      (byStore[f.store_id] ??= { revenue: 0, profit: 0, expenses: 0 }).revenue -= Number(f.amount);
      byStore[f.store_id]!.profit -= Number(f.amount) - Number(f.cost);
      for (const i of f.refund_items) {
        const it = items[i.product_id ?? i.name];
        if (it) {
          it.qty -= Number(i.qty);
          it.revenue -= Number(i.amount);
          it.profit -= Number(i.amount) - Number(i.cost);
        }
      }
    }
    revenue -= refunds;
    cogs -= refundCost;
    tax -= refundTax;
    const exByCat: Record<string, number> = {};
    let expTotal = 0,
      tillOut = 0;
    for (const e of ex) {
      const a = Number(e.amount);
      expTotal += a;
      if (e.source === "till") tillOut += a;
      exByCat[e.category] = (exByCat[e.category] ?? 0) + a;
      (byStore[e.store_id] ??= { revenue: 0, profit: 0, expenses: 0 }).expenses += a;
    }
    const cashIn = (sales.data ?? [])
      .filter(
        (s) =>
          !["pending_approval", "rejected"].includes(s.status) &&
          (s.payment_method ?? "cash") === "cash",
      )
      .reduce((a, s) => a + Number(s.paid), 0);
    const gross = revenue - cogs;
    return {
      revenue,
      cogs,
      gross,
      expTotal,
      net: gross - expTotal,
      margin: revenue ? (gross / revenue) * 100 : 0,
      count: rows.length,
      tillOut,
      cashIn,
      refunds,
      tax,
      items: Object.values(items).sort((a, b) => b.profit - a.profit),
      byStaff,
      byMethod,
      exByCat,
      byStore,
      lowMargin: Object.values(items).filter((i) => i.revenue > 0 && i.profit / i.revenue < 0.1),
    };
  }, [sales.data, expenses.data, refundsQ.data, costs.data]);

  // Daily sales-vs-gross-profit and expense bins for the trend chart.
  const trend = useMemo<ProfitTrendPoint[]>(() => {
    const hourly = range === "today";
    const key = (iso: string) => {
      const dt = new Date(iso);
      return hourly
        ? dt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })
        : dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
    };
    const bins: Record<string, { day: string; ts: number; sales: number; profit: number }> = {};
    const bin = (iso: string) => {
      const k = key(iso);
      return (bins[k] ??= { day: k, ts: new Date(iso).getTime(), sales: 0, profit: 0 });
    };
    for (const s of (sales.data ?? []).filter((y) => DONE.includes(y.status))) {
      const b = bin(s.created_at);
      let sp = 0;
      for (const i of s.sale_items) sp += i.qty * i.price - i.qty * Number(costs.data?.[i.id] ?? 0);
      b.sales += Number(s.total);
      b.profit += sp;
    }
    for (const f of refundsQ.data ?? []) {
      const b = bin(f.created_at);
      b.sales -= Number(f.amount);
      b.profit -= Number(f.amount) - Number(f.cost);
    }
    return Object.values(bins).sort((a, b) => a.ts - b.ts);
  }, [sales.data, refundsQ.data, costs.data, range]);

  const expSlices = useMemo<MethodSlice[]>(
    () =>
      Object.entries(r.exByCat)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value })),
    [r],
  );
  const methodSlices = useMemo<MethodSlice[]>(
    () =>
      Object.entries(r.byMethod)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value })),
    [r],
  );
  const itemSlices = useMemo<MethodSlice[]>(
    () => r.items.slice(0, 8).map((i) => ({ name: i.name, value: Math.max(i.profit, 0) })),
    [r],
  );
  const staffSlices = useMemo<MethodSlice[]>(
    () =>
      Object.entries(r.byStaff)
        .map(([id, v]) => ({
          name: `${names.data?.[id] ?? "Unknown"} · ${v.sales}`,
          value: v.revenue,
        }))
        .sort((a, b) => b.value - a.value),
    [r, names.data],
  );

  if (!can("admin", "manager"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
        Only admins and managers can view reports.
      </Card>
    );
  const loading = sales.isLoading || expenses.isLoading || refundsQ.isLoading;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Business report</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {all ? "All stores" : (store?.name ?? "")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(rangeDays) as (keyof typeof rangeDays)[]).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={range === k ? "default" : "outline"}
              onClick={() => setRange(k)}
              className="capitalize"
            >
              {k}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() =>
              void downloadPdf({
                filename: `storq-business-report-${fileStamp()}`,
                title: "Business report",
                business: business?.name,
                subtitle: `${all ? "All stores" : (store?.name ?? "")} · last ${range}`,
                badge: "P&L",
                kpis: [
                  ["Net sales", money(r.revenue)],
                  ["Gross profit", money(r.gross)],
                  ["Expenses", money(r.expTotal)],
                  ["Net profit", money(r.net)],
                ],
                sections: [
                  {
                    type: "pairs",
                    heading: "Profit & loss",
                    rows: [
                      ["Net sales (after refunds)", money(r.revenue)],
                      ["Refunds", `-${money(r.refunds)}`],
                      ["Buying cost of items sold", `-${money(r.cogs)}`],
                      ["Gross profit", money(r.gross)],
                      ["Gross margin", `${r.margin.toFixed(1)}%`],
                      ["Operating expenses", `-${money(r.expTotal)}`],
                      ["Net profit", money(r.net)],
                    ],
                  },
                  {
                    type: "pairs",
                    heading: "Tax summary (VAT)",
                    rows: [
                      ["Sales incl. tax", money(r.revenue)],
                      ["VAT collected", money(r.tax)],
                      ["Sales excl. tax", money(r.revenue - r.tax)],
                    ],
                  },
                  {
                    type: "pairs",
                    heading: "Till cash check",
                    rows: [
                      ["Cash taken from sales", money(r.cashIn)],
                      ["Cash paid out (expenses)", `-${money(r.tillOut)}`],
                      ["Expected cash in till", money(r.cashIn - r.tillOut)],
                    ],
                  },
                  {
                    type: "table",
                    heading: "Sales by payment method",
                    head: ["Method", "Amount"],
                    align: ["left", "right"],
                    body: Object.entries(r.byMethod).map(([m, v]) => [m, money(v)]),
                  },
                  {
                    type: "table",
                    heading: "Expenses by category",
                    head: ["Category", "Amount"],
                    align: ["left", "right"],
                    body: Object.entries(r.exByCat)
                      .sort((a, b) => b[1] - a[1])
                      .map(([c, v]) => [c, money(v)]),
                  },
                  {
                    type: "table",
                    heading: "Item performance",
                    head: ["Item", "Qty", "Sales", "Profit", "Margin"],
                    align: ["left", "right", "right", "right", "right"],
                    body: r.items.map((i) => [
                      i.name,
                      i.qty,
                      money(i.revenue),
                      money(i.profit),
                      i.revenue ? `${((i.profit / i.revenue) * 100).toFixed(1)}%` : "-",
                    ]),
                  },
                  {
                    type: "table",
                    heading: "Staff performance",
                    head: ["Staff", "Sales", "Revenue"],
                    align: ["left", "right", "right"],
                    body: Object.entries(r.byStaff).map(([id, v]) => [
                      names.data?.[id] ?? "Unknown",
                      v.sales,
                      money(v.revenue),
                    ]),
                  },
                  ...(all
                    ? [
                        {
                          type: "table" as const,
                          heading: "Stores",
                          head: ["Store", "Sales", "Profit", "Expenses", "Net"],
                          align: ["left", "right", "right", "right", "right"] as (
                            "left" | "right"
                          )[],
                          body: Object.entries(r.byStore).map(([id, v]) => [
                            stores.find((x) => x.id === id)?.name ?? "",
                            money(v.revenue),
                            money(v.profit),
                            money(v.expenses),
                            money(v.profit - v.expenses),
                          ]),
                        },
                      ]
                    : []),
                ],
              })
            }
          >
            Download PDF
          </Button>
          {stores.length > 1 && (
            <Button size="sm" variant={all ? "accent" : "outline"} onClick={() => setAll(!all)}>
              All stores
            </Button>
          )}
        </div>
      </div>
      {loading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
          Loading report…
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden shadow-none">
            <div className="grid divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              <Stat
                k="Net sales"
                v={money(r.revenue)}
                sub={`${r.count} sales · ${money(r.refunds)} refunded`}
              />
              <Stat k="Buying cost" v={`− ${money(r.cogs)}`} sub="Cost of items sold" />
              <Stat k="Gross profit" v={money(r.gross)} sub={`${r.margin.toFixed(1)}% margin`} />
              <Stat
                k="Expenses"
                v={`− ${money(r.expTotal)}`}
                sub={`${Object.keys(r.exByCat).length} categories`}
              />
              <Stat
                k="Net profit"
                v={money(r.net)}
                sub="What you keep"
                strong
                tone={r.net >= 0 ? "pos" : "neg"}
              />
            </div>
          </Card>

          <Panel title={range === "today" ? "Sales vs profit by hour" : "Sales vs profit by day"}>
            <ProfitTrendChart data={trend} money={money} />
          </Panel>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Panel title="Till cash check">
              <Row k="Cash taken from sales" v={money(r.cashIn)} />
              <Row k="Cash paid out (expenses)" v={`− ${money(r.tillOut)}`} />
              <Row k="Expected cash in till" v={money(r.cashIn - r.tillOut)} bold />
            </Panel>
            <Panel title="Tax summary (VAT)">
              <Row k="Sales incl. tax" v={money(r.revenue)} />
              <Row k="VAT collected" v={money(r.tax)} />
              <Row k="Sales excl. tax" v={money(r.revenue - r.tax)} bold />
            </Panel>
            <Panel title="Sales by payment method">
              <PaymentMethods data={methodSlices} money={money} />
            </Panel>
            <Panel title="Expenses by category">
              {expSlices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenses.</p>
              ) : (
                <HBarsChart data={expSlices} money={money} />
              )}
            </Panel>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Top items by profit">
              {itemSlices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items sold.</p>
              ) : (
                <HBarsChart data={itemSlices} money={money} />
              )}
            </Panel>
            <div className="space-y-3">
              <Panel title="Staff performance — revenue">
                {staffSlices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales.</p>
                ) : (
                  staffSlices
                    .slice(0, 6)
                    .map((s) => (
                      <Bar
                        key={s.name}
                        label={s.name}
                        value={s.value}
                        max={staffSlices[0]?.value ?? 0}
                        text={money(s.value)}
                      />
                    ))
                )}
              </Panel>
              {r.lowMargin.length > 0 && (
                <Panel title="Low margin warning (under 10%)">
                  {r.lowMargin.map((i) => (
                    <Row
                      key={i.name}
                      k={i.name}
                      v={`${((i.profit / i.revenue) * 100).toFixed(0)}%`}
                    />
                  ))}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Check the selling and buying prices of these items in Inventory.
                  </p>
                </Panel>
              )}
            </div>
          </div>

          {all && stores.length > 1 && (
            <Panel title="Net profit by store">
              <HBarsChart
                data={stores
                  .map((s) => {
                    const v = r.byStore[s.id] ?? { revenue: 0, profit: 0, expenses: 0 };
                    return { name: s.name, value: v.profit - v.expenses };
                  })
                  .sort((a, b) => b.value - a.value)}
                money={money}
              />
            </Panel>
          )}
          <p className="text-xs text-muted-foreground">
            Profit uses the buying price set on each item at the time it was sold. Refunds are taken
            off sales and profit; restocked items return their buying cost. Sales waiting for
            approval and open laybys are not counted until completed. For exact till balances use
            Cash drawer shifts.
          </p>
        </div>
      )}
    </>
  );
}

function Stat({
  k,
  v,
  sub,
  strong,
  tone,
}: {
  k: string;
  v: string;
  sub: string;
  strong?: boolean;
  tone?: "pos" | "neg";
}) {
  return (
    <div className={cn("p-3", strong && "bg-secondary/60")}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </div>
      <div
        className={cn(
          "tabular mt-1 truncate text-base font-extrabold",
          tone === "neg" && "text-destructive",
          tone === "pos" && "text-accent",
        )}
      >
        {v}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0 text-[13px]">{children}</CardContent>
    </Card>
  );
}
function Row({ k, v, bold }: { k: React.ReactNode; v: string; bold?: boolean }) {
  return (
    <div
      className={cn("flex justify-between gap-3 text-[13px]", bold && "border-t pt-2 font-bold")}
    >
      <span className="min-w-0 truncate text-muted-foreground">{k}</span>
      <span className="tabular shrink-0">{v}</span>
    </div>
  );
}
function Bar({
  label,
  value,
  max,
  text,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
}) {
  return (
    <div className="text-[13px]">
      <div className="flex justify-between gap-3">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular shrink-0">{text}</span>
      </div>
      <Progress value={max ? (value / max) * 100 : 0} className="mt-1 h-1.5" />
    </div>
  );
}
