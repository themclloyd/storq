import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LIST_PAGE_SIZE } from "@/lib/paging";
import { TRIAL_GRACE_DAYS } from "@/lib/subscription-policy";
import { sanitizeText } from "@/lib/validate";

/**
 * Platform operator console data layer.
 *
 * Everything here is cross-tenant. The database does the authorization: each call
 * lands on a SECURITY DEFINER RPC that resolves the operator from the JWT subject
 * (`require_platform_admin`) and raises for a customer, so this module never decides
 * what an operator may see or change — and it is deliberately free of `usePos`,
 * because an operator holds no staff session.
 *
 * The entitlement helpers below mirror `ops_update_subscription` closely enough to
 * preview a change and pre-flight an obvious mis-type. That is a convenience, not a
 * second authority: the function re-checks every rule, and its wordings are reused
 * here so a hint and a rejection say the same thing.
 */

export type OperatorRole = "support" | "billing" | "owner";
/**
 * Tenant lifecycle, in the order the roster SQL ranks it. `suspended` and `closed`
 * are operator decisions recorded as clocks on the subscription row, and they
 * outrank the money maths — which is why they are states here and not a faked
 * expiry date.
 */
export type TenantState = "active" | "trial" | "expired" | "over_capacity" | "suspended" | "closed";
/** The roster filter set — `all` plus every derivable state. */
export type RosterFilter = "all" | TenantState;

export type TenantRow = {
  id: string;
  name: string;
  currency: string;
  owner_email: string | null;
  store_count: number;
  staff_count: number;
  plan: string | null;
  paid_store_limit: number;
  paid_until: string | null;
  trial_ends_at: string;
  suspended_at: string | null;
  closed_at: string | null;
  state: TenantState;
  last_sale_at: string | null;
  created_at: string;
};

/** Mirrors the RPC's own bound, so the box cannot send a string SQL will refuse. */
export const ROSTER_SEARCH_MAX = 120;

/** Same severity order the roster's own `ORDER BY` uses, so the filter reads as a queue. */
export const rosterFilters: RosterFilter[] = [
  "all",
  "over_capacity",
  "expired",
  "suspended",
  "trial",
  "closed",
  "active",
];

/**
 * Single-line, trimmed, length-capped search. Newlines and repeated spaces are
 * collapsed because the value is matched as a contiguous substring in SQL.
 */
export function normalizeRosterSearch(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, ROSTER_SEARCH_MAX);
}

/** Pages for the shared Pager, from the server-side filtered total. */
export function rosterPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / LIST_PAGE_SIZE));
}

/** Clamp a stale page index after a filter change, so the table is never empty-by-nothing. */
export function rosterPage(page: number, total: number): number {
  return Math.min(Math.max(page, 0), rosterPageCount(total) - 1);
}

/**
 * The last moment this tenant's access can change, and how far off it is in
 * whole days (positive = remaining, negative = already lapsed). It is the LATER
 * of the two clocks, which matches `subscription_active()` in SQL: a paid term
 * governs while it runs, a trial extends access only once the paid term is
 * exhausted, and a tenant that has stopped paying is judged by whichever clock
 * ran out last — reporting a trial that ended a year ago would be noise.
 */
export function accessRunway(
  row: Pick<TenantRow, "paid_until" | "trial_ends_at">,
  now: Date,
): { at: Date; days: number } {
  const paid = row.paid_until ? new Date(row.paid_until) : null;
  const trial = new Date(row.trial_ends_at);
  const at = paid && paid > trial ? paid : trial;
  const diff = at.getTime() - now.getTime();
  const day = 86_400_000;
  return { at, days: diff >= 0 ? Math.ceil(diff / day) : -Math.ceil(-diff / day) };
}

/**
 * The entitlement change a console call may carry. Exactly one of these per call,
 * which is what the RPC enforces too, so every audit row keeps one meaning.
 */
export type EntitlementAction = "slots" | "extend" | "until" | "trial" | "plan";
export const entitlementActions: EntitlementAction[] = [
  "slots",
  "extend",
  "until",
  "trial",
  "plan",
];

/**
 * The verbs that change whether a tenant may trade at all, as opposed to what they
 * bought. Each is one intent on its own RPC call, and none of them touches a money
 * column: `suspended_at` / `closed_at` are their own clocks, so prepaid time stays.
 * There is no impersonation verb anywhere in this module, by design — staff
 * authority only ever comes from a PIN session.
 */
