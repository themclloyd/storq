import { describe, expect, it } from "vitest";
import { GRACE_DAYS, subscriptionAccess, type Subscription } from "@/lib/subscription-policy";

// Fixed clock so expiry is deterministic: "now" is mid-2026.
const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const FUTURE = new Date("2026-12-01T00:00:00Z").toISOString();
const PAST = new Date("2026-01-01T00:00:00Z").toISOString();
// Terms that lapsed at various distances from NOW, to walk the grace window.
const LAPSED_1D = new Date("2026-06-14T12:00:00Z").toISOString();
const LAPSED_2D12H = new Date("2026-06-13T00:00:00Z").toISOString();
const LAPSED_4D = new Date("2026-06-11T00:00:00Z").toISOString();

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  trial_ends_at: PAST,
  paid_until: FUTURE,
  plan: "standard",
  paid_store_limit: 3,
  ...over,
});

describe("subscriptionAccess — entitlement is derived in SQL, mirrored here", () => {
  it("is active while paid and within the paid store capacity", () => {
    const a = subscriptionAccess(sub(), 2, NOW);
    expect(a.paid).toBe(true);
    expect(a.overLimit).toBe(false);
    expect(a.active).toBe(true);
    expect(a.canAddStore).toBe(true);
  });

  it("locks a paid account that exceeds its capacity (overLimit) but blocks new stores", () => {
    const a = subscriptionAccess(sub({ paid_store_limit: 2 }), 5, NOW);
    expect(a.paid).toBe(true);
    expect(a.overLimit).toBe(true);
    expect(a.active).toBe(false); // shell must block until slots are bought
    expect(a.canAddStore).toBe(false);
  });

  it("at the exact capacity is active but cannot add another store", () => {
    const a = subscriptionAccess(sub({ paid_store_limit: 3 }), 3, NOW);
    expect(a.active).toBe(true);
    expect(a.canAddStore).toBe(false);
  });

  it("falls back to the one-store trial once payment lapses", () => {
    const a = subscriptionAccess(sub({ paid_until: PAST, trial_ends_at: FUTURE }), 1, NOW);
    expect(a.paid).toBe(false);
    expect(a.trial).toBe(true);
    expect(a.active).toBe(true);
  });

  it("an expired trial with no payment is inactive", () => {
    const a = subscriptionAccess(sub({ paid_until: PAST, trial_ends_at: PAST }), 1, NOW);
    expect(a.paid).toBe(false);
    expect(a.trial).toBe(false);
    expect(a.active).toBe(false);
    expect(a.canAddStore).toBe(false);
  });

  it("no row at all is inactive (fresh signup before provisioning)", () => {
    const a = subscriptionAccess(null, 0, NOW);
    expect(a.active).toBe(false);
    expect(a.capacity).toBe(0);
  });

  it("an operator suspension blocks the till even while prepaid time is still running", () => {
    // The money clock is untouched — that is the point of a suspension — so the
    // block cannot come from `paid`/`expired`, only from the stamp itself.
    const a = subscriptionAccess(sub({ suspended_at: PAST }), 2, NOW);
    expect(a.paid).toBe(true);
    expect(a.suspended).toBe(true);
    expect(a.closed).toBe(false);
    expect(a.active).toBe(false);
    expect(a.canAddStore).toBe(false);
  });

  it("a closure outranks a suspension it was layered on top of", () => {
    const a = subscriptionAccess(sub({ suspended_at: PAST, closed_at: PAST }), 2, NOW);
    expect(a.closed).toBe(true);
    expect(a.active).toBe(false);
  });

  it("a stored snapshot from before the columns existed is never read as blocked", () => {
    // Devices hold cached rows written before this migration; an absent field has to
    // mean "normal", or an offline till would lock itself for no reason.
    const a = subscriptionAccess(sub(), 2, NOW);
    expect(a.suspended).toBe(false);
    expect(a.closed).toBe(false);
    expect(a.active).toBe(true);
  });
});

describe("grace window — mirrors the 3-day expiry stretch in subscription_active()", () => {
  it("keeps a just-lapsed term selling and counts the days left", () => {
    const a = subscriptionAccess(sub({ paid_until: LAPSED_1D }), 2, NOW);
    expect(a.paid).toBe(false);
    expect(a.inGrace).toBe(true);
    expect(a.graceDaysRemaining).toBe(GRACE_DAYS - 1);
    expect(a.active).toBe(true);
  });

  it("rounds a partial final day up so the banner never shows zero too early", () => {
    const a = subscriptionAccess(sub({ paid_until: LAPSED_2D12H }), 2, NOW);
    expect(a.inGrace).toBe(true);
    expect(a.graceDaysRemaining).toBe(1);
  });

  it("locks the till once the grace has run out", () => {
    const a = subscriptionAccess(sub({ paid_until: LAPSED_4D }), 2, NOW);
    expect(a.inGrace).toBe(false);
    expect(a.graceDaysRemaining).toBe(0);
    expect(a.active).toBe(false);
  });

  it("does not excuse over-capacity: too many stores blocks inside the window too", () => {
    // SQL applies the store-count test in the same branch as the stretched clock.
    const a = subscriptionAccess(sub({ paid_until: LAPSED_1D, paid_store_limit: 2 }), 5, NOW);
    expect(a.inGrace).toBe(false);
    expect(a.active).toBe(false);
  });

  it("cannot be used to shrug off an operator suspension", () => {
    const a = subscriptionAccess(sub({ paid_until: LAPSED_1D, suspended_at: PAST }), 2, NOW);
    expect(a.inGrace).toBe(false);
    expect(a.active).toBe(false);
  });

  it("a closure keeps blocking while the grace clock is still running", () => {
    const a = subscriptionAccess(sub({ paid_until: LAPSED_1D, closed_at: PAST }), 2, NOW);
    expect(a.inGrace).toBe(false);
    expect(a.active).toBe(false);
  });

  it("gives the trial no grace — it already ends with a soft landing", () => {
    // No paid_until at all: nothing to stretch, so the trial branch decides alone.
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: PAST }), 1, NOW);
    expect(a.inGrace).toBe(false);
    expect(a.active).toBe(false);
  });
});
