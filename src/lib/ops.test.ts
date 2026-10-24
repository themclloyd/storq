import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLifecycleChange,
  applyPurge,
  EXTEND_MAX_DAYS,
  lifecycleActionsFor,
  previewLifecycle,
  previewPurge,
  purgeWaitDaysLeft,
  purgeWindowEnds,
  PURGE_WAIT_DAYS,
  ROSTER_SEARCH_MAX,
  SLOTS_MAX,
  TRIAL_MAX_DAYS,
  accessRunway,
  applyEntitlementChange,
  normalizeRosterSearch,
  previewEntitlement,
  rosterPage,
  rosterPageCount,
  tenantState,
  type EntitlementAction,
  type LifecycleAction,
  type TenantRow,
} from "@/lib/ops";

// The write path is a thin argument-mapping layer over one RPC, so the client is
// stubbed to prove exactly which field travels with a call.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const DAY = 86_400_000;
const now = new Date("2026-10-18T12:00:00Z");
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe("normalizeRosterSearch", () => {
  it("collapses whitespace runs and trims, so a pasted name matches the typed one", () => {
    expect(normalizeRosterSearch("  Cold \n Store   Limbe ")).toBe("Cold Store Limbe");
    expect(normalizeRosterSearch("   ")).toBe("");
    expect(normalizeRosterSearch("")).toBe("");
  });

  it("caps at the same length the RPC refuses beyond", () => {
    expect(normalizeRosterSearch("a".repeat(400))).toHaveLength(ROSTER_SEARCH_MAX);
  });
});

describe("rosterPageCount / rosterPage", () => {
  it("always has at least one page, even with no tenants", () => {
    expect(rosterPageCount(0)).toBe(1);
    expect(rosterPageCount(-5)).toBe(1);
    expect(rosterPageCount(10)).toBe(1);
    expect(rosterPageCount(11)).toBe(2);
  });

  it("clamps a stale page after a filter shrinks the list", () => {
    // Page 4 was valid for 50 tenants; a narrower filter leaves 12.
    expect(rosterPage(4, 12)).toBe(1);
    expect(rosterPage(0, 12)).toBe(0);
    expect(rosterPage(-1, 12)).toBe(0);
    expect(rosterPage(3, 0)).toBe(0);
  });
});

describe("accessRunway", () => {
  it("prefers a paid expiry still in force over the trial clock", () => {
    const r = accessRunway({ paid_until: iso(3 * DAY), trial_ends_at: iso(-40 * DAY) }, now);
    expect(r.days).toBe(3);
  });

  it("falls back to the trial deadline when nothing is paid", () => {
    expect(accessRunway({ paid_until: null, trial_ends_at: iso(DAY / 2) }, now).days).toBe(1);
    // Partial days round up: a trial ending in half a day is still "1 day left",
    // never "0", which would read as expired while the tenant can still trade.
  });

  it("judges a stopped-paying tenant by when its coverage lapsed, not by a long-gone trial", () => {
    // The trial ended nine days ago; the paid term only ran out two days ago,
    // and that is the date a support conversation would actually need.
    const r = accessRunway({ paid_until: iso(-2 * DAY), trial_ends_at: iso(-9 * DAY) }, now);
    expect(r.days).toBe(-2);
  });

  it("counts a never-paid tenant down past its trial", () => {
    const r = accessRunway({ paid_until: null, trial_ends_at: iso(-3 * DAY) }, now);
    expect(r.at.getUTCDate()).toBe(now.getUTCDate() - 3);
    expect(r.days).toBe(-3);
  });
});

// A tenant paying roughly ninety days on, three slots bought, two stores open,
// a trial that ended yesterday and no operator decision on top — the shape of a
// normal active account.
const tenant = (over: Partial<TenantRow> = {}): TenantRow => ({
  id: "b0000000-0000-4000-8000-000000000001",
  name: "Cold Store Limbe",
  currency: "MWK",
  owner_email: "owner@example.com",
  store_count: 2,
  staff_count: 4,
  plan: "monthly",
  paid_store_limit: 3,
  paid_until: iso(90 * DAY),
  trial_ends_at: iso(-1 * DAY),
  suspended_at: null,
  closed_at: null,
  state: "active",
  last_sale_at: iso(-2 * DAY),
  created_at: iso(-300 * DAY),
  ...over,
});

/** The refusal a preview carries, or "" when the change would be accepted. */
function refusal(row: TenantRow, action: EntitlementAction, raw: string): string {
  const p = previewEntitlement(row, action, raw, now);
  return p.ok ? "" : p.error;
}

/** What an accepted change leaves behind. Throws if the preview refused, which fails the test. */
function outcome(row: TenantRow, action: EntitlementAction, raw: string) {
  const p = previewEntitlement(row, action, raw, now);
  if (!p.ok) throw new Error(p.error);
  return p;
}