export type LifecycleAction = "suspend" | "restore" | "close" | "reopen";
export const lifecycleActions: LifecycleAction[] = ["suspend", "restore", "close", "reopen"];

/** How long a closed tenant stays recoverable before purge becomes possible. */
export const PURGE_WAIT_DAYS = 30;

/** The reason range `ops_update_subscription` and the audit table's CHECK accept. */
export const REASON_MIN_CHARS = 8;
export const REASON_MAX_CHARS = 300;

/** Bounds duplicated from the RPC. They exist to explain a refusal, never to grant one. */
export const SLOTS_MAX = 1000;
export const EXTEND_MAX_DAYS = 730;
export const TRIAL_MAX_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * Every verb the tenant journal can hold: the console's own entitlements and
 * lifecycle moves, plus the payment check that settles a stuck charge.
 */
export type AuditAction = EntitlementAction | LifecycleAction | "verify_payment";

export type AuditEntry = {
  id: string;
  action: AuditAction;
  before: Record<string, string | number | null>;
  after: Record<string, string | number | null>;
  reason: string;
  actor: string;
  role: OperatorRole;
  created_at: string;
};

/**
 * The lifecycle a tenant is in, by the precedence the roster SQL and
 * `subscription_active()` already use: an operator decision wins over the money
 * maths in both directions, then a paid term, capacity, and a trial that only
 * counts once nothing is paid.
 */
export function tenantState(
  sub: Pick<
    TenantRow,
    "paid_until" | "paid_store_limit" | "trial_ends_at" | "suspended_at" | "closed_at"
  >,
  storeCount: number,
  now: Date,
): TenantState {
  if (sub.closed_at) return "closed";
  if (sub.suspended_at) return "suspended";
  const paid = !!sub.paid_until && new Date(sub.paid_until) > now;
  if (paid) return sub.paid_store_limit >= storeCount ? "active" : "over_capacity";
  // The roster SQL counts a trial's single grace day as trial time, because the
  // tills are still open on it. Reading the raw clock here would label a trading
  // tenant "expired" for a day — the label and the till have to agree.
  const trialEnds = new Date(sub.trial_ends_at).getTime();
  return trialEnds + TRIAL_GRACE_DAYS * DAY_MS > now.getTime() ? "trial" : "expired";
}

export type EntitlementPreview =
  { ok: true; state: TenantState; days: number } | { ok: false; error: string };

const refused = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Whole numbers only — the RPC takes integers, and 12.5 slots has never meant anything. */
function toInteger(raw: string): number | null {
  const v = raw.trim();
  return /^-?\d+$/.test(v) ? Number(v) : null;
}

/** A date picker yields `YYYY-MM-DD`; access runs through the end of that local day. */
function endOfDay(raw: string): Date | null {
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const at = new Date(`${v}T23:59:59`);
  return Number.isNaN(at.getTime()) ? null : at;
}

function becomes(
  next: Pick<
    TenantRow,
    "paid_until" | "paid_store_limit" | "trial_ends_at" | "suspended_at" | "closed_at"
  >,
  storeCount: number,
  now: Date,
): EntitlementPreview {
  return {
    ok: true,
    state: tenantState(next, storeCount, now),
    days: accessRunway(next, now).days,
  };
}

/**
 * What this change would leave the tenant as — the same bounds, clamps and refusals
 * as `ops_update_subscription`, in the RPC's own words so an inline hint and a
 * rejection say the same thing. SQL stays the authority: nothing here can let through
 * a call the function would refuse.
 */
