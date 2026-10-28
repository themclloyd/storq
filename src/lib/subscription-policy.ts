export type Subscription = {
  trial_ends_at: string;
  paid_until: string | null;
  plan: string | null;
  paid_store_limit: number;
  /**
   * Platform-operator lifecycle stamps. Optional because a device may still hold a
   * snapshot taken before these columns existed (and `null` is the normal case), so
   * an absent field must never read as "blocked".
   */
  suspended_at?: string | null;
  closed_at?: string | null;
};

/**
 * Days a lapsed prepaid term still keeps the till open, the mirror of the
 * `paid_until + interval '3 days'` window in `subscription_active()`. A shop must
 * never stop serving customers because the only holder of the mobile-money SIM
 * was asleep when the term ran out.
 */
export const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 86_400_000;

/**
 * Days a spent free trial still keeps the tills open, the mirror of the
 * `trial_ends_at + interval '1 day'` window in `subscription_active()`. A trial is
 * a single day, and one more day after it ends is enough to reach a mobile-money
 * agent without turning a free account into a free month.
 */
export const TRIAL_GRACE_DAYS = 1;
const TRIAL_GRACE_MS = TRIAL_GRACE_DAYS * 86_400_000;

/**
 * How early the shell starts warning that the free trial is about to end. A trial
 * fails to a countdown rather than a bill, so the notice has to arrive while there
 * is still time to pay. On the single-day trial this means it is up from the
 * moment the shop signs up, which is the point.
 */
export const TRIAL_NOTICE_DAYS = 7;

export function subscriptionAccess(sub: Subscription | null, storeCount: number, now = Date.now()) {
  // Mirrors `subscription_active()` in SQL, which refuses every business write
  // while an operator has suspended or closed the account, and otherwise accepts a
  // paid term (plus the grace window) within the paid store capacity, or a trial on
  // a single store, plus one day after the trial ends. This copy is only for the
  // screen the shopkeeper sees; the database stays the authority, so a stale cached
  // row can delay the notice but never grant a sale. A suspension lifts itself on
  // the next confirmed payment (SQL clears it there), a closure does not.
  //
  // The store count is part of both branches because SQL reads it in the same
  // expression: a term is only as good as the slots it paid for, and a trial was
  // never more than one location.
  const suspended = !!sub?.suspended_at;
  const closed = !!sub?.closed_at;
  const paid = !!sub?.paid_until && new Date(sub.paid_until).getTime() > now;
  const trialEndsMs = sub ? new Date(sub.trial_ends_at).getTime() : 0;
  const trial = !!sub && !paid && trialEndsMs > now;
  const capacity = sub?.paid_store_limit ?? 0;
  const overLimit = paid && storeCount > capacity;
  // Grace only moves the expiry clock: over-capacity, suspension and closure still
  // block immediately, exactly as the SQL branches do.
  const paidUntil = sub?.paid_until ? new Date(sub.paid_until).getTime() : 0;
  const expired = !!sub?.paid_until && !paid;
  const inGrace =
    !suspended && !closed && expired && now < paidUntil + GRACE_MS && storeCount <= capacity;
  const graceDaysRemaining = inGrace
    ? Math.max(0, Math.ceil((paidUntil + GRACE_MS - now) / 86_400_000))
    : 0;
  // The trial gets one day of the same courtesy, still on its single store and only
  // while no paid term is running. SQL's trial branch asks the same three things;
  // the `trialEndsMs <= now` half is what keeps this the window *after* the trial
  // rather than the trial itself.
  const inTrialGrace =
    !!sub &&
    !paid &&
    !suspended &&
    !closed &&
    trialEndsMs <= now &&
    now < trialEndsMs + TRIAL_GRACE_MS &&
    storeCount <= 1;
  const trialGraceDaysRemaining = inTrialGrace
    ? Math.max(0, Math.ceil((trialEndsMs + TRIAL_GRACE_MS - now) / 86_400_000))
    : 0;
  const trialDaysRemaining = trial ? Math.max(0, Math.ceil((trialEndsMs - now) / 86_400_000)) : 0;
  return {
    sub,
    paid,
    trial,
    suspended,
    closed,
    capacity,
    overLimit,
    inGrace,
    graceDaysRemaining,
    inTrialGrace,
    trialGraceDaysRemaining,
    trialDaysRemaining,
    trialEndingSoon: trial && trialDaysRemaining <= TRIAL_NOTICE_DAYS,
    // A second store on a trial, or one more than the paid capacity, is a write SQL
    // refuses, so the shell must not stay open on either, and the add-location
    // affordance must not offer it.
    active:
      !suspended &&
      !closed &&
      ((paid && !overLimit) || inGrace || (trial && storeCount <= 1) || inTrialGrace),
    canAddStore:
      !suspended && !closed && ((paid && storeCount < capacity) || (trial && storeCount < 1)),
  };
}
