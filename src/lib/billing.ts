import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subscriptionAccess, type Subscription } from "@/lib/subscription-policy";
export type { Subscription } from "@/lib/subscription-policy";

export const PRICES = { MWK: 60000, USD: 35 } as const;
export const YEARLY_FACTOR = 12 * 0.85;

export function useSubscription(businessId?: string, storeCount = 0) {
  return useQuery({
    queryKey: ["subscription", businessId, storeCount],
    enabled: !!businessId,
    // Enforcement lives in SQL; this only refreshes the banner, so poll gently.
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("subscriptions").select("trial_ends_at,paid_until,plan,paid_store_limit").eq("business_id", businessId).maybeSingle();
      if (error) throw error;
      const s = data as Subscription | null;
      return subscriptionAccess(s, storeCount);
    },
  });
}

let scriptP: Promise<void> | null = null;
export function loadPaychangu() {
  if (scriptP) return scriptP;
  scriptP = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://in.paychangu.com/js/popup.js";
    el.onload = () => resolve();
    el.onerror = () => { scriptP = null; reject(new Error("Could not load PayChangu")); };
    document.body.appendChild(el);
  });
  return scriptP;
}