export function previewEntitlement(
  row: TenantRow,
  action: EntitlementAction,
  raw: string,
  now = new Date(),
): EntitlementPreview {
  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() + 24); // SQL weighs this as `now() + 24 months`

  if (action === "slots") {
    const n = toInteger(raw);
    if (n === null) return refused("Enter a whole number of store slots");
    if (n < 1 || n > SLOTS_MAX) return refused(`Slots must be between 1 and ${SLOTS_MAX}`);
    if (n < row.store_count)
      return refused(
        `They already have ${row.store_count} live stores — remove those before lowering capacity`,
      );
    if (n === row.paid_store_limit) return refused("That is already their capacity");
    return becomes({ ...row, paid_store_limit: n }, row.store_count, now);
  }

  if (action === "extend") {
    const d = toInteger(raw);
    if (d === null || d === 0 || Math.abs(d) > EXTEND_MAX_DAYS)
      return refused(`Days must be between 1 and ${EXTEND_MAX_DAYS}, forward or back`);
    // Unpaid time counts from today, never from a date they already missed.
    const paid = row.paid_until ? new Date(row.paid_until) : now;
    const at = new Date(Math.max(paid.getTime(), now.getTime()) + d * DAY_MS);
    if (at <= now) return refused("That would leave them expired. Set an expiry date instead.");
    if (at > horizon) return refused("That puts their expiry more than 24 months out");
    return becomes({ ...row, paid_until: at.toISOString() }, row.store_count, now);
  }

  if (action === "until") {
    const at = endOfDay(raw);
    if (!at) return refused("Pick the day their access runs to");
    if (at <= now)
      return refused(
        "An expiry in the past stops their tills — that is a suspension, not an entitlement change",
      );
    if (at > horizon) return refused("Cannot grant more than 24 months ahead");
    const current = row.paid_until ?? row.trial_ends_at;
    if (current && Math.abs(at.getTime() - new Date(current).getTime()) < 1000)
      return refused("That is already their expiry");
    return becomes({ ...row, paid_until: at.toISOString() }, row.store_count, now);
  }

  if (action === "trial") {
    const d = toInteger(raw);
    if (d === null || d < 1 || d > TRIAL_MAX_DAYS)
      return refused(`A trial can be set 1 to ${TRIAL_MAX_DAYS} days out`);
    // Inert while a paid term is running, exactly as SQL reads it, so the preview
    // stays Paid even though only the trial clock moved.
    const at = new Date(now.getTime() + d * DAY_MS).toISOString();
    return becomes({ ...row, trial_ends_at: at }, row.store_count, now);
  }

  const plan = raw === "monthly" || raw === "yearly" ? raw : null;
  if (!plan) return refused("Plan must be monthly or yearly");
  if (plan === row.plan) return refused(`They are already recorded as ${plan}`);
  return becomes(row, row.store_count, now); // a label change moves no clock
}

/**
 * Where a freshly signed-in session belongs. An operator holds no business row,
 * so sending them to `/app` would dead-end on setup; everyone else must never be
 * delayed by the operator probe, so any failure lands on the workspace.
 */
export async function landingRouteFor(): Promise<"/ops" | "/app"> {
  try {
    const { data, error } = await supabase.rpc("my_platform_role" as never);
    if (!error && data) return "/ops";
  } catch {
    // Identity probe is best-effort.
  }
  return "/app";
}

export function usePlatformRole() {
  return useQuery({
    queryKey: ["ops", "role"],
    // Identity changes only when a row is inserted or revoked by hand, and the
    // console re-reads it on mount.
    staleTime: 300_000,
    queryFn: async () => {
      // Not in the generated Function union (this file is regenerated by
      // Lovable Cloud), so cast at the call site as the billing functions do.
      const { data, error } = await supabase.rpc("my_platform_role" as never);
      if (error) throw error;
      return (data as OperatorRole | null) ?? null;
    },
  });
}

export function useTenantRoster(filter: { q: string; state: RosterFilter; page: number }) {
  const search = normalizeRosterSearch(filter.q);
  return useQuery({
    queryKey: ["ops", "roster", search, filter.state, filter.page],
    // keepPreviousData holds the last page while the next one loads, so paging
    // does not blank the table.
    placeholderData: keepPreviousData,
    // Support-facing freshness: a payment or a new store should show up without
    // a reload, but the roster is not a live trading screen.
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "ops_business_roster" as never,
        {
          p_q: search || null,
          p_state: filter.state,
          p_limit: LIST_PAGE_SIZE,
          p_offset: filter.page * LIST_PAGE_SIZE,
        } as never,
      );
      if (error) throw error;
      const body = (data ?? {}) as { rows?: TenantRow[]; total?: number };
      return { rows: body.rows ?? [], total: Number(body.total ?? 0) };
    },
  });
}

/**
 * Send one entitlement change for one tenant. Only the field the operator chose
 * travels, together with the reason, so the RPC always sees a single intent. Throws
 * with the database's own message, which the dialog shows as a toast.
 */
