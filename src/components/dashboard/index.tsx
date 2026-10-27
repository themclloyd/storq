import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart } from "recharts";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
    <Card className="min-w-0 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </div>
        <HugeiconsIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="tabular mt-1 truncate text-2xl leading-tight font-extrabold">{value}</div>
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
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0 border-b px-4 py-2.5">
        <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
          {icon && <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />}
          {title}
        </CardTitle>
        {note && <CardDescription className="text-[11px]">{note}</CardDescription>}
      </CardHeader>
      <CardContent className={cn("p-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Segmented range control (shared `SegmentedControl`) used for date-range filters. */
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
    <SegmentedControl
      size="sm"
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o.key, label: o.label }))}
    />
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
  compact,
  loading,
}: {
  data: TrendPoint[];
  money: MoneyFmt;
  /** Axis label formatter, so the scale reads `40k` instead of `40000`. */
  compact?: MoneyFmt;
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
  const axis = (v: number) => (compact ? compact(v) : String(v));
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
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={44}
          tickCount={5}
          tickFormatter={axis}
        />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="sales"
          name="sales"
          stroke="var(--color-sales)"
          strokeWidth={2}
          dot={data.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: "var(--color-sales)" } : false}
          activeDot={{ r: 4 }}
          fill="url(#fillSales)"
        />
        <Area
          type="monotone"
          dataKey="expenses"
          name="expenses"
          stroke="var(--color-expenses)"
          strokeWidth={2}
          dot={
            data.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: "var(--color-expenses)" } : false
          }
          activeDot={{ r: 4 }}
          fill="url(#fillExpenses)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

export type MethodSlice = { name: string; value: number; label?: string };

/** Sales-vs-profit area chart for the business report (same look as TrendChart). */
export function ProfitTrendChart({
  data,
  money,
  compact,
  loading,
}: {
  data: ProfitTrendPoint[];
  money: MoneyFmt;
  /** Axis label formatter, so the scale reads `40k` instead of `40000`. */
  compact?: MoneyFmt;
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
  const axis = (v: number) => (compact ? compact(v) : String(v));
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
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={44}
          tickCount={5}
          tickFormatter={axis}
        />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          type="monotone"
          dataKey="sales"
          name="sales"
          stroke="var(--color-sales)"
          strokeWidth={2}
          dot={data.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: "var(--color-sales)" } : false}
          activeDot={{ r: 4 }}
          fill="url(#fillSalesProfit)"
        />
        <Area
          type="monotone"
          dataKey="profit"
          name="profit"
          stroke="var(--color-profit)"
          strokeWidth={2}
          dot={data.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: "var(--color-profit)" } : false}
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
    return <EmptyState>{t("dashboard.noSalesInPeriod")}</EmptyState>;
  }
  const total = data.reduce((a, p) => a + p.value, 0) || 1;
  const config: ChartConfig = {};
  data.forEach((p, i) => {
    config[p.name] = {
      // The key stays the stored code (it names the CSS colour var); the label is
      // what a shopkeeper reads ("Airtel Money", not "airtel_money").
      label: p.label ?? p.name,
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
            {/* Radii stay in percent: the square box is rem-sized, so its pixel
                size follows the root font size (clamp 13–15px). Fixed pixels
                overflow the chart surface and the SVG clips the ring. */}
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="66%"
              outerRadius="98%"
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
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {p.label ?? p.name}
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

/** Categorical ramp for the split bar. `--chart-N` is numbered by meaning (1
 *  sales, 2 profit, …) rather than by contrast, so the order below is picked so
 *  no two neighbours share a hue: flame → violet → green → gold → burnt umber.
 *  A lightness ramp of one hue (the usual version of this pattern) is unreadable
 *  for colour-blind users, in grayscale and on a thermal printer. */
const SPLIT_RAMP = [
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-2)",
  "var(--chart-3)",
];

/** Past this many groups the tail folds into one "Other" slice, so every slice
 *  keeps a distinct hue instead of recycling the ramp. */
const SPLIT_MAX = SPLIT_RAMP.length;

/** `48%` for a normal share, `0.4%` for a sliver — never a rounding `0%`. */
function shareLabel(ratio: number): string {
  return ratio >= 0.1 ? `${Math.round(ratio * 100)}%` : `${(ratio * 100).toFixed(1)}%`;
}

/** How one money total splits across groups: a stacked proportion bar over a
 *  legend whose cells are exactly as wide as the slices they name, so each
 *  figure sits under the segment it describes. The 2px gaps between slices keep
 *  the boundaries legible where two hues are close, and the bar itself is
 *  `aria-hidden` because every value is repeated as text in the legend. */
export function ValueSplitBar({
  data,
  money,
  loading,
}: {
  data: MethodSlice[];
  money: MoneyFmt;
  loading?: boolean;
}) {
  const { t } = useI18n();
  if (loading) return <Skeleton className="h-24 w-full" />;
  const sorted = data.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const slices =
    sorted.length <= SPLIT_MAX
      ? sorted
      : [
          ...sorted.slice(0, SPLIT_MAX - 1),
          {
            name: t("dashboard.other"),
            value: sorted.slice(SPLIT_MAX - 1).reduce((a, s) => a + s.value, 0),
          },
        ];
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (slices.length === 0 || total <= 0) {
    return <EmptyState>{t("dashboard.nothingToShow")}</EmptyState>;
  }
  return (
    <div>
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-[3px] bg-secondary"
        aria-hidden
      >
        {slices.map((s, i) => (
          <div
            key={s.name}
            className="min-w-[3px]"
            style={{
              background: SPLIT_RAMP[i % SPLIT_RAMP.length],
              flexGrow: s.value,
              flexBasis: 0,
            }}
          />
        ))}
      </div>
      {/* flex-grow from the raw value makes each cell share the bar's geometry;
          the min-width keeps a sliver readable and wraps to a stack on a phone. */}
      <ul className="mt-2.5 flex flex-wrap gap-y-2">
        {slices.map((s, i) => (
          <li
            key={s.name}
            className="min-w-0 border-l-2 pl-2 pr-3"
            style={{
              borderColor: SPLIT_RAMP[i % SPLIT_RAMP.length],
              flex: `${s.value} 0 0%`,
              minWidth: "7.5rem",
            }}
          >
            <p className="truncate text-[13px] font-medium">{s.name}</p>
            <p className="tabular mt-0.5 flex items-baseline gap-1.5 text-[13px]">
              <span className="text-muted-foreground">{shareLabel(s.value / total)}</span>
              <span className="font-semibold">{money(s.value)}</span>
            </p>
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
      className="flex items-center gap-2.5 rounded-md p-2 text-[13px] transition-colors hover:bg-secondary"
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full",
          item.tone === "warn"
            ? "bg-warning-soft text-warning-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        <HugeiconsIcon icon={item.icon} className="size-3.5" />
      </span>
      <span className="min-w-0 truncate font-medium">{item.text}</span>
    </Link>
  );
}

/** Centred placeholder used when a section has nothing to show. Optionally renders
 *  a 48px muted icon circle and a single action (spec §3). */
export function EmptyState({
  children,
  icon,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  if (!icon && !action) {
    return (
      <div className="grid h-24 place-items-center text-sm text-muted-foreground">{children}</div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <p className="max-w-xs text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}
