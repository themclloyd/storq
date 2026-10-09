import { describe, expect, it } from "vitest";
import { buildTrend, dashboardSince, localDateKey, rangeStart } from "@/lib/trend";

const local = (y: number, mo: number, d: number, h = 0, min = 0) => new Date(y, mo - 1, d, h, min);
const iso = (d: Date) => d.toISOString();

describe("range starts", () => {
  it("starts a week on Monday, not on a rolling 7×24h window", () => {
    expect(localDateKey(rangeStart("week", local(2026, 10, 8)))).toBe("2026-10-05");
  });
  it("starts a month on the 1st", () => {
    expect(localDateKey(rangeStart("month", local(2026, 10, 8)))).toBe("2026-10-01");
  });
  it("fetches back to last month when the week spills over the 1st", () => {
    // 2 Oct 2026 is a Friday, so "this week" began 28 Sep — a month-start window would drop it.
    expect(localDateKey(new Date(dashboardSince(local(2026, 10, 2))))).toBe("2026-09-28");
  });
  it("reads bare date columns as local calendar days", () => {
    expect(localDateKey("2026-10-08")).toBe("2026-10-08");
    const day = local(2026, 10, 8);
    expect(localDateKey(iso(day))).toBe(localDateKey(day));
  });
});

describe("buildTrend", () => {
  it("bins the day into hours and keeps empty hours as zeros", () => {
    const start = local(2026, 10, 8);
    const now = local(2026, 10, 8, 9, 30);
    const trend = buildTrend({
      start,
      now,
      hourly: true,
      sales: [
        { created_at: iso(local(2026, 10, 8, 9, 5)), total: 20 },
        { created_at: iso(local(2026, 10, 8, 9, 40)), total: 30 },
        { created_at: iso(local(2026, 10, 7, 11, 0)), total: 999 },
      ],
    });
    expect(trend).toHaveLength(10); // 00:00 through 09:00
    expect(trend.map((b) => b.day)).toEqual([
      "00:00",
      "01:00",
      "02:00",
      "03:00",
      "04:00",
      "05:00",
      "06:00",
      "07:00",
      "08:00",
      "09:00",
    ]);
    expect(trend[9]).toMatchObject({ sales: 50, ts: local(2026, 10, 8, 9).getTime() });
    expect(trend.slice(0, 9).every((b) => b.sales === 0)).toBe(true); // no sale-time gaps, no old rows
  });

  it("fills every day of the range so quiet days read as zero", () => {
    const trend = buildTrend({
      start: local(2026, 10, 5),
      now: local(2026, 10, 8, 14),
      hourly: false,
      sales: [
        { created_at: iso(local(2026, 10, 5, 8)), total: 40 },
        { created_at: iso(local(2026, 10, 8, 12)), total: 60 },
      ],
      expenses: [{ spent_on: "2026-10-06", amount: 15 }],
    });
    expect(trend).toHaveLength(4); // Mon–Thu
    expect(trend.map((b) => b.sales)).toEqual([40, 0, 0, 60]);
    expect(trend.map((b) => b.expenses)).toEqual([0, 15, 0, 0]);
  });

  it("uses the recording time for expenses on the hourly view", () => {
    const trend = buildTrend({
      start: local(2026, 10, 8),
      now: local(2026, 10, 8, 2),
      hourly: true,
      sales: [],
      expenses: [{ spent_on: "2026-10-08", created_at: iso(local(2026, 10, 8, 1, 10)), amount: 8 }],
    });
    expect(trend.map((b) => b.expenses)).toEqual([0, 8, 0]);
  });
});