describe("tenantState", () => {
  it("is paid while the term runs and capacity covers the stores", () => {
    expect(tenantState(tenant(), 2, now)).toBe("active");
  });

  it("lets capacity outrank a live paid term", () => {
    // Money in the bank does not make over-capacity trading safe, and the slot
    // count is the actionable fact, so that is what the state reports.
    expect(tenantState(tenant(), 9, now)).toBe("over_capacity");
  });

  it("falls back to the trial once the paid term is exhausted", () => {
    const lapsed = {
      paid_until: iso(-DAY),
      paid_store_limit: 3,
      trial_ends_at: iso(5 * DAY),
      suspended_at: null,
      closed_at: null,
    };
    expect(tenantState(lapsed, 2, now)).toBe("trial");
  });

  it("is expired when neither clock has time left", () => {
    const gone = {
      paid_until: null,
      paid_store_limit: 3,
      trial_ends_at: iso(-DAY),
      suspended_at: null,
      closed_at: null,
    };
    expect(tenantState(gone, 2, now)).toBe("expired");
  });

  it("keeps calling a trial a trial through its one day of grace", () => {
    // The roster SQL counts the grace day as trial time because the tills are still
    // open on it; a console that said "expired" would send support chasing a
    // payment the tenant is not yet overdue for.
    const inGrace = {
      paid_until: null,
      paid_store_limit: 3,
      trial_ends_at: iso(-DAY / 2),
      suspended_at: null,
      closed_at: null,
    };
    expect(tenantState(inGrace, 1, now)).toBe("trial");
  });

  it("puts an operator decision above the money maths in both directions", () => {
    // Prepaid time does not make trading allowed, and an expired account that was
    // restored is not expired either — the stamp is the fact being reported.
    expect(tenantState(tenant({ suspended_at: iso(-DAY) }), 2, now)).toBe("suspended");
    expect(tenantState(tenant({ paid_until: iso(-DAY), trial_ends_at: iso(-DAY) }), 2, now)).toBe(
      "expired",
    );
    expect(tenantState(tenant({ closed_at: iso(-DAY), suspended_at: iso(-5 * DAY) }), 2, now)).toBe(
      "closed",
    );
  });
});

describe("lifecycleActionsFor", () => {
  it("gives a suspension to billing but the ending of a business to the owner alone", () => {
    expect(lifecycleActionsFor("billing")).toEqual(["suspend", "restore"]);
    expect(lifecycleActionsFor("owner")).toEqual(["suspend", "restore", "close", "reopen"]);
    expect(lifecycleActionsFor("support")).toEqual([]);
    expect(lifecycleActionsFor(null)).toEqual([]);
  });
});

describe("previewLifecycle", () => {
  /** The refusal a lifecycle preview carries, or "" when it would be accepted. */
  const refusalOf = (
    row: TenantRow,
    action: LifecycleAction,
    role: Parameters<typeof previewLifecycle>[2],
  ) => {
    const p = previewLifecycle(row, action, role);
    return p.ok ? "" : p.error;
  };

  it("refuses a verb the operator role never holds, in the RPC's own words", () => {
    expect(refusalOf(tenant(), "close", "billing")).toMatch(/super admin/);
    expect(refusalOf(tenant(), "suspend", "support")).toMatch(/not allowed to do this/);
  });

  it("walks the state ladder the roster already shows", () => {
    const owner = "owner" as const;
    expect(refusalOf(tenant(), "suspend", owner)).toBe("");
    expect(refusalOf(tenant({ suspended_at: iso(-DAY) }), "suspend", owner)).toMatch(
      /already suspended/,
    );
    expect(refusalOf(tenant(), "restore", owner)).toMatch(/not suspended/);
    expect(refusalOf(tenant({ suspended_at: iso(-DAY) }), "restore", owner)).toBe("");
    expect(refusalOf(tenant({ closed_at: iso(-DAY) }), "restore", owner)).toMatch(/reopen it/);
    expect(refusalOf(tenant({ closed_at: iso(-DAY) }), "suspend", owner)).toMatch(
      /reopen it first/,
    );
    expect(refusalOf(tenant(), "reopen", owner)).toMatch(/not closed/);
  });

  it("says what the tenant becomes, including a suspension that outlives closure", () => {
    // Reopening lifts the closure but not the suspension — collections still owns it.
    const both = tenant({ closed_at: iso(-DAY), suspended_at: iso(-5 * DAY) });
    expect(previewLifecycle(both, "reopen", "owner")).toEqual({ ok: true, state: "suspended" });
    // And a restore on a healthy paid tenant simply reveals the state underneath.
    expect(previewLifecycle(tenant({ suspended_at: iso(-DAY) }), "restore", "owner")).toEqual({
      ok: true,
      state: "active",
    });
  });
});

