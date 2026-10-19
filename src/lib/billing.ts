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
      // operator lifecycle stamps — read via any-cast with an explicit column list
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
