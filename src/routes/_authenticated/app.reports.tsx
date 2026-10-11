import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { useSaleItemCosts, useSales, useStaffNames } from "@/lib/sales";
import { rangeDays, sinceFor, useExpenses } from "@/lib/expenses";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PageHeader } from "@/components/pos/bits";
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

const RANGE_LABEL_KEY: Record<keyof typeof rangeDays, string> = {
  today: "reports.rangeToday",
  "7 days": "reports.range7d",
  "30 days": "reports.range30d",
  "90 days": "reports.range90d",
};

function Reports() {
  const { store, stores, money, can, business } = usePos();
  const { t } = useI18n();
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
          name: `${names.data?.[id] ?? t("reports.unknownStaff")} · ${v.sales}`,
          value: v.revenue,
        }))
        .sort((a, b) => b.value - a.value),
    [r, names.data, t],
  );

  if (!can("admin", "manager"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {t("reports.onlyAdmins")}
      </Card>
    );
  const loading = sales.isLoading || expenses.isLoading || refundsQ.isLoading;

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.reports")} / ${t("nav.overview")}`}
        title={t("reports.title")}
        sub={all ? t("reports.allStores") : (store?.name ?? "")}
        actions={
          <>
            <SegmentedControl
              aria-label={t("reports.title")}
              size="sm"
              value={range}
              onChange={setRange}
              options={(Object.keys(rangeDays) as (keyof typeof rangeDays)[]).map((k) => ({
                value: k,
                label: t(RANGE_LABEL_KEY[k]),
              }))}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() =>
                void downloadPdf({
                  filename: `storq-business-report-${fileStamp()}`,
                  title: t("reports.title"),
                  business: business?.name,
                  subtitle: t("reports.subtitle", {
                    scope: all ? t("reports.allStores") : (store?.name ?? ""),
                    range: t(RANGE_LABEL_KEY[range]),
                  }),
                  badge: t("reports.badgePl"),
                  kpis: [
                    [t("reports.netSales"), money(r.revenue)],
                    [t("reports.grossProfit"), money(r.gross)],
                    [t("reports.expenses"), money(r.expTotal)],
                    [t("reports.netProfit"), money(r.net)],
                  ],
                  sections: [
                    {
                      type: "pairs",
                      heading: t("reports.profitLoss"),
                      rows: [
                        [t("reports.netSalesAfterRefunds"), money(r.revenue)],
                        [t("reports.refunds"), `-${money(r.refunds)}`],
                        [t("reports.buyingCostSold"), `-${money(r.cogs)}`],
                        [t("reports.grossProfit"), money(r.gross)],
                        [t("reports.grossMargin"), `${r.margin.toFixed(1)}%`],
                        [t("reports.operatingExpenses"), `-${money(r.expTotal)}`],
                        [t("reports.netProfit"), money(r.net)],
                      ],
                    },
                    {
                      type: "pairs",
                      heading: t("reports.taxSummary"),
                      rows: [
                        [t("reports.salesInclTax"), money(r.revenue)],
                        [t("reports.vatCollected"), money(r.tax)],
                        [t("reports.salesExclTax"), money(r.revenue - r.tax)],
                      ],
                    },
                    {
                      type: "pairs",
                      heading: t("reports.tillCheck"),
                      rows: [
                        [t("reports.cashFromSales"), money(r.cashIn)],
                        [t("reports.cashPaidOut"), `-${money(r.tillOut)}`],
                        [t("reports.expectedCash"), money(r.cashIn - r.tillOut)],
                      ],
                    },
                    {
                      type: "table",
                      heading: t("reports.salesByMethod"),
                      head: [t("reports.thMethod"), t("reports.thAmount")],
                      align: ["left", "right"],
                      body: Object.entries(r.byMethod).map(([m, v]) => [m, money(v)]),
                    },
                    {
                      type: "table",
                      heading: t("reports.expByCategory"),
                      head: [t("reports.thCategory"), t("reports.thAmount")],
                      align: ["left", "right"],
                      body: Object.entries(r.exByCat)
                        .sort((a, b) => b[1] - a[1])
                        .map(([c, v]) => [c, money(v)]),
                    },
                    {
                      type: "table",
                      heading: t("reports.itemPerf"),
                      head: [
                        t("reports.thItem"),
                        t("reports.thQty"),
                        t("reports.thSales"),
                        t("reports.thProfit"),
                        t("reports.thMargin"),
                      ],
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
                      heading: t("reports.staffPerf"),
                      head: [t("reports.thStaff"), t("reports.thSales"), t("reports.thRevenue")],
                      align: ["left", "right", "right"],
                      body: Object.entries(r.byStaff).map(([id, v]) => [
                        names.data?.[id] ?? t("reports.unknownStaff"),
                        v.sales,
                        money(v.revenue),
                      ]),
                    },
                    ...(all
                      ? [
                          {
                            type: "table" as const,
                            heading: t("reports.stores"),
                            head: [
                              t("reports.thStore"),
                              t("reports.thSales"),
                              t("reports.thProfit"),
                              t("reports.thExpenses"),
                              t("reports.thNet"),
                            ],
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
              {t("reports.downloadPdf")}
            </Button>
            {stores.length > 1 && (
              <Button
                size="sm"
                variant={all ? "secondary" : "outline"}
                aria-pressed={all}
                onClick={() => setAll(!all)}
              >
                {t("reports.allStores")}
              </Button>
            )}
          </>
        }
      />
      {loading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {t("reports.loading")}
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="grid divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              <Stat
                k={t("reports.netSales")}
                v={money(r.revenue)}
                sub={t("reports.statSalesSub", { count: r.count, refunds: money(r.refunds) })}
              />
              <Stat
                k={t("reports.buyingCost")}
                v={`− ${money(r.cogs)}`}
                sub={t("reports.costOfItemsSold")}
              />
              <Stat
                k={t("reports.grossProfit")}
                v={money(r.gross)}
                sub={t("reports.marginSub", { margin: r.margin.toFixed(1) })}
              />
              <Stat
                k={t("reports.expenses")}
                v={`− ${money(r.expTotal)}`}
                sub={t("reports.categoriesSub", { count: Object.keys(r.exByCat).length })}
              />
              <Stat
                k={t("reports.netProfit")}
                v={money(r.net)}
                sub={t("reports.whatYouKeep")}
                strong
                tone={r.net >= 0 ? "pos" : "neg"}
              />
            </div>
          </Card>

          <Panel title={range === "today" ? t("reports.byHour") : t("reports.byDay")}>
            <ProfitTrendChart data={trend} money={money} />
          </Panel>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Panel title={t("reports.tillCheck")}>
              <Row k={t("reports.cashFromSales")} v={money(r.cashIn)} />
              <Row k={t("reports.cashPaidOut")} v={`− ${money(r.tillOut)}`} />
              <Row k={t("reports.expectedCash")} v={money(r.cashIn - r.tillOut)} bold />
            </Panel>
            <Panel title={t("reports.taxSummary")}>
              <Row k={t("reports.salesInclTax")} v={money(r.revenue)} />
              <Row k={t("reports.vatCollected")} v={money(r.tax)} />
              <Row k={t("reports.salesExclTax")} v={money(r.revenue - r.tax)} bold />
            </Panel>
            <Panel title={t("reports.salesByMethod")}>
              <PaymentMethods data={methodSlices} money={money} />
            </Panel>
            <Panel title={t("reports.expByCategory")}>
              {expSlices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.noExpenses")}</p>
              ) : (
                <HBarsChart data={expSlices} money={money} />
              )}
            </Panel>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title={t("reports.topItems")}>
              {itemSlices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.noItemsSold")}</p>
              ) : (
                <HBarsChart data={itemSlices} money={money} />
              )}
            </Panel>
            <div className="space-y-3">
              <Panel title={t("reports.staffRevenue")}>
                {staffSlices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("reports.noSales")}</p>
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
                <Panel title={t("reports.lowMargin")}>
                  {r.lowMargin.map((i) => (
                    <Row
                      key={i.name}
                      k={i.name}
                      v={`${((i.profit / i.revenue) * 100).toFixed(0)}%`}
                    />
                  ))}
                  <p className="mt-2 text-xs text-muted-foreground">{t("reports.lowMarginNote")}</p>
                </Panel>
              )}
            </div>
          </div>

          {all && stores.length > 1 && (
            <Panel title={t("reports.netByStore")}>
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
          <p className="text-xs text-muted-foreground">{t("reports.footerNote")}</p>
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
    <div
      className={cn(
        "min-w-0 p-4",
        strong && (tone === "neg" ? "bg-destructive-soft" : "bg-secondary/50"),
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {k}
      </div>
      <div
        className={cn(
          "font-display tabular mt-1.5 truncate text-2xl font-medium",
          tone === "neg" && "text-destructive",
          tone === "pos" && "text-success",
        )}
      >
        {v}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0 text-[13px]">{children}</CardContent>
    </Card>
  );
}
function Row({ k, v, bold }: { k: React.ReactNode; v: string; bold?: boolean }) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 text-[13px]",
        bold && "border-t pt-2 font-semibold",
      )}
    >
      <span className="min-w-0 truncate text-muted-foreground">{k}</span>
      <span className="tabular shrink-0 whitespace-nowrap">{v}</span>
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
    <div className="min-w-0 text-[13px]">
      <div className="flex justify-between gap-3">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular shrink-0 whitespace-nowrap">{text}</span>
      </div>
      <Progress value={max ? (value / max) * 100 : 0} className="mt-1 h-1.5" />
    </div>
  );
}
