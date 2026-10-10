export type Subscription = {
  trial_ends_at: string;
  paid_until: string | null;
  plan: string | null;
  paid_store_limit: number;
};

export function subscriptionAccess(sub: Subscription | null, storeCount: number, now = Date.now()) {
  const paid = !!sub?.paid_until && new Date(sub.paid_until).getTime() > now;
  const trial = !!sub && !paid && new Date(sub.trial_ends_at).getTime() > now;
  const capacity = sub?.paid_store_limit ?? 0;
  const overLimit = paid && storeCount > capacity;
  return {
    sub,
    paid,
    trial,
    capacity,
    overLimit,
    active: trial || (paid && !overLimit),
    canAddStore: trial || (paid && storeCount < capacity),
  };
}