export async function applyEntitlementChange(
  row: TenantRow,
  action: EntitlementAction,
  raw: string,
  reason: string,
): Promise<void> {
  const preview = previewEntitlement(row, action, raw);
  if (!preview.ok) throw new Error(preview.error);
  // Named rather than a loose record, so the one field this call carries is visible
  // in the type and dot access stays lint-clean.
  const args: {
    p_business_id: string;
    p_reason: string;
    p_slots?: number;
    p_extend_days?: number;
    p_trial_days?: number;
    p_until?: string;
    p_plan?: string;
  } = { p_business_id: row.id, p_reason: sanitizeText(reason, REASON_MAX_CHARS) };
  // The preview above already proved these parse, so the fallbacks are unreachable.
  const n = toInteger(raw);
  const at = endOfDay(raw);
  if (action === "slots") args.p_slots = n ?? 0;
  else if (action === "extend") args.p_extend_days = n ?? 0;
  else if (action === "trial") args.p_trial_days = n ?? 0;
  else if (action === "until") args.p_until = (at ?? new Date()).toISOString();
  else args.p_plan = raw;
  const { error } = await supabase.rpc("ops_update_subscription" as never, args as never);
  if (error) throw error;
}

/**
 * Which lifecycle verbs this operator role may send. `ops_set_tenant_state` takes
 * `billing` and `owner` but refuses `close`/`reopen` unless the caller is the super
 * admin, and `ops_purge_tenant` is super admin only — a suspension is a collections
 * step, while ending a business is a judgement.
 */
export function lifecycleActionsFor(role?: OperatorRole | null): LifecycleAction[] {
  if (role === "owner") return [...lifecycleActions];
  if (role === "billing") return ["suspend", "restore"];
  return [];
}

/** The day a closed tenant becomes purgeable — the same 30×24h SQL adds. */
export function purgeWindowEnds(closedAt: string): Date {
  return new Date(new Date(closedAt).getTime() + PURGE_WAIT_DAYS * DAY_MS);
}

/** What the waiting period still has to run, in whole days (0 means it is over). */
export function purgeWaitDaysLeft(closedAt: string, now = new Date()): number {
  const diff = purgeWindowEnds(closedAt).getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
}

export type LifecyclePreview = { ok: true; state: TenantState } | { ok: false; error: string };

/**
 * The refusals of `ops_set_tenant_state`, in its own words, so a button that would
 * certainly be rejected is explained before it is pressed. Role and state are the
 * two things the function weighs, and the state rules are the ladder this console
 * already displays: closed outranks suspended, and only `restore` clears a
 * suspension — reopening never does.
 */
export function previewLifecycle(
  row: TenantRow,
  action: LifecycleAction,
  role?: OperatorRole | null,
): LifecyclePreview {
  if (!lifecycleActionsFor(role).includes(action)) {
    return action === "close" || action === "reopen"
      ? refused("Only a super admin can close or reopen a business")
      : refused(`Your operator role (${role ?? "none"}) is not allowed to do this`);
  }
  const closed = !!row.closed_at;
  const suspended = !!row.suspended_at;
  if (action === "suspend") {
    if (closed) return refused("This tenant is closed — reopen it first");
    if (suspended) return refused("They are already suspended");
    return { ok: true, state: "suspended" };
  }
  if (action === "restore") {
    if (closed) return refused("This tenant is closed — reopen it instead");
    if (!suspended) return refused("They are not suspended");
    // The stamp is lifted before the state is read, so the preview shows the state
    // underneath — paid, trial or expired — exactly as SQL returns the new clocks.
    return {
      ok: true,
      state: tenantState({ ...row, suspended_at: null }, row.store_count, new Date()),
    };
  }
  if (action === "close") {
    if (closed) return refused("They are already closed");
    return { ok: true, state: "closed" };
  }
  if (!closed) return refused("They are not closed");
  return { ok: true, state: tenantState({ ...row, closed_at: null }, row.store_count, new Date()) };
}

/** The reason both RPCs accept: one clean line, at least eight characters of it. */
function reasonProblem(raw: string): string | null {
  const why = sanitizeText(raw, REASON_MAX_CHARS);
  return why.length < REASON_MIN_CHARS ? "Say why this changed (8 to 300 characters)" : null;
}

/**
 * Send one lifecycle change for one tenant. The state itself is re-read from the
 * roster afterwards rather than taken from this response, because SQL derives it.
 */
