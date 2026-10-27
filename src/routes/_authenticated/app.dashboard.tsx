import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert02Icon,
  BanknoteIcon,
  ChartLineData01Icon,
  MoneyBag02Icon,
  Notification01Icon,
  Wallet01Icon,
} from "@/lib/icons";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { useSaleItemCosts, useSales } from "@/lib/sales";
import { useExpenses } from "@/lib/expenses";
import { methodLabel } from "@/lib/payment-methods";
import { useLowStock } from "@/lib/transfers";
import {
  buildTrend,
  dashboardSince,
  isHourly,
  localDateKey,
  rangeSpanLabel,
  rangeStart,
  ranges,
  type RangeKey,
} from "@/lib/trend";
import { PageHeader } from "@/components/pos/bits";
import {
  AlertRow,
  DashboardSection,
  EmptyState,
  PaymentMethods,
  RangeToggle,
  StatCard,
  TrendChart,
  type AlertItem,
} from "@/components/dashboard";

export const Route = createFileRoute("/_authenticated/app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | Storq" },
      { name: "description", content: "Sales, expenses, profit and alerts at a glance." },
      { property: "og:title", content: "Dashboard | Storq" },
      { property: "og:description", content: "Sales, expenses, profit and alerts at a glance." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Dashboard,
});

const RANGE_LABEL_KEY: Record<RangeKey, string> = {
  today: "dashboard.rangeToday",
  week: "dashboard.rangeWeek",
  month: "dashboard.rangeMonth",
};

const DONE = ["completed", "layby_completed"];

