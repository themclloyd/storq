import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart } from "recharts";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useI18n } from "@/lib/i18n";

export type DashIcon = ComponentProps<typeof HugeiconsIcon>["icon"];
export type ProfitTrendPoint = { day: string; sales: number; profit: number };

export type MoneyFmt = (n: number | string | null | undefined) => string;

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Compact stat tile built on the shadcn Card. */
export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: DashIcon;
}) {
  return (
    <Card className="min-w-0 p-3">
      <div className="flex items-center justify-between gap-2">
        <CardDescription className="truncate text-xs">{label}</CardDescription>
        <HugeiconsIcon icon={icon} className="size-[15px] shrink-0 text-accent" />
      </div>
      <CardTitle className="tabular mt-1.5 truncate text-base font-semibold">{value}</CardTitle>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </Card>
  );
}

/** Card wrapper that gives every dashboard section a consistent header. */
export function DashboardSection({
  title,
  note,
  icon,
  children,
  className,
  contentClassName,
}: {
  title: string;
  note?: string | undefined;
  icon?: DashIcon | undefined;
  children: ReactNode;
  className?: string | undefined;
  contentClassName?: string | undefined;
}) {
  return (
    <Card className={cn("p-0", className)}>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0 border-b p-3">
        <CardTitle className="flex items-center gap-1.5 text-sm font-bold">
          {icon && <HugeiconsIcon icon={icon} className="size-4 text-accent" />}
          {title}
        </CardTitle>
        {note && <CardDescription className="text-[11px]">{note}</CardDescription>}
      </CardHeader>
      <CardContent className={cn("p-3", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Pill segmented control (shadcn ToggleGroup) used for the date-range filter. */
export function RangeToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { key: T; label: string }[];
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className="gap-0.5 rounded-full border bg-card p-0.5"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.key}
          value={o.key}
          aria-label={o.label}
          className="rounded-full px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-transparent data-[state=on]:bg-secondary data-[state=on]:text-foreground"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export type TrendPoint = { day: string; sales: number; expenses: number };

/** Trend series are zero-filled across the whole period, so "empty" means every bucket is 0. */
function isFlat(data: { sales: number; expenses?: number; profit?: number }[]) {
  return data.every((p) => !p.sales && !p.expenses && !p.profit);
}

/** Sales-vs-expenses area chart (shadcn ChartContainer + ChartTooltip/ChartLegend). */
export function TrendChart({
  data,
  money,
  loading,
}: {
  data: TrendPoint[];
  money: MoneyFmt;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const config = {
    sales: { label: t("dashboard.sales"), color: "var(--chart-1)" },
    expenses: { label: t("dashboard.expenses"), color: "var(--chart-2)" },
  } satisfies ChartConfig;
  if (loading) return <Skeleton className="h-52 w-full" />;
  if (data.length === 0 || isFlat(data)) {
    return <EmptyState>{t("dashboard.noActivity")}</EmptyState>;
  }
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 4, top: 4 }}>
        <defs>
          <linearGradient id="fillSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-sales)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-sales)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fillExpenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-expenses)" stopOpacity={0.14} />
            <stop offset="100%" stopColor="var(--color-expenses)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickCount={5} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="sales"
          name="sales"
          stroke="var(--color-sales)"
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-sales)" }}
          activeDot={{ r: 4 }}
          fill="url(#fillSales)"
        />
        <Area
          type="monotone"
          dataKey="expenses"
          name="expenses"
          stroke="var(--color-expenses)"
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-expenses)" }}
          activeDot={{ r: 4 }}
          fill="url(#fillExpenses)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

export type MethodSlice = { name: string; value: number };

/** Sales-vs-profit area chart for the business report (same look as TrendChart). */
export function ProfitTrendChart({
  data,
  money,
  loading,
}: {
  data: ProfitTrendPoint[];
  money: MoneyFmt;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const config = {
    sales: { label: t("dashboard.sales"), color: "var(--chart-1)" },
    profit: { label: t("dashboard.profit"), color: "var(--chart-3)" },
  } satisfies ChartConfig;
  if (loading) return <Skeleton className="h-52 w-full" />;
  if (data.length === 0 || isFlat(data)) {
    return <EmptyState>{t("dashboard.noSalesPeriod")}</EmptyState>;
  }
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 4, top: 4 }}>
        <defs>
          <linearGradient id="fillSalesProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-sales)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-sales)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fillProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-profit)" stopOpacity={0.16} />
            <stop offset="100%" stopColor="var(--color-profit)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickCount={5} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="sales"
          name="sales"
          stroke="var(--color-sales)"
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-sales)" }}
          activeDot={{ r: 4 }}
          fill="url(#fillSalesProfit)"
        />
        <Area
          type="monotone"
          dataKey="profit"
          name="profit"
          stroke="var(--color-profit)"
          strokeWidth={2}
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-profit)" }}
          activeDot={{ r: 4 }}
          fill="url(#fillProfit)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Horizontal bar chart for ranked categories (items, expenses, staff, stores). */
