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

export function subscriptionAccess(sub: Subscription | null, storeCount: number, now = Date.now()) {
  // Mirrors `subscription_active()` in SQL, which now refuses every business write
  // while an operator has suspended or closed the account. This copy is only for the
  // screen the shopkeeper sees; the database stays the authority, so a stale cached
  // row can delay the notice but never grant a sale. A suspension lifts itself on
  // the next confirmed payment (SQL clears it there), a closure does not.
  const suspended = !!sub?.suspended_at;
  const closed = !!sub?.closed_at;
  const paid = !!sub?.paid_until && new Date(sub.paid_until).getTime() > now;
  const trial = !!sub && !paid && new Date(sub.trial_ends_at).getTime() > now;
  const capacity = sub?.paid_store_limit ?? 0;
  const overLimit = paid && storeCount > capacity;
  return {
    sub,
    paid,
    trial,
    suspended,
    closed,
    capacity,
    overLimit,
    active: !suspended && !closed && (trial || (paid && !overLimit)),
    canAddStore: !suspended && !closed && (trial || (paid && storeCount < capacity)),
  };
}
