import { describe, expect, it } from "vitest";
import {
  MONTH_SECONDS,
  PRICES,
  addMonths,
  billedSlotCount,
  calcTotal,
  paymentQuote,
  remainingTermMonths,
} from "./billing";

const DAY_MS = 86_400_000;
const MONTH_MS = MONTH_SECONDS * 1000;

describe("calcTotal", () => {
  it("charges the flat per-store monthly rate for a short term", () => {
    expect(calcTotal("MWK", 1, 1)).toBe(60_000);
    expect(calcTotal("MWK", 3, 6)).toBe(60_000 * 3 * 6);
    expect(calcTotal("USD", 2, 6)).toBe(35 * 2 * 6);
  });

  it("applies the 15% yearly discount at twelve months", () => {
    expect(calcTotal("MWK", 3, 12)).toBe(1_836_000);
    expect(calcTotal("USD", 1, 12)).toBe(357);
    // The discount is not stepped: 13 months pays the same monthly rate as 12.
    expect(calcTotal("MWK", 1, 13)).toBe(Math.round(60_000 * 13 * 0.85));
  });

  it("keeps the published rate card", () => {
    expect(PRICES.MWK).toBe(60_000);
    expect(PRICES.USD).toBe(35);
  });
});

describe("billedSlotCount", () => {
  it("charges the difference when capacity grows inside a running term", () => {
    expect(billedSlotCount(4, 3)).toBe(1);
    expect(billedSlotCount(10, 2)).toBe(8);
  });

  it("charges the whole count for a renewal, a reactivation or spare slots", () => {
    expect(billedSlotCount(3, 3)).toBe(3);
    // Nothing paid yet: a first payment covers every slot.
    expect(billedSlotCount(2, 0)).toBe(2);
    // Right-sizing down is a term purchase, so the lower count is what is billed.
    expect(billedSlotCount(3, 5)).toBe(3);
  });
});

describe("remainingTermMonths", () => {
  const now = Date.UTC(2026, 0, 15);

  it("rounds a part month up, because SQL rounds up before charging", () => {
    expect(remainingTermMonths(new Date(now + 10 * DAY_MS), now)).toBe(1);
    expect(remainingTermMonths(new Date(now + 40 * DAY_MS), now)).toBe(2);
    // Just over two mean months still bills three.
    expect(remainingTermMonths(new Date(now + 2 * MONTH_MS + 1000), now)).toBe(3);
  });

  it("never returns less than one month", () => {
    expect(remainingTermMonths(null, now)).toBe(1);
    expect(remainingTermMonths(new Date(now - DAY_MS), now)).toBe(1);
    expect(remainingTermMonths(new Date(now), now)).toBe(1);
  });

  it("reads an ISO string as readily as a date", () => {
    expect(remainingTermMonths(new Date(now + 61 * DAY_MS).toISOString(), now)).toBe(3);
  });
});

describe("addMonths", () => {
  it("keeps the day of the month", () => {
    expect(addMonths(new Date(2026, 5, 15), 2)).toEqual(new Date(2026, 7, 15));
    expect(addMonths(new Date(2026, 11, 15), 1)).toEqual(new Date(2027, 0, 15));
  });

  it("clamps to the last day, as make_interval does", () => {
    // 31 January + 1 month is 28 February, not 3 March.
    expect(addMonths(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
    expect(addMonths(new Date(2028, 0, 31), 1)).toEqual(new Date(2028, 1, 29));
  });
});

describe("paymentQuote", () => {
  const now = Date.UTC(2026, 0, 15);

  it("prices a mid-term capacity purchase and leaves the expiry alone", () => {
    const paidUntil = new Date(now + 181 * DAY_MS).toISOString();
    const q = paymentQuote({
      currency: "MWK",
      totalSlots: 4,
      paidSlots: 3,
      paidUntil,
      months: 1, // ignored: the term decides
      now,
    });
    expect(q.isCapacity).toBe(true);
    expect(q.billedSlots).toBe(1);
    expect(q.months).toBe(6);
    expect(q.total).toBe(60_000 * 6);
    expect(q.expiry.toISOString()).toBe(paidUntil);
  });

  it("gives a long remaining term the yearly rate rather than the undiscounted one", () => {
    const paidUntil = new Date(now + 400 * DAY_MS).toISOString();
    const q = paymentQuote({
      currency: "MWK",
      totalSlots: 2,
      paidSlots: 1,
      paidUntil,
      months: 1,
      now,
    });
    expect(q.months).toBe(14);
    expect(q.total).toBe(calcTotal("MWK", 1, 14));
    expect(q.total).toBeLessThan(60_000 * 14);
  });

  it("extends from the current expiry for a renewal and bills every slot", () => {
    const paidUntil = new Date(now + 30 * DAY_MS).toISOString();
    const q = paymentQuote({
      currency: "MWK",
      totalSlots: 3,
      paidSlots: 3,
      paidUntil,
      months: 12,
      now,
    });
    expect(q.isCapacity).toBe(false);
    expect(q.billedSlots).toBe(3);
    expect(q.months).toBe(12);
    expect(q.total).toBe(1_836_000);
    // Twelve months added to the paid date, not to today.
    expect(q.expiry.toISOString()).toBe(addMonths(new Date(paidUntil), 12).toISOString());
  });

  it("bills the live count when a renewal releases spare slots", () => {
    const q = paymentQuote({
      currency: "MWK",
      totalSlots: 3,
      paidSlots: 5,
      paidUntil: new Date(now + 30 * DAY_MS).toISOString(),
      months: 1,
      now,
    });
    expect(q.isCapacity).toBe(false);
    expect(q.billedSlots).toBe(3);
    expect(q.total).toBe(180_000);
  });

  it("starts a fresh term from today when the subscription has lapsed", () => {
    const q = paymentQuote({
      currency: "USD",
      totalSlots: 2,
      paidSlots: 0,
      paidUntil: new Date(now - 10 * DAY_MS).toISOString(),
      months: 3,
      now,
    });
    expect(q.isCapacity).toBe(false);
    expect(q.billedSlots).toBe(2);
    expect(q.months).toBe(3);
    expect(q.total).toBe(35 * 2 * 3);
    expect(q.expiry.toISOString()).toBe(addMonths(new Date(now), 3).toISOString());
  });

  it("gives a lapsed account buying extra slots a fresh term, not an unchanged one", () => {
    const q = paymentQuote({
      currency: "MWK",
      totalSlots: 4,
      paidSlots: 0,
      paidUntil: new Date(now - 10 * DAY_MS).toISOString(),
      months: 2,
      now,
    });
    expect(q.isCapacity).toBe(false);
    expect(q.billedSlots).toBe(4);
    expect(q.expiry.getTime()).toBe(addMonths(new Date(now), 2).getTime());
  });
});