describe("purge waiting period", () => {
  it("holds a closed tenant recoverable for thirty days, then lets it go", () => {
    const closedAt = iso(-10 * DAY);
    expect(purgeWindowEnds(closedAt).getTime()).toBe(new Date(closedAt).getTime() + 30 * DAY);
    expect(purgeWaitDaysLeft(closedAt, now)).toBe(PURGE_WAIT_DAYS - 10);
    expect(purgeWaitDaysLeft(iso(-30 * DAY), now)).toBe(0);
    expect(purgeWaitDaysLeft(iso(-31 * DAY), now)).toBe(0);
  });
});

describe("previewPurge", () => {
  const refusalOf = (
    row: TenantRow,
    confirmName: string,
    reason: string,
    role: Parameters<typeof previewPurge>[3] = "owner",
  ) => {
    const p = previewPurge(row, confirmName, reason, role, now);
    return p.ok ? "" : p.error;
  };
  const purgeable = (over: Partial<TenantRow> = {}) =>
    tenant({ closed_at: iso(-(PURGE_WAIT_DAYS + 1) * DAY), ...over });

  it("checks role, reason, state and the window in the order the RPC does", () => {
    expect(refusalOf(purgeable(), "Cold Store Limbe", "closed for good", "billing")).toMatch(
      /not allowed/,
    );
    expect(refusalOf(purgeable(), "Cold Store Limbe", "short")).toMatch(/8 to 300/);
    expect(refusalOf(tenant(), "Cold Store Limbe", "closed for good")).toMatch(/close it first/);
    expect(
      refusalOf(tenant({ closed_at: iso(-3 * DAY) }), "Cold Store Limbe", "closed for good"),
    ).toMatch(/waiting period ends \d{4}-\d{2}-\d{2}/);
    expect(refusalOf(purgeable(), "Cold Store", "closed for good")).toMatch(/exactly as it/);
    expect(refusalOf(purgeable(), "Cold Store Limbe", "closed for good")).toBe("");
  });
});

describe("applyLifecycleChange / applyPurge", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("sends the state verb and its reason, nothing else", async () => {
    await applyLifecycleChange(tenant(), "suspend", "Unpaid invoice, agreed by phone");
    expect(rpc).toHaveBeenCalledWith("ops_set_tenant_state", {
      p_business_id: tenant().id,
      p_action: "suspend",
      p_reason: "Unpaid invoice, agreed by phone",
    });
  });

  it("sends a purge only with the name retyped exactly", async () => {
    // Case and letters must match what the roster shows; the RPC compares it as-is.
    await expect(
      applyPurge(tenant(), "cold store limbe", "Owner gone, window over"),
    ).rejects.toThrow(/exactly as it/);
    expect(rpc).not.toHaveBeenCalled();
    await applyPurge(
      tenant({ closed_at: iso(-40 * DAY) }),
      "Cold Store Limbe",
      "Reason long enough",
    );
    expect(rpc).toHaveBeenCalledWith("ops_purge_tenant", {
      p_business_id: tenant().id,
      p_confirm_name: "Cold Store Limbe",
      p_reason: "Reason long enough",
    });
  });

  it("refuses a thin justification before touching the database", async () => {
    await expect(applyLifecycleChange(tenant(), "close", "oops")).rejects.toThrow(/8 to 300/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal straight through", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Operators only") });
    await expect(
      applyLifecycleChange(tenant(), "suspend", "Suspension agreed with owner"),
    ).rejects.toThrow("Operators only");
  });
});

describe("previewEntitlement — slots", () => {
  it("never goes below the stores they actually run", () => {
    expect(refusal(tenant(), "slots", "1")).toMatch(/live stores/);
  });

  it("refuses a value that changes nothing", () => {
    expect(refusal(tenant(), "slots", "3")).toMatch(/already their capacity/);
  });

  it("takes whole slots inside the RPC's bounds", () => {
    expect(refusal(tenant(), "slots", "12.5")).toMatch(/whole number/);
    expect(refusal(tenant(), "slots", "0")).toMatch(/between 1 and/);
    expect(refusal(tenant(), "slots", String(SLOTS_MAX + 1))).toMatch(/between 1 and/);
  });

  it("shows an over-capacity tenant that raising slots is what fixes them", () => {
    const stuck = tenant({ store_count: 7, paid_store_limit: 4 });
    expect(refusal(stuck, "slots", "2")).toMatch(/live stores/);
    expect(outcome(stuck, "slots", "7").state).toBe("active");
  });
});

