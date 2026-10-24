import { describe, expect, it } from "vitest";
import {
  GRACE_DAYS,
  TRIAL_GRACE_DAYS,
  TRIAL_NOTICE_DAYS,
  subscriptionAccess,
  type Subscription,
} from "@/lib/subscription-policy";

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

  it("does not keep a trial open on a second store, because SQL's trial branch caps at one", () => {
    // A lapsed paid account can still be holding two stores when its trial clock
    // begins; SQL refuses every write in that shape, so the shell must not sit there
    // showing a working till.
    const a = subscriptionAccess(sub({ paid_until: PAST, trial_ends_at: FUTURE }), 2, NOW);
    expect(a.trial).toBe(true);
    expect(a.active).toBe(false);
    expect(a.canAddStore).toBe(false);
  });

  it("offers the add-location affordance on a trial only while the single store is unused", () => {
    const unused = subscriptionAccess(sub({ paid_until: PAST, trial_ends_at: FUTURE }), 0, NOW);
    expect(unused.canAddStore).toBe(true);
    const used = subscriptionAccess(sub({ paid_until: PAST, trial_ends_at: FUTURE }), 1, NOW);
    expect(used.canAddStore).toBe(false);
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

  it("does not stretch the paid clock with a trial that has already run out", () => {
    // No paid_until at all: the paid branch has nothing to stretch, and the trial
    // ended months ago, so nothing is left to sell on.
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: PAST }), 1, NOW);
    expect(a.inGrace).toBe(false);
    expect(a.inTrialGrace).toBe(false);
    expect(a.active).toBe(false);
  });
});

describe("trial grace — one day of selling after the single-day trial", () => {
  const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

  it("keeps selling through the day after the trial ends", () => {
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: ago(12) }), 1, NOW);
    expect(a.trial).toBe(false);
    expect(a.inTrialGrace).toBe(true);
    expect(a.trialGraceDaysRemaining).toBe(TRIAL_GRACE_DAYS);
    expect(a.active).toBe(true);
    // The grace is for selling, not for growing: the trial still covers one store.
    expect(a.canAddStore).toBe(false);
  });

  it("locks the moment the grace day is spent", () => {
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: ago(25) }), 1, NOW);
    expect(a.inTrialGrace).toBe(false);
    expect(a.trialGraceDaysRemaining).toBe(0);
    expect(a.active).toBe(false);
  });

  it("does not stretch the one-store cap", () => {
    // SQL applies the store-count test inside the same branch as the clock.
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: ago(12) }), 2, NOW);
    expect(a.inTrialGrace).toBe(false);
    expect(a.active).toBe(false);
  });

  it("cannot be used to shrug off an operator suspension", () => {
    const a = subscriptionAccess(
      sub({ paid_until: null, trial_ends_at: ago(12), suspended_at: PAST }),
      1,
      NOW,
    );
    expect(a.inTrialGrace).toBe(false);
    expect(a.active).toBe(false);
  });

  it("is the window after the end, not the trial itself", () => {
    const ahead = new Date(NOW + 12 * 3_600_000).toISOString();
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: ahead }), 1, NOW);
    expect(a.trial).toBe(true);
    expect(a.inTrialGrace).toBe(false);
    expect(a.trialGraceDaysRemaining).toBe(0);
    expect(a.trialDaysRemaining).toBe(1);
  });
});

describe("trial notice — the countdown starts the day the trial does", () => {
  // The trial is a single day, so there is no "quiet period" left to spend: the
  // warning has to be up from the first moment, and the day of grace after it is
  // the banner's other job. A longer trial is still possible — an operator can
  // grant up to TRIAL_MAX_DAYS — which is what the quiet case below covers.
  const trialIn = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

  it("warns from the first moment of the one-day trial", () => {
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: trialIn(1) }), 1, NOW);
    expect(a.trial).toBe(true);
    expect(a.trialDaysRemaining).toBe(1);
    expect(a.trialEndingSoon).toBe(true);
  });

  it("stays quiet while a granted trial still has more than a week to run", () => {
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: trialIn(30) }), 1, NOW);
    expect(a.trial).toBe(true);
    expect(a.trialDaysRemaining).toBe(30);
    expect(a.trialEndingSoon).toBe(false);
  });

  it("warns inside the last week, starting exactly on the boundary", () => {
    const a = subscriptionAccess(
      sub({ paid_until: null, trial_ends_at: trialIn(TRIAL_NOTICE_DAYS) }),
      1,
      NOW,
    );
    expect(a.trialDaysRemaining).toBe(TRIAL_NOTICE_DAYS);
    expect(a.trialEndingSoon).toBe(true);
  });

  it("rounds a partial final day up so the notice never reads zero while still open", () => {
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: trialIn(3.5) }), 1, NOW);
    expect(a.trialDaysRemaining).toBe(4);
    expect(a.trialEndingSoon).toBe(true);
  });

  it("a paid term outranks the trial notice even if the trial clock is running", () => {
    const a = subscriptionAccess(sub({ trial_ends_at: trialIn(2) }), 2, NOW);
    expect(a.paid).toBe(true);
    expect(a.trial).toBe(false);
    expect(a.trialDaysRemaining).toBe(0);
    expect(a.trialEndingSoon).toBe(false);
  });

  it("stops counting once the trial is over and the till is blocked", () => {
    const a = subscriptionAccess(sub({ paid_until: null, trial_ends_at: PAST }), 1, NOW);
    expect(a.trial).toBe(false);
    expect(a.trialDaysRemaining).toBe(0);
    expect(a.trialEndingSoon).toBe(false);
    expect(a.active).toBe(false);
  });

  it("has no row to count down from", () => {
    const a = subscriptionAccess(null, 0, NOW);
    expect(a.trialDaysRemaining).toBe(0);
    expect(a.trialEndingSoon).toBe(false);
  });
});