export function HBarsChart({
  data,
  money,
  height = 40,
}: {
  data: MethodSlice[];
  money: MoneyFmt;
  height?: number;
}) {
  const { t } = useI18n();
  const config = {
    value: { label: t("dashboard.amount"), color: "var(--chart-1)" },
  } satisfies ChartConfig;
  if (data.length === 0) {
    return <EmptyState>{t("dashboard.nothingToShow")}</EmptyState>;
  }
  return (
    <ChartContainer config={config} className="w-full" style={{ height: data.length * height }}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 0, right: 12, top: 2, bottom: 2 }}
        barCategoryGap="22%"
      >
        <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={92}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent hideLabel nameKey="name" formatter={(v) => money(Number(v))} />
          }
        />
        <Bar dataKey="value" name="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/** Donut of payment methods (shadcn ChartContainer) with a share/value legend. */
export function PaymentMethods({
  data,
  money,
  loading,
}: {
  data: MethodSlice[];
  money: MoneyFmt;
  loading?: boolean;
}) {
  const { t } = useI18n();
  if (loading) return <Skeleton className="min-h-[9rem] w-full" />;
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("dashboard.noSalesInPeriod")}</p>;
  }
  const total = data.reduce((a, p) => a + p.value, 0) || 1;
  const config: ChartConfig = {};
  data.forEach((p, i) => {
    config[p.name] = {
      label: p.name,
      color: PIE_COLORS[i % PIE_COLORS.length] ?? "var(--chart-1)",
    };
  });
  return (
    <div className="flex min-h-[9rem] items-center gap-4">
      <div className="size-36 shrink-0">
        <ChartContainer config={config} className="aspect-auto size-full">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent hideLabel nameKey="name" formatter={(v) => money(Number(v))} />
              }
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={66}
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map((p) => (
                <Cell key={p.name} fill={`var(--color-${p.name})`} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-[13px]">
        {data.map((p) => (
          <li key={p.name} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: config[p.name]?.color }}
            />
            <span className="min-w-0 flex-1 truncate capitalize text-muted-foreground">
              {p.name}
            </span>
            <span className="tabular w-10 shrink-0 text-right text-muted-foreground">
              {Math.round((p.value / total) * 100)}%
            </span>
            <span className="tabular w-24 shrink-0 text-right font-semibold">{money(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type AlertItem = {
  icon: DashIcon;
  text: string;
  to: string;
  tone: "warn" | "info";
};

/** Clickable notification row that links to the underlying screen. */
export function AlertRow({ item }: { item: AlertItem }) {
  return (
    <Link
      to={item.to}
      className="flex items-center gap-2.5 rounded-md border bg-card p-2 text-[13px] transition-colors hover:bg-secondary"
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full",
          item.tone === "warn" ? "bg-warning/15 text-warning" : "bg-secondary text-foreground",
        )}
      >
        <HugeiconsIcon icon={item.icon} className="size-3.5" />
      </span>
      <span className="min-w-0 truncate font-medium">{item.text}</span>
    </Link>
  );
}

/** Centred placeholder used when a section has nothing to show. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-24 place-items-center text-sm text-muted-foreground">{children}</div>
  );
}
