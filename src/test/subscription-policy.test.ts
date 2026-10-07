import { describe, expect, it } from "vitest";
import { subscriptionAccess, type Subscription } from "@/lib/subscription-policy";

const now = Date.parse("2026-10-07T12:00:00Z");
const subscription: Subscription = { trial_ends_at: "2026-10-08T00:00:00Z", paid_until: "2026-11-07T00:00:00Z", paid_store_limit: 1, plan: "monthly" };

describe("paid store capacity", () => {
  it("does not allow another store with one paid slot", () => {
    expect(subscriptionAccess(subscription, 1, now)).toMatchObject({ active: true, canAddStore: false });
  });
  it("blocks over-capacity access even during the original trial", () => {
    expect(subscriptionAccess(subscription, 2, now)).toMatchObject({ active: false, overLimit: true, trial: false });
  });
  it("allows an unused purchased slot", () => {
    expect(subscriptionAccess({ ...subscription, paid_store_limit: 2 }, 1, now).canAddStore).toBe(true);
  });
  it("keeps the unpaid trial available", () => {
    expect(subscriptionAccess({ ...subscription, paid_until: null }, 2, now)).toMatchObject({ active: true, trial: true, canAddStore: true });
  });
  it("fails closed without subscription data", () => {
    expect(subscriptionAccess(null, 1, now).active).toBe(false);
  });
  it("blocks expired subscriptions", () => {
    expect(subscriptionAccess({ ...subscription, trial_ends_at: "2026-10-06", paid_until: "2026-10-06" }, 1, now).active).toBe(false);
  });
  it("treats the exact expiry time as expired", () => {
    expect(subscriptionAccess({ ...subscription, trial_ends_at: new Date(now).toISOString(), paid_until: new Date(now).toISOString() }, 1, now).active).toBe(false);
  });
});