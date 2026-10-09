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
} from "@hugeicons/core-free-icons";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { useSaleItemCosts, useSales } from "@/lib/sales";
import { useExpenses } from "@/lib/expenses";
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
      { title: "Dashboard — Storq" },
      { name: "description", content: "Sales, expenses, profit and alerts at a glance." },
      { property: "og:title", content: "Dashboard — Storq" },
      { property: "og:description", content: "Sales, expenses, profit and alerts at a glance." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Dashboard,
});

const DONE = ["completed", "layby_completed"];

function Dashboard() {
  const { store, money, can } = usePos();
  const [range, setRange] = useState<RangeKey>("today");
  const start = useMemo(() => rangeStart(range), [range]);
  const hourly = isHourly(range);
  // One fetch covers the widest filter (this week or this month, whichever starts earlier), so
  // toggling Today / This week / This month re-bins the rows already in memory instead of
  // leaving every chart on "no activity" while a new query resolves.
  const since = dashboardSince();
  const storeId = store?.id;

  const sales = useSales("dash", { storeId, since });
  const expenses = useExpenses({ storeId, since });
  const seesProfit = can("admin", "manager");
  // Buying costs are gated to managers/admins; cashiers never fetch them.
  const costs = useSaleItemCosts(seesProfit ? sales.data : undefined);
  const loading = sales.isPending || expenses.isPending;

  // Alerts: pending invoices, open laybys, low stock
  const alerts = useQuery({
    queryKey: ["dash-alerts", storeId, store?.store_type, can("admin", "manager")],
    enabled: !!storeId,
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
            text: `${pend.count} invoice${pend.count === 1 ? "" : "s"} waiting for approval`,
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
          text: `${lay.count} open layby${lay.count === 1 ? "" : "s"} with balances due`,
          to: "/app/laybys",
          tone: "info",
        });
      {
        const { data: low } = await supabase
          .from("store_stock")
          .select("qty, products(name)")
          .eq("store_id", storeId)
          .lte("qty", 5)
          .limit(5);
        for (const r of low ?? []) {
          const name = (r as { products?: { name?: string } | null }).products?.name ?? "Item";
          out.push({
            icon: MoneyBag02Icon,
            text: `Low stock: ${name} (${Number((r as { qty: number }).qty)} left)`,
            to: can("admin", "manager") ? "/app/inventory" : "/app/stocktake",
            tone: "warn",
          });
        }
      }
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
      for (const i of s.sale_items) cogs += Number(i.qty) * Number(costs.data?.[i.id] ?? 0);
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
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    };
  }, [sales.data, expenses.data, costs.data, start, hourly]);

  const cards = [
    {
      label: "Sales",
      value: money(d.revenue),
      sub: `${d.count} sale${d.count === 1 ? "" : "s"}`,
      icon: ChartLineData01Icon,
    },
    { label: "Expenses", value: money(d.expTotal), sub: "All sources", icon: BanknoteIcon },
    ...(seesProfit
      ? [
          {
            label: "Gross profit",
            value: money(d.gross),
            sub: "Sales minus cost of goods",
            icon: MoneyBag02Icon,
          },
          { label: "Net profit", value: money(d.net), sub: "After expenses", icon: Wallet01Icon },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub={store?.name ?? ""}
        actions={<RangeToggle value={range} onChange={setRange} options={ranges} />}
      />

      {/* Top stat cards */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub} icon={c.icon} />
        ))}
      </div>

      {/* Trend chart */}
      <div className="mt-4">
        <DashboardSection
          title={hourly ? "Sales vs expenses by hour" : "Sales vs expenses by day"}
          note={`${ranges.find((r) => r.key === range)?.label} · ${rangeSpanLabel(start)}`}
        >
          <TrendChart data={d.trend} money={money} loading={loading} />
        </DashboardSection>
      </div>

      {/* Bottom row: payment methods + notifications */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DashboardSection title="Payment methods" note="How customers paid">
          <PaymentMethods data={d.pie} money={money} loading={loading} />
        </DashboardSection>

        <DashboardSection
          title="Notifications"
          icon={Notification01Icon}
          note="Needs your attention"
        >
          <div className="space-y-1.5">
            {(alerts.data ?? []).length === 0 ? (
              <EmptyState>All clear — nothing needs attention right now.</EmptyState>
            ) : (
              (alerts.data ?? []).map((a, i) => <AlertRow key={i} item={a} />)
            )}
          </div>
          {!can("admin", "manager") && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Profit figures are visible to owners and managers only on the Reports page.
            </p>
          )}
        </DashboardSection>
      </div>
    </div>
  );
}
