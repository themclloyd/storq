import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscriptionAccess, type Subscription } from "@/lib/subscription-policy";
export type { Subscription } from "@/lib/subscription-policy";

export const PRICES = { MWK: 60000, USD: 35 } as const;
export const YEARLY_FACTOR = 12 * 0.85;
export type Currency = keyof typeof PRICES;

// ── Quick-pick months (shown as tap targets; the stepper allows any value 1-24) ──
export const MONTH_PRESETS = [1, 3, 6, 12] as const;

/**
 * Price for a term: flat per-store monthly rate × months, with the 15% discount
 * that `start_store_subscription_payment` applies at 12+ months. Kept here rather
 * than in the page because the expiry banner quotes it too.
 */
export function calcTotal(currency: Currency, stores: number, months: number): number {
  const monthly = PRICES[currency] * stores;
  const discount = months >= 12 ? YEARLY_FACTOR / 12 : 1; // YEARLY_FACTOR = 12 × 0.85
  return Math.round(monthly * months * discount * 100) / 100;
}

/**
 * Mean Gregorian month in seconds, the divisor `start_store_subscription_payment`
 * uses when it prices a slot bought mid-term. Seconds rather than calendar months
 * because the remainder of a paid term is rarely a whole month, and the server
 * rounds it up before charging.
 */
export const MONTH_SECONDS = 2_629_800;

/**
 * Add calendar months the way `make_interval(months => n)` does: the same day in the
 * target month, clamped to that month's last day. `setMonth` on its own rolls
 * 31 January + 1 month into 3 March, which would quote an expiry the server never
 * grants.
 */
export function addMonths(from: Date, months: number): Date {
  const out = new Date(from.getTime());
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDay));
  return out;
}

/**
 * Slots one payment charges for. A running term has already paid for the slots it
 * holds, so raising the count is priced on the difference alone; a renewal or a
 * reactivation is priced on the whole capacity. Mirrors the `billed` rule inside
 * `start_store_subscription_payment`.
 */
export function billedSlotCount(totalSlots: number, paidSlots: number): number {
  return paidSlots > 0 && totalSlots > paidSlots ? totalSlots - paidSlots : totalSlots;
}

/**
 * Whole months left on a paid term, rounded up and never below one, the term a slot
 * bought mid-cycle joins. Mirrors the `2629800` division in SQL, so the months a
 * prorated purchase is charged for are the months the database derives.
 */
export function remainingTermMonths(
  paidUntil: string | Date | null | undefined,
  now = Date.now(),
): number {
  const end = paidUntil ? new Date(paidUntil).getTime() : 0;
  if (!Number.isFinite(end) || end <= now) return 1;
  return Math.max(1, Math.ceil((end - now) / (MONTH_SECONDS * 1000)));
}

export type PaymentQuote = {
  /** Slots the provider is asked to charge for. */
  billedSlots: number;
  /** Months paid for: the caller's choice, or derived when only capacity grows. */
  months: number;
  total: number;
  /** The expiry this payment buys. A capacity purchase never moves it earlier. */
  expiry: Date;
  /** True when the payment adds slots to a term that is already paid for. */
  isCapacity: boolean;
};

/**
 * One description of what a payment charges and what it buys, shared by the price
 * summary, the pay button and the expiry line, so the money shown and the money
 * taken cannot disagree. Mirrors `start_store_subscription_payment` and
 * `complete_subscription_payment` exactly.
 */
export function paymentQuote(opts: {
  currency: Currency;
  totalSlots: number;
  paidSlots: number;
  paidUntil: string | Date | null | undefined;
  months: number;
  now?: number;
}): PaymentQuote {
  const now = opts.now ?? Date.now();
  const billedSlots = billedSlotCount(opts.totalSlots, opts.paidSlots);
  const isCapacity = billedSlots < opts.totalSlots;
  // A capacity purchase joins the term already bought, so its length is derived; a
  // term purchase is however many months the owner picked.
  const months = isCapacity ? remainingTermMonths(opts.paidUntil, now) : Math.max(1, opts.months);
  const end = opts.paidUntil ? new Date(opts.paidUntil).getTime() : 0;
  const running = Number.isFinite(end) && end > now;
  const base = running ? new Date(end) : new Date(now);
  return {
    billedSlots,
    months,
    total: calcTotal(opts.currency, billedSlots, months),
    // Only a capacity purchase joins the term already bought: its expiry does not
    // move. Everything else adds its months to whichever date is later, today or
    // the paid expiry, so prepaid time is never thrown away.
    expiry: isCapacity && running ? base : addMonths(base, months),
    isCapacity,
  };
}

/** Money as the shopkeeper reads it: kwacha whole, dollars to two decimals. */
export function fmtMoney(currency: Currency, n: number): string {
  return currency === "MWK"
    ? `MK${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function useSubscription(businessId?: string, storeCount = 0) {
  // Key the cache on the DB input alone. storeCount only feeds the pure
  // subscriptionAccess() derivation, so it must NOT be in the key: otherwise
  // the store list resolving 0→N on hydration (or any add/remove) hands react-
  // query a brand-new key and it re-hits the database, defeating staleTime.
  const query = useQuery({
    queryKey: ["subscription", businessId],
    enabled: !!businessId,
    // Enforcement lives in SQL (every write checks it). The client only needs
    // the expiry dates, which it evaluates locally; no polling. Payments
    // invalidate ["subscription"] and the device cache shows it instantly.
    staleTime: 6 * 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      // subscriptions predates type regeneration for paid_store_limit and the
      // operator lifecycle stamps, read via any-cast with an explicit column list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("subscriptions")
        .select("trial_ends_at,paid_until,plan,paid_store_limit,suspended_at,closed_at")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) throw error;
      return data as Subscription | null;
    },
  });
  // Access is derived from the cached row + live store count without refetching.
  // Re-evaluate expiry locally once a minute so a lapse is noticed without a fetch.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const access = subscriptionAccess(query.data ?? null, storeCount);
  return { ...query, data: access, hasRow: query.data !== undefined };
}

let scriptP: Promise<void> | null = null;
export function loadPaychangu() {
  if (scriptP) return scriptP;
  scriptP = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://in.paychangu.com/js/popup.js";
    el.onload = () => resolve();
    el.onerror = () => {
      scriptP = null;
      reject(new Error("Could not load PayChangu"));
    };
    document.body.appendChild(el);
  });
  return scriptP;
}