export async function applyLifecycleChange(
  row: TenantRow,
  action: LifecycleAction,
  reason: string,
): Promise<void> {
  const problem = reasonProblem(reason);
  if (problem) throw new Error(problem);
  const { error } = await supabase.rpc(
    "ops_set_tenant_state" as never,
    {
      p_business_id: row.id,
      p_action: action,
      p_reason: sanitizeText(reason, REASON_MAX_CHARS),
    } as never,
  );
  if (error) throw error;
}

/**
 * The last gate before an irreversible call. Purge is refused unless this is the
 * super admin, the tenant is closed, the 30-day window has run, and the operator has
 * retyped the business name exactly as the roster shows it. `previewPurge` mirrors
 * `ops_purge_tenant` in that order, including the date it would print.
 */
export function previewPurge(
  row: TenantRow,
  confirmName: string,
  reason: string,
  role?: OperatorRole | null,
  now = new Date(),
): { ok: true } | { ok: false; error: string } {
  if (role !== "owner")
    return refused(`Your operator role (${role ?? "none"}) is not allowed to do this`);
  const problem = reasonProblem(reason);
  if (problem) return refused(problem);
  if (!row.closed_at) return refused("Purge only accepts a closed business — close it first");
  if (purgeWaitDaysLeft(row.closed_at, now) > 0) {
    // The same `YYYY-MM-DD` the function prints into its own message.
    return refused(
      `The waiting period ends ${purgeWindowEnds(row.closed_at).toISOString().slice(0, 10)}`,
    );
  }
  if (confirmName.trim() !== row.name) {
    return refused("Type the business name exactly as it appears to confirm");
  }
  return { ok: true };
}

/**
 * Delete a closed tenant for good. This is the only call in the console that cannot
 * be undone: the cascade takes the stores, staff, catalog, sales, the stock ledger,
 * shifts and payments with it, leaving only the tombstone and the journal row.
 */
export async function applyPurge(
  row: TenantRow,
  confirmName: string,
  reason: string,
): Promise<void> {
  const problem = reasonProblem(reason);
  if (problem) throw new Error(problem);
  if (confirmName.trim() !== row.name) {
    throw new Error("Type the business name exactly as it appears to confirm");
  }
  const { error } = await supabase.rpc(
    "ops_purge_tenant" as never,
    {
      p_business_id: row.id,
      p_confirm_name: confirmName.trim(),
      p_reason: sanitizeText(reason, REASON_MAX_CHARS),
    } as never,
  );
  if (error) throw error;
}

/** Recent changes to one tenant, newest first. Every operator role may read them. */
export function useTenantAudit(businessId: string | null) {
  return useQuery({
    queryKey: ["ops", "audit", businessId],
    enabled: !!businessId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "ops_subscription_history" as never,
        { p_business_id: businessId, p_limit: 8 } as never,
      );
      if (error) throw error;
      return ((data as { rows?: AuditEntry[] } | null)?.rows ?? []) as AuditEntry[];
    },
  });
}

/** A charge PayChangu has not confirmed, as the console reads it. */
export type PendingPayment = {
  tx_ref: string;
  amount: number;
  currency: string;
  stores: number;
  billed_stores: number;
  period: string | null;
  created_at: string;
};

/**
 * References still waiting for money, newest first. Support reads this too: the
 * first responder should be able to answer "did my customer's money land?"
 * without asking billing to look.
 */
export function usePendingPayments(businessId: string | null) {
  return useQuery({
    queryKey: ["ops", "pending", businessId],
    enabled: !!businessId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "ops_pending_payments" as never,
        { p_business_id: businessId } as never,
      );
      if (error) throw error;
      return ((data as { rows?: PendingPayment[] } | null)?.rows ?? []) as PendingPayment[];
    },
  });
}

/**
 * Journal what the operator found. This grants nothing — the time and slots a
 * paid charge buys are still granted inside the server-side verifier — it only
 * records who checked and why, next to the outcome.
 */
export async function journalPaymentCheck(
  businessId: string,
  txRef: string,
  paid: boolean,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc(
    "ops_journal_payment_verification" as never,
    {
      p_business_id: businessId,
      p_tx_ref: txRef,
      p_status: paid ? "paid" : "unpaid",
      p_reason: sanitizeText(reason, REASON_MAX_CHARS),
    } as never,
  );
  if (error) throw error;
}