describe("previewEntitlement — extend", () => {
  it("counts from the expiry they already bought", () => {
    expect(outcome(tenant(), "extend", "30").days).toBe(120);
  });

  it("counts unpaid time from today, not from a date they missed", () => {
    const lapsed = tenant({ paid_until: iso(-10 * DAY) });
    const p = outcome(lapsed, "extend", "5");
    expect(p.state).toBe("active");
    expect(p.days).toBe(5);
  });

  it("refuses to push the expiry into the past", () => {
    expect(refusal(tenant(), "extend", "-400")).toMatch(/expired/);
  });

  it("refuses to grant beyond the two-year ceiling", () => {
    // Ninety days already paid plus the largest allowed step lands past 24 months.
    expect(refusal(tenant(), "extend", String(EXTEND_MAX_DAYS))).toMatch(/24 months/);
  });

  it("takes a non-zero whole number of days", () => {
    expect(refusal(tenant(), "extend", "0")).toMatch(/forward or back/);
    expect(refusal(tenant(), "extend", "1.5")).toMatch(/forward or back/);
  });
});

describe("previewEntitlement — until", () => {
  it("refuses a date in the past, which is a suspension not a change", () => {
    expect(refusal(tenant(), "until", "2020-01-01")).toMatch(/suspension/);
  });

  it("refuses anything the date picker has not answered", () => {
    expect(refusal(tenant(), "until", "next spring")).toMatch(/pick the day/i);
  });

  it("accepts a future date and keeps the tenant paid", () => {
    const p = outcome(tenant(), "until", iso(30 * DAY).slice(0, 10));
    expect(p.state).toBe("active");
    // The picker yields end-of-day in the operator's own timezone, so the whole-day
    // count can sit one either side of the exact horizon; the state is the fact.
    expect(p.days).toBeGreaterThanOrEqual(29);
    expect(p.days).toBeLessThanOrEqual(31);
  });
});

describe("previewEntitlement — trial and plan", () => {
  it("sets a trial only inside the window the RPC allows", () => {
    expect(refusal(tenant(), "trial", "0")).toMatch(/1 to/);
    expect(refusal(tenant(), "trial", String(TRIAL_MAX_DAYS + 1))).toMatch(/1 to/);
    expect(outcome(tenant(), "trial", "14").ok).not.toBe(false);
  });

  it("keeps a trial inert while a paid term is running", () => {
    const p = outcome(tenant(), "trial", "60");
    expect(p.state).toBe("active");
    expect(p.days).toBe(90); // the paid clock still governs
  });

  it("reads a trial as the whole state once nothing is paid", () => {
    const lapsed = tenant({ paid_until: null, trial_ends_at: iso(-1 * DAY) });
    expect(outcome(lapsed, "trial", "30").state).toBe("trial");
  });

  it("treats the plan as a label that moves no clock", () => {
    const p = outcome(tenant(), "plan", "yearly");
    expect(p.state).toBe("active");
    expect(p.days).toBe(90);
  });

  it("refuses a plan they already carry, and a plan that is not one", () => {
    expect(refusal(tenant(), "plan", "monthly")).toMatch(/already recorded/);
    expect(refusal(tenant(), "plan", "weekly")).toMatch(/monthly or yearly/);
  });
});

describe("applyEntitlementChange", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("sends the one field the operator chose, plus the reason", async () => {
    await applyEntitlementChange(tenant(), "slots", "5", "Owner asked for a third till");
    expect(rpc).toHaveBeenCalledWith("ops_update_subscription", {
      p_business_id: tenant().id,
      p_reason: "Owner asked for a third till",
      p_slots: 5,
    });
  });

  it("maps each intent to its own parameter", async () => {
    await applyEntitlementChange(tenant(), "extend", "30", "Goodwill for the outage");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_extend_days: 30 });
    await applyEntitlementChange(tenant(), "trial", "14", "Manager approved an extension");
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_trial_days: 14 });
    await applyEntitlementChange(tenant(), "plan", "yearly", "Switched to annual billing");
    expect(rpc.mock.calls[2]?.[1]).toMatchObject({ p_plan: "yearly" });
    await applyEntitlementChange(tenant(), "until", "2027-03-01", "Paid by bank transfer");
    expect(new Date(String(rpc.mock.calls[3]?.[1].p_until)).getUTCFullYear()).toBe(2027);
  });

  it("carries no other entitlement field", async () => {
    await applyEntitlementChange(tenant(), "plan", "yearly", "Switched to annual billing");
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_business_id", "p_plan", "p_reason"]);
  });

  it("never asks the database for a change it can already see is wrong", async () => {
    await expect(
      applyEntitlementChange(tenant(), "slots", "1", "cutting them down anyway"),
    ).rejects.toThrow(/live stores/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal straight through", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Operators only") });
    await expect(
      applyEntitlementChange(tenant(), "plan", "yearly", "Annual deal agreed"),
    ).rejects.toThrow("Operators only");
  });
});
