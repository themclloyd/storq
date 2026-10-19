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
 * Days a lapsed prepaid term still keeps the till open — the mirror of the
 * `paid_until + interval '3 days'` window in `subscription_active()`. A shop must
 * never stop serving customers because the only holder of the mobile-money SIM
 * was asleep when the term ran out.
 */
export const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 86_400_000;

export function subscriptionAccess(sub: Subscription | null, storeCount: number, now = Date.now()) {
  // Mirrors `subscription_active()` in SQL, which refuses every business write
  // while an operator has suspended or closed the account, and otherwise accepts a
  // paid term (plus the grace window) within the paid store capacity, or a trial on
  // a single store. This copy is only for the screen the shopkeeper sees; the
  // database stays the authority, so a stale cached row can delay the notice but
  // never grant a sale. A suspension lifts itself on the next confirmed payment
  // (SQL clears it there), a closure does not.
  const suspended = !!sub?.suspended_at;
  const closed = !!sub?.closed_at;
  const paid = !!sub?.paid_until && new Date(sub.paid_until).getTime() > now;
  const trial = !!sub && !paid && new Date(sub.trial_ends_at).getTime() > now;
  const capacity = sub?.paid_store_limit ?? 0;
  const overLimit = paid && storeCount > capacity;
  // Grace only moves the expiry clock: over-capacity, suspension and closure still
  // block immediately, exactly as the SQL branches do. The trial gets no grace.
  const paidUntil = sub?.paid_until ? new Date(sub.paid_until).getTime() : 0;
  const expired = !!sub?.paid_until && !paid;
  const inGrace =
    !suspended && !closed && expired && now < paidUntil + GRACE_MS && storeCount <= capacity;
  const graceDaysRemaining = inGrace
    ? Math.max(0, Math.ceil((paidUntil + GRACE_MS - now) / 86_400_000))
    : 0;
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
    active: !suspended && !closed && (trial || (paid && !overLimit) || inGrace),
    canAddStore: !suspended && !closed && (trial || (paid && storeCount < capacity)),
  };
}
