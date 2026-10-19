import { describe, expect, it } from "vitest";
import { subscriptionAccess, type Subscription } from "@/lib/subscription-policy";

// Fixed clock so expiry is deterministic: "now" is mid-2026.
const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const FUTURE = new Date("2026-12-01T00:00:00Z").toISOString();
const PAST = new Date("2026-01-01T00:00:00Z").toISOString();

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
