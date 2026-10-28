/**
 * Date-range policy and trend binning shared by the dashboard charts.
 *
 * Ranges are calendar-accurate in the session's time zone: a week starts on Monday and a
 * month starts on the 1st, so a "This week" chart never shows a rolling 7×24h window that
 * silently slices the month in half.
 */

export type RangeKey = "today" | "week" | "month";

export const ranges = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
] as const satisfies readonly { key: RangeKey; label: string }[];

/** Today is binned by hour; longer ranges are binned by day. */
export const isHourly = (key: RangeKey) => key === "today";

const pad = (n: number) => String(n).padStart(2, "0");

function startOfDay(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Local `YYYY-MM-DD`. Bare Postgres `date` strings must be read as local calendar days,
 * `new Date("2026-10-08")` and `.slice(0, 10)` of a UTC ISO both shift the day by the offset.
 */
export function localDateKey(value: string | Date): string {
  const d =
    typeof value === "string"
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
      : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First instant included in a range. */
export function rangeStart(key: RangeKey, now = new Date()): Date {
  const start = startOfDay(now);
  if (key === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (key === "month") start.setDate(1);
  return start;
}

/**
 * Widest window one fetch can cover for all three filters: the earlier of this week's and
 * this month's start (they differ whenever the month begins mid-week).
 */
export function dashboardSince(now = new Date()): string {
  const week = rangeStart("week", now);
  const month = rangeStart("month", now);
  return (week < month ? week : month).toISOString();
}

/** `5 Oct` for a single day, `1 Oct – 8 Oct` for a span. */
export function rangeSpanLabel(start: Date, now = new Date()): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  return localDateKey(start) === localDateKey(now) ? fmt(start) : `${fmt(start)} – ${fmt(now)}`;
}

export type TrendSale = { created_at: string; total: number };
export type TrendExpense = { spent_on: string; created_at?: string | null; amount: number };
export type TrendBucket = {
  day: string;
  ts: number;
  sales: number;
  profit: number;
  expenses: number;
};

const bucketId = (d: Date, hourly: boolean) =>
  hourly ? `${localDateKey(d)}T${pad(d.getHours())}` : localDateKey(d);

const bucketLabel = (d: Date, hourly: boolean) =>
  hourly
    ? `${pad(d.getHours())}:00`
    : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

/**
 * Bin sales and expenses into every hour (today) or every day (week/month) from the range
 * start up to now. Empty buckets are kept as zeros: without them recharts draws one straight
 * line between the few days that happened to have activity, which reads as a smooth trend
 * where there is none.
 */
export function buildTrend(opts: {
  start: Date;
  hourly: boolean;
  sales: readonly TrendSale[];
  expenses?: readonly TrendExpense[];
  /** Optional per-sale gross profit; omitted series stay at zero. */
  profitOf?: (sale: TrendSale) => number;
  now?: Date;
}): TrendBucket[] {
  const { start, hourly, sales, expenses = [], profitOf } = opts;
  const now = opts.now ?? new Date();

  const buckets = new Map<string, TrendBucket>();
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);
  const last = startOfDay(now);
  if (hourly) last.setHours(now.getHours());

  for (let guard = 0; guard < 1000 && cursor <= last; guard += 1) {
    const at = new Date(cursor);
    buckets.set(bucketId(at, hourly), {
      day: bucketLabel(at, hourly),
      ts: at.getTime(),
      sales: 0,
      profit: 0,
      expenses: 0,
    });
    if (hourly) cursor.setHours(cursor.getHours() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }

  for (const s of sales) {
    const b = buckets.get(bucketId(new Date(s.created_at), hourly));
    if (!b) continue;
    b.sales += Number(s.total);
    if (profitOf) b.profit += profitOf(s);
  }

  for (const e of expenses) {
    // Expenses only carry a `spent_on` day. On the hourly view the closest honest time is
    // when the entry was recorded, with the spent-on day as the fallback for older rows; an
    // entry whose period falls outside these buckets is simply not part of this trend.
    const spentDay = new Date(`${localDateKey(e.spent_on)}T00:00:00`);
    const when = hourly && e.created_at ? new Date(e.created_at) : spentDay;
    const b = buckets.get(bucketId(when, hourly)) ?? buckets.get(bucketId(spentDay, hourly));
    if (b) b.expenses += Number(e.amount);
  }

  return [...buckets.values()];
}
