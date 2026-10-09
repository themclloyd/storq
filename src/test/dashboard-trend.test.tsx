import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

import { TrendChart } from "@/components/dashboard";
import { buildTrend, rangeStart } from "@/lib/trend";

const money = (n: number | string | null | undefined) => `R ${n ?? 0}`;
const today = new Date();

describe("Dashboard trend chart", () => {
  it("shows a placeholder while the period is still loading", () => {
    render(<TrendChart data={[]} money={money} loading />);
    expect(screen.queryByText("No activity in this period yet.")).not.toBeInTheDocument();
  });

  it("keeps a zero-filled period with no activity marked as empty", () => {
    const data = buildTrend({
      start: rangeStart("month", today),
      hourly: false,
      sales: [],
      now: today,
    });
    render(<TrendChart data={data} money={money} />);
    expect(screen.getByText("No activity in this period yet.")).toBeInTheDocument();
  });

  it("renders the chart for every range filter", () => {
    for (const [hourly, start] of [
      [true, rangeStart("today", today)],
      [false, rangeStart("week", today)],
      [false, rangeStart("month", today)],
    ] as const) {
      const data = buildTrend({
        start,
        hourly,
        sales: [{ created_at: today.toISOString(), total: 120 }],
        expenses: [{ spent_on: today.toISOString().slice(0, 10), amount: 30 }],
        now: today,
      });
      const { unmount } = render(<TrendChart data={data} money={money} />);
      expect(screen.queryByText("No activity in this period yet.")).not.toBeInTheDocument();
      unmount();
    }
  });
});