function Dashboard() {
  const { t, locale } = useI18n();
  const { store, money, compactMoney, can } = usePos();
  const [range, setRange] = useState<RangeKey>("today");
  const start = useMemo(() => rangeStart(range), [range]);
  const hourly = isHourly(range);
  // One fetch covers the widest filter (this week or this month, whichever starts earlier), so
  // toggling Today / This week / This month re-bins the rows already in memory instead of
  // leaving every chart on "no activity" while a new query resolves.
  const since = dashboardSince();
  const storeId = store?.id;
  // Approval stores read their numbers as invoices; direct stores as sales.
  const approval = store?.store_type === "approval";

  // Buying costs (and therefore the nested sale_items join) are gated to
  // whoever may read the money numbers. A session without money access only
  // needs parent totals, so we skip the item join entirely instead of pulling
  // sale_items for up to 1000 sales.
  const seesProfit = can("money", "view_money");
  const sales = useSales("dash", { storeId, since, items: seesProfit });
  const expenses = useExpenses({ storeId, since });
  const costs = useSaleItemCosts(seesProfit ? sales.data : undefined);
  const loading = sales.isPending || expenses.isPending;

  // Alerts: pending invoices, open laybys, low stock
  const alerts = useQuery({
    queryKey: ["dash-alerts", storeId, store?.store_type, can("money", "view_money"), locale],
    enabled: !!storeId,
    // The feed is in SALE_TOUCHED and invalidated by every stock write, so it
    // can stay cached across remounts rather than re-running its count queries.
    staleTime: 60_000,
    queryFn: async () => {
      const out: AlertItem[] = [];
      if (!storeId) return out;
      if (store?.store_type === "approval") {
        const pend = await supabase
          .from("sales")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .eq("status", "pending_approval");
        if (pend.error) throw pend.error;
        if ((pend.count ?? 0) > 0)
          out.push({
            icon: Alert02Icon,
            text: t("dashboard.alertInvoices", { count: pend.count ?? 0 }),
            to: "/app/invoices",
            tone: "warn",
          });
      }
      const lay = await supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("status", "layby_open");
      if (lay.error) throw lay.error;
      if ((lay.count ?? 0) > 0)
        out.push({
          icon: Wallet01Icon,
          text: t("dashboard.alertLaybys", { count: lay.count ?? 0 }),
          to: "/app/laybys",
          tone: "info",
        });
      // Low stock is not repeated here: the "Needs reorder" card below lists the
      // same items against each product's own reorder point, so a second feed
      // built on a fixed "5 units" threshold only disagreed with it.
      return out;
    },
  });

  const d = useMemo(() => {
    const from = start.getTime();
    const fromDay = localDateKey(start);
    const rows = (sales.data ?? []).filter(
      (s) => DONE.includes(s.status) && new Date(s.created_at).getTime() >= from,
    );
    const ex = (expenses.data ?? []).filter((e) => localDateKey(e.spent_on) >= fromDay);
    let revenue = 0,
      cogs = 0;
    const byMethod: Record<string, number> = {};
    for (const s of rows) {
      revenue += Number(s.total);
      for (const i of s.sale_items ?? []) cogs += Number(i.qty) * Number(costs.data?.[i.id] ?? 0);
      byMethod[s.payment_method ?? "cash"] =
        (byMethod[s.payment_method ?? "cash"] ?? 0) + Number(s.total);
    }
    let expTotal = 0;
    for (const e of ex) expTotal += Number(e.amount);
    const gross = revenue - cogs;
    return {
      revenue,
      expTotal,
      gross,
      net: gross - expTotal,
      count: rows.length,
      trend: buildTrend({ start, hourly, sales: rows, expenses: ex }),
      pie: Object.entries(byMethod)
        .map(([name, value]) => ({ name, value, label: methodLabel(name) }))
        .sort((a, b) => b.value - a.value),
    };
  }, [sales.data, expenses.data, costs.data, start, hourly]);

  const cards = [
    {
      label: t(approval ? "dashboard.salesApproval" : "dashboard.sales"),
      value: money(d.revenue),
      sub: t(approval ? "dashboard.salesCountApproval" : "dashboard.salesCount", {
        count: d.count,
      }),
      icon: ChartLineData01Icon,
    },
    {
      label: t("dashboard.expenses"),
      value: money(d.expTotal),
      sub: t("dashboard.allSources"),
      icon: BanknoteIcon,
    },
    ...(seesProfit
      ? [
          {
            label: t("dashboard.grossProfit"),
            value: money(d.gross),
            sub: t("dashboard.grossProfitSub"),
            icon: MoneyBag02Icon,
          },
          {
            label: t("dashboard.netProfit"),
            value: money(d.net),
            sub: t("dashboard.netProfitSub"),
            icon: Wallet01Icon,
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={t("dashboard.title")}
        sub={store?.name ?? ""}
        actions={
          <RangeToggle
            value={range}
            onChange={setRange}
            options={ranges.map((r) => ({ key: r.key, label: t(RANGE_LABEL_KEY[r.key]) }))}
          />
        }
      />

      {/* Top stat cards */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub} icon={c.icon} />
        ))}
      </div>

      {/* Trend chart */}
      <div className="mt-4">
        <DashboardSection
          title={hourly ? t("dashboard.byHour") : t("dashboard.byDay")}
          note={`${t(RANGE_LABEL_KEY[range])} · ${rangeSpanLabel(start)}`}
        >
          <TrendChart data={d.trend} money={money} compact={compactMoney} loading={loading} />
        </DashboardSection>
      </div>

      {/* Bottom row: payment methods + notifications */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DashboardSection
          title={t("dashboard.paymentMethods")}
          note={t("dashboard.paymentMethodsNote")}
        >
          <PaymentMethods data={d.pie} money={money} loading={loading} />
        </DashboardSection>

        <DashboardSection
          title={t("dashboard.notifications")}
          icon={Notification01Icon}
          note={t("dashboard.notificationsNote")}
        >
          <div className="space-y-1.5">
            {(alerts.data ?? []).length === 0 ? (
              <EmptyState>{t("dashboard.allClear")}</EmptyState>
            ) : (
              (alerts.data ?? []).map((a, i) => <AlertRow key={i} item={a} />)
            )}
          </div>
          {!can("money", "view_money") && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("dashboard.profitVisibilityNote")}
            </p>
          )}
        </DashboardSection>
      </div>

      <div className="mt-4">
        <NeedsReorder storeId={storeId} />
      </div>
    </div>
  );
}

// Self-sufficient reorder card: fetches its own low-stock read and only appears
// for the roles that manage inventory. Replaces the old fixed "5 units" guess
// with each product's own reorder point.
function NeedsReorder({ storeId }: { storeId?: string | undefined }) {
  const { t } = useI18n();
  const { can } = usePos();
  const low = useLowStock(storeId);
  if (!can("stock", "view_stock") || !storeId) return null;
  const rows = low.data ?? [];
  return (
    <DashboardSection
      title={t("dashboard.needsReorder")}
      icon={Alert02Icon}
      note={t("dashboard.reorderNote", { count: rows.length })}
    >
      <div className="space-y-1.5">
        {low.isPending ? (
          <EmptyState>{t("dashboard.checkingStock")}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>{t("dashboard.nothingBelowReorder")}</EmptyState>
        ) : (
          rows.slice(0, 8).map((r) => (
            <AlertRow
              key={r.product_id}
              item={{
                icon: MoneyBag02Icon,
                text: t("dashboard.reorderLine", {
                  name: r.name,
                  qty: r.qty,
                  point: r.reorder_point,
                }),
                to: "/app/inventory",
                tone: "warn",
              }}
            />
          ))
        )}
      </div>
    </DashboardSection>
  );
}
