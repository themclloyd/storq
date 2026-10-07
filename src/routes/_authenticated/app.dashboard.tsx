import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon, BanknoteIcon, ChartLineData01Icon, MoneyBag02Icon, Notification01Icon, Wallet01Icon,
} from "@hugeicons/core-free-icons";
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { useSales } from "@/lib/sales";
import { useExpenses } from "@/lib/expenses";
import { PageHeader } from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Storq" }, { name: "description", content: "Sales, expenses, profit and alerts at a glance." }, { property: "og:title", content: "Dashboard — Storq" }, { property: "og:description", content: "Sales, expenses, profit and alerts at a glance." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Dashboard,
});

const DONE = ["completed", "layby_completed"];
const ranges = [
  { key: "today", label: "Today", days: 0 },
  { key: "week", label: "This week", days: 7 },
  { key: "month", label: "This month", days: 30 },
] as const;
type RangeKey = (typeof ranges)[number]["key"];

function sinceDays(days: number) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days); return d.toISOString();
}

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Dashboard() {
  const { store, money, can } = usePos();
  const [range, setRange] = useState<RangeKey>("today");
  const days = ranges.find((r) => r.key === range)?.days ?? 0;
  const since = useMemo(() => sinceDays(days), [days]);
  const storeId = store?.id;

  const sales = useSales("dash", { storeId, since });
  const expenses = useExpenses({ storeId, since });

  // Alerts: pending invoices, open laybys, low stock
  const alerts = useQuery({
    queryKey: ["dash-alerts", storeId, store?.store_type, can("admin", "manager")],
    enabled: !!storeId,
    queryFn: async () => {
      const out: { icon: typeof Alert02Icon; text: string; to: string; tone: "warn" | "info" }[] = [];
      if (!storeId) return out;
      if (store?.store_type === "approval") {
        const pend = await supabase.from("sales").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "pending_approval");
        if (pend.error) throw pend.error;
        if ((pend.count ?? 0) > 0) out.push({ icon: Alert02Icon, text: `${pend.count} invoice${pend.count === 1 ? "" : "s"} waiting for approval`, to: "/app/invoices", tone: "warn" });
      }
      const lay = await supabase.from("sales").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("status", "layby_open");
      if (lay.error) throw lay.error;
      if ((lay.count ?? 0) > 0) out.push({ icon: Wallet01Icon, text: `${lay.count} open layby${lay.count === 1 ? "" : "s"} with balances due`, to: "/app/laybys", tone: "info" });
      if (storeId) {
        const { data: low } = await supabase.from("store_stock").select("qty, products(name)").eq("store_id", storeId).lte("qty", 5).limit(5);
        for (const r of low ?? []) {
          const name = (r as { products?: { name?: string } | null }).products?.name ?? "Item";
          out.push({ icon: MoneyBag02Icon, text: `Low stock: ${name} (${Number((r as { qty: number }).qty)} left)`, to: can("admin", "manager") ? "/app/inventory" : "/app/stocktake", tone: "warn" });
        }
      }
      return out;
    },
  });

  const d = useMemo(() => {
    const rows = (sales.data ?? []).filter((s) => DONE.includes(s.status));
    const ex = expenses.data ?? [];
    let revenue = 0, cogs = 0;
    const byMethod: Record<string, number> = {};
    const byDay: Record<string, { day: string; ts: number; sales: number; expenses: number }> = {};
    const dayKey = (iso: string) => {
      const dt = new Date(iso);
      return days === 0
        ? dt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })
        : dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
    };
    for (const s of rows) {
      revenue += Number(s.total);
      for (const i of s.sale_items) cogs += Number(i.qty) * Number(i.cost ?? 0);
      byMethod[s.payment_method ?? "cash"] = (byMethod[s.payment_method ?? "cash"] ?? 0) + Number(s.total);
      const k = dayKey(s.created_at);
      (byDay[k] ??= { day: k, ts: new Date(s.created_at).getTime(), sales: 0, expenses: 0 }).sales += Number(s.total);
    }
    let expTotal = 0;
    for (const e of ex) {
      expTotal += Number(e.amount);
      const k = dayKey(e.spent_on + "T12:00:00");
      (byDay[k] ??= { day: k, ts: new Date(e.spent_on + "T12:00:00").getTime(), sales: 0, expenses: 0 }).expenses += Number(e.amount);
    }
    const gross = revenue - cogs;
    return {
      revenue, expTotal, gross, net: gross - expTotal, count: rows.length,
      trend: Object.values(byDay).sort((a, b) => a.ts - b.ts),
      pie: Object.entries(byMethod)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    };
  }, [sales.data, expenses.data, days]);

  const cards = [
    { label: "Sales", value: money(d.revenue), sub: `${d.count} sale${d.count === 1 ? "" : "s"}`, icon: ChartLineData01Icon },
    { label: "Expenses", value: money(d.expTotal), sub: "All sources", icon: BanknoteIcon },
    { label: "Gross profit", value: money(d.gross), sub: "Sales minus cost of goods", icon: MoneyBag02Icon },
    { label: "Net profit", value: money(d.net), sub: "After expenses", icon: Wallet01Icon },
  ];
  const pieTotal = d.pie.reduce((a, p) => a + p.value, 0) || 1;

  return (
    <div>
      <PageHeader title="Dashboard" sub={store?.name ?? ""}
        actions={
          <div className="flex gap-0.5 rounded-full border bg-card p-0.5">
            {ranges.map((r) => (
              <Button key={r.key} size="sm" variant="ghost" aria-pressed={range === r.key} onClick={() => setRange(r.key)}
                className={cn("px-2.5 text-[12px] font-medium", range === r.key ? "bg-secondary text-foreground" : "text-muted-foreground")}>
                {r.label}
              </Button>
            ))}
          </div>
        } />

      {/* Top stat cards */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="min-w-0 rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{c.label}</span>
              <HugeiconsIcon icon={c.icon} className="size-[15px] shrink-0 text-accent" />
            </div>
            <div className="mt-1.5 truncate text-base font-semibold tabular">{c.value}</div>
            <div className="truncate text-[11px] text-muted-foreground">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <section className="mt-4 border-y py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold">Sales vs expenses</h3>
          <span className="text-[11px] text-muted-foreground">{ranges.find((r) => r.key === range)?.label}</span>
        </div>
        <div className="mt-2 h-52">
          {d.trend.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">No activity in this period yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.trend} margin={{ left: 0, right: 4, top: 4 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={44} tickCount={5} />
                <Tooltip formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                <Area type="linear" dataKey="sales" name="Sales" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--accent)" }} activeDot={{ r: 4 }} fill="url(#gSales)" />
                <Area type="linear" dataKey="expenses" name="Expenses" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--chart-2)" }} activeDot={{ r: 4 }} fill="url(#gExp)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Bottom row: payment methods + notifications */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 lg:border-r lg:pr-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold">Payment methods</h3>
            <span className="text-[11px] text-muted-foreground">How customers paid</span>
          </div>
          <div className="mt-2 flex min-h-[9rem] items-center gap-4">
            {d.pie.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales in this period.</p>
            ) : (
              <>
                <div className="size-36 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={d.pie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={66} paddingAngle={3} strokeWidth={0}>
                        {d.pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5 text-[13px]">
                  {d.pie.map((p, i) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="min-w-0 flex-1 truncate capitalize text-muted-foreground">{p.name}</span>
                      <span className="tabular w-10 shrink-0 text-right text-muted-foreground">{Math.round((p.value / pieTotal) * 100)}%</span>
                      <span className="tabular w-24 shrink-0 text-right font-semibold">{money(p.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <HugeiconsIcon icon={Notification01Icon} className="size-4 text-accent" />
              <h3 className="text-sm font-bold">Notifications</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">Needs your attention</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {(alerts.data ?? []).length === 0 ? (
              <div className="grid h-24 place-items-center text-sm text-muted-foreground">All clear — nothing needs attention right now.</div>
            ) : (
              (alerts.data ?? []).map((a, i) => (
                <Link key={i} to={a.to} className="flex items-center gap-2.5 rounded-md border p-2 text-[13px] transition-colors hover:bg-secondary">
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", a.tone === "warn" ? "bg-warning/15 text-warning" : "bg-secondary text-foreground")}>
                    <HugeiconsIcon icon={a.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0 truncate font-medium">{a.text}</span>
                </Link>
              ))
            )}
          </div>
          {!can("admin", "manager") && (
            <p className="mt-2 text-[11px] text-muted-foreground">Profit figures are visible to owners and managers only on the Reports page.</p>
          )}
        </section>
      </div>
    </div>
  );
}
