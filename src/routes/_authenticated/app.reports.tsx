import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { useSaleItemCosts, useSales } from "@/lib/sales";
import { rangeDays, sinceFor, useExpenses } from "@/lib/expenses";
import { useProducts, useStock } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PageHeader } from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { downloadPdf, fileStamp } from "@/lib/pdf";
import { useRefunds } from "@/lib/refunds";
import { methodLabel } from "@/lib/receipts";
import { buildBusinessReport } from "@/lib/business-report";

export const Route = createFileRoute("/_authenticated/app/reports")({
  head: () => ({
    meta: [
      { title: "Business report | Storq" },
      { name: "description", content: "A plain-language profit statement for your stores." },
      { property: "og:title", content: "Business report | Storq" },
      { property: "og:description", content: "A plain-language profit statement for your stores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Reports,
});

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
  const refundsQ = useRefunds({ storeId, since });
  const costs = useSaleItemCosts(sales.data);
  // The dead-stock table only renders in single-store mode (it no-ops when
  // `all` is set), so the catalog is scoped to the store whose stock is shown.
  const products = useProducts(store?.id);
  const stock = useStock(all ? undefined : store?.id);

  const r = useMemo(
    () =>
      buildBusinessReport({
        sales: sales.data ?? [],
        refunds: refundsQ.data ?? [],
        expenses: expenses.data ?? [],
        costs: costs.data ?? {},
      }),
    [sales.data, refundsQ.data, expenses.data, costs.data],
  );

  const dead = useMemo(() => {
    if (all || !stock.data) return [];
    return (products.data ?? [])
      .filter((p) => p.active && (stock.data[p.id] ?? 0) > 0 && !r.soldKeys.has(p.id))
      .map((p) => ({
        name: p.name,
        qty: stock.data[p.id] ?? 0,
        value: (stock.data[p.id] ?? 0) * p.price,
      }))
      .sort((a, b) => b.value - a.value);
  }, [all, stock.data, products.data, r]);

  const methods = Object.entries(r.byMethod).sort((a, b) => b[1] - a[1]);
  const cashSales = r.byMethod["cash"] ?? 0;
  const cats = Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]);
  const top = r.topProfit.filter((i) => i.qty > 0).slice(0, 10);
  const thin = r.lowMargin.filter((i) => i.profit >= 0);
  const scope = all ? t("reports.allStores") : (store?.name ?? "");
  const rangeLabel = t(RANGE_LABEL_KEY[range]);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const profitable = r.realProfit >= 0;
  const perUnit = r.moneyCollected ? (r.realProfit / r.moneyCollected) * 100 : 0;

  if (!can("admin", "manager"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {t("reports.onlyAdmins")}
      </Card>
    );
  const loading = sales.isLoading || expenses.isLoading || refundsQ.isLoading;

  const exportPdf = () =>
    void downloadPdf({
      filename: `storq-business-statement-${fileStamp()}`,
      title: t("bizReport.pdfTitle"),
      business: business?.name,
      subtitle: t("reports.subtitle", { scope, range: rangeLabel }),
      badge: profitable ? t("bizReport.badgeProfit") : t("bizReport.badgeLoss"),
      meta: [
        [t("bizReport.pdfPeriod"), rangeLabel],
        [t("bizReport.pdfScope"), scope],
        [t("bizReport.pdfCurrency"), business?.currency ?? ""],
        [t("bizReport.pdfIssued"), new Date().toLocaleDateString("en-ZA", { dateStyle: "medium" })],
      ],
      kpis: [
        [t("bizReport.collected"), money(r.moneyCollected)],
        [t("bizReport.stockCost"), money(r.stockCost)],
        [t("bizReport.expenses"), money(r.expenses)],
        [t("bizReport.realProfit"), money(r.realProfit)],
      ],
      sections: [
        {
          type: "pairs",
          heading: t("bizReport.pdfStatement"),
          rows: [
            [t("bizReport.totalSales"), money(r.grossSales)],
            [`  - ${t("bizReport.refunds")}`, `-${money(r.refunds)}`],
            [`= ${t("bizReport.collected")}`, money(r.moneyCollected)],
            [`  - ${t("bizReport.stockCost")}`, `-${money(r.stockCost)}`],
            [
              `= ${t("bizReport.productProfit").replace(/\s*\(.*$/, "")} (${pct(r.productMargin)})`,
              money(r.productProfit),
            ],
            [`  - ${t("bizReport.expenses")}`, `-${money(r.expenses)}`],
            [`= ${t("bizReport.realProfit")} (${pct(r.realMargin)})`, money(r.realProfit)],
          ],
        },
        ...(r.belowCost.length
          ? [
              {
                type: "table" as const,
                heading: t("bizReport.belowCost"),
                head: [
                  t("bizReport.thItem"),
                  t("bizReport.thSold"),
                  t("bizReport.thSales"),
                  t("bizReport.stockCost"),
                  t("bizReport.moneyLost"),
                ],
                align: ["left", "right", "right", "right", "right"] as ("left" | "right")[],
                body: r.belowCost.map((i) => [
                  i.name,
                  i.qty,
                  money(i.revenue),
                  money(i.cost),
                  money(i.profit),
                ]),
                foot: [t("bizReport.belowCostTotal"), "", "", "", money(r.belowCostLoss)],
              },
            ]
          : []),
        {
          type: "table",
          heading: t("bizReport.pdfMoney"),
          head: [t("reports.thMethod"), t("reports.thAmount")],
          align: ["left", "right"],
          body: methods.map(([m, v]) => [methodLabel(m), money(v)]),
          foot: [t("bizReport.totalSales"), money(r.grossSales)],
        },
        {
          type: "pairs",
          heading: t("reports.tillCheck"),
          rows: [
            [t("reports.cashFromSales"), money(cashSales)],
            [t("reports.cashPaidOut"), `-${money(r.tillExpenses)}`],
            [t("bizReport.cashTill"), money(cashSales - r.tillExpenses)],
            [t("bizReport.vat"), money(r.tax)],
          ],
        },
        {
          type: "table",
          heading: t("bizReport.profitMakers"),
          head: [
            t("bizReport.thItem"),
            t("bizReport.thSold"),
            t("bizReport.thSales"),
            t("bizReport.thProfit"),
            t("bizReport.thMargin"),
          ],
          align: ["left", "right", "right", "right", "right"],
          body: top.map((i) => [
            i.name,
            i.qty,
            money(i.revenue),
            money(i.profit),
            i.revenue ? pct((i.profit / i.revenue) * 100) : "-",
          ]),
        },
        ...(cats.length
          ? [
              {
                type: "table" as const,
                heading: t("bizReport.spending"),
                head: [t("reports.thCategory"), t("reports.thAmount")],
                align: ["left", "right"] as ("left" | "right")[],
                body: cats.map(([c, v]) => [c, money(v)]),
              },
            ]
          : []),
        ...(all && stores.length > 1
          ? [
              {
                type: "table" as const,
                heading: t("bizReport.storesTitle"),
                head: [
                  t("bizReport.thStore"),
                  t("bizReport.collected"),
                  t("bizReport.stockCost"),
                  t("bizReport.expenses"),
                  t("bizReport.realProfit"),
                ],
                align: ["left", "right", "right", "right", "right"] as ("left" | "right")[],
                body: stores.map((s) => {
                  const v = r.byStore[s.id] ?? { sales: 0, stockCost: 0, expenses: 0 };
                  return [
                    s.name,
                    money(v.sales),
                    money(v.stockCost),
                    money(v.expenses),
                    money(v.sales - v.stockCost - v.expenses),
                  ];
                }),
              },
            ]
          : []),
        { type: "text", text: t("bizReport.pdfNote") },
        { type: "text", heading: " ", text: t("bizReport.pdfSignoff") },
      ],
    });

  const steps: { k: string; hint: string; v: number; sign: "" | "-" | "="; strong?: boolean }[] = [
    {
      k: t("bizReport.totalSales"),
      hint: t("bizReport.totalSalesHint", { count: r.orders }),
      v: r.grossSales,
      sign: "",
    },
    { k: t("bizReport.refunds"), hint: t("bizReport.refundsHint"), v: r.refunds, sign: "-" },
    {
      k: t("bizReport.collected"),
      hint: t("bizReport.collectedHint"),
      v: r.moneyCollected,
      sign: "=",
    },
    { k: t("bizReport.stockCost"), hint: t("bizReport.stockCostHint"), v: r.stockCost, sign: "-" },
    {
      k: t("bizReport.productProfit"),
      hint: t("bizReport.productProfitHint", { margin: r.productMargin.toFixed(0) }),
      v: r.productProfit,
      sign: "=",
    },
    { k: t("bizReport.expenses"), hint: t("bizReport.expensesHint"), v: r.expenses, sign: "-" },
    {
      k: t("bizReport.realProfit"),
      hint: t("bizReport.realProfitHint", { margin: r.realMargin.toFixed(0) }),
      v: r.realProfit,
      sign: "=",
      strong: true,
    },
  ];
  const base = Math.max(r.grossSales, 1);

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.reports")} / ${t("nav.overview")}`}
        title={t("reports.title")}
        sub={scope}
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
            <Button size="sm" disabled={loading} onClick={exportPdf}>
              {t("reports.downloadPdf")}
            </Button>
          </>
        }
      />
      {loading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {t("reports.loading")}
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Verdict */}
          <Card className={cn("p-5", profitable ? "bg-secondary/50" : "bg-destructive-soft")}>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {profitable ? t("bizReport.profitTitle") : t("bizReport.lossTitle")}
            </div>
            <div
              className={cn(
                "font-display tabular mt-1 text-4xl font-medium",
                !profitable && "text-destructive",
              )}
            >
              {money(r.realProfit)}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("bizReport.verdict", {
                collected: money(r.moneyCollected),
                profit: money(r.realProfit),
                per: money(perUnit),
                unit: money(100),
              })}
            </p>
          </Card>

          {r.belowCost.length > 0 && (
            <Card className="border-destructive/40 bg-destructive-soft p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-destructive">
                {t("bizReport.belowCost")}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("bizReport.belowCostSub")}</p>
              <div className="mt-3">
                <Table
                  head={[
                    t("bizReport.thItem"),
                    t("bizReport.thSold"),
                    t("bizReport.thSales"),
                    t("bizReport.stockCost"),
                    t("bizReport.moneyLost"),
                  ]}
                  rows={r.belowCost.map((i) => [
                    i.name,
                    String(i.qty),
                    money(i.revenue),
                    money(i.cost),
                    money(i.profit),
                  ])}
                />
              </div>
              <Row k={t("bizReport.belowCostTotal")} v={money(r.belowCostLoss)} bold />
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            {/* Bottom line statement */}
            <Panel
              title={t("bizReport.bottomLine")}
              sub={t("bizReport.bottomLineSub", { money: money(100) })}
            >
              <div className="divide-y">
                {steps.map((s) => (
                  <div
                    key={s.k}
                    className={cn("py-2.5", s.strong && "rounded-md bg-primary/20 px-3")}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className={cn(
                            "text-sm",
                            s.sign === "=" ? "font-semibold" : "text-foreground",
                          )}
                        >
                          <span className="mr-2 inline-block w-3 text-muted-foreground">
                            {s.sign === "" ? "" : s.sign === "-" ? "−" : "="}
                          </span>
                          {s.k}
                        </div>
                        <div className="ml-5 text-xs text-muted-foreground">{s.hint}</div>
                      </div>
                      <div
                        className={cn(
                          "tabular shrink-0 whitespace-nowrap",
                          s.sign === "=" ? "text-base font-semibold" : "text-sm",
                          s.strong && s.v < 0 && "text-destructive",
                        )}
                      >
                        {s.sign === "-" ? `− ${money(s.v)}` : money(s.v)}
                      </div>
                    </div>
                    <Progress
                      value={Math.max(0, Math.min(100, (s.v / base) * 100))}
                      className="ml-5 mt-1.5 h-1"
                    />
                  </div>
                ))}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel title={t("bizReport.whereMoney")} sub={t("bizReport.whereMoneySub")}>
                {methods.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("reports.noSales")}</p>
                ) : (
                  methods.map(([m, v]) => <Row key={m} k={methodLabel(m)} v={money(v)} />)
                )}
                <Row k={t("bizReport.cashTill")} v={money(cashSales - r.tillExpenses)} bold />
                <p className="text-xs text-muted-foreground">{t("bizReport.cashTillHint")}</p>
              </Panel>
              <Panel title={t("bizReport.quickFacts")}>
                <Row k={t("bizReport.orders")} v={String(r.orders)} />
                <Row k={t("bizReport.avgSale")} v={money(r.avgSale)} />
                <Row k={t("bizReport.units")} v={String(r.unitsSold)} />
                <Row k={t("bizReport.vat")} v={money(r.tax)} />
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("bizReport.profitMakers")} sub={t("bizReport.profitMakersSub")}>
              {top.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.noItemsSold")}</p>
              ) : (
                <Table
                  head={[
                    t("bizReport.thItem"),
                    t("bizReport.thSold"),
                    t("bizReport.thProfit"),
                    t("bizReport.thMargin"),
                  ]}
                  rows={top.map((i) => [
                    i.name,
                    String(i.qty),
                    money(i.profit),
                    i.revenue ? pct((i.profit / i.revenue) * 100) : "-",
                  ])}
                />
              )}
            </Panel>
            <Panel title={t("bizReport.deadStock")} sub={t("bizReport.deadStockSub")}>
              {all ? (
                <p className="text-sm text-muted-foreground">{t("bizReport.deadStockAll")}</p>
              ) : dead.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("bizReport.noDead")}</p>
              ) : (
                <Table
                  head={[t("bizReport.thItem"), t("bizReport.thInStock"), t("bizReport.thSales")]}
                  rows={dead.slice(0, 10).map((d) => [d.name, String(d.qty), money(d.value)])}
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("bizReport.spending")}>
              {cats.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.noExpenses")}</p>
              ) : (
                cats.map(([c, v]) => <Row key={c} k={c} v={money(v)} />)
              )}
            </Panel>
            {thin.length > 0 && (
              <Panel title={t("bizReport.lowMargin")} sub={t("bizReport.lowMarginSub")}>
                {thin.map((i) => (
                  <Row key={i.key} k={i.name} v={pct((i.profit / i.revenue) * 100)} />
                ))}
              </Panel>
            )}
          </div>

          {all && stores.length > 1 && (
            <Panel title={t("bizReport.storesTitle")}>
              <Table
                head={[
                  t("bizReport.thStore"),
                  t("bizReport.collected"),
                  t("bizReport.expenses"),
                  t("bizReport.realProfit"),
                ]}
                rows={stores.map((s) => {
                  const v = r.byStore[s.id] ?? { sales: 0, stockCost: 0, expenses: 0 };
                  return [
                    s.name,
                    money(v.sales),
                    money(v.expenses),
                    money(v.sales - v.stockCost - v.expenses),
                  ];
                })}
              />
            </Panel>
          )}
          <p className="text-xs text-muted-foreground">{t("bizReport.pdfNote")}</p>
        </div>
      )}
    </>
  );
}

function Panel({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-sm font-medium">{title}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
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
function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={cn("pb-1.5 font-medium", i === 0 ? "text-left" : "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <td
                key={i}
                className={cn(
                  "py-1.5",
                  i === 0 ? "max-w-0 truncate text-left" : "tabular text-right whitespace-nowrap",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
