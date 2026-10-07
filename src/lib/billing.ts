import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Subscription = { trial_ends_at: string; paid_until: string | null; plan: string | null };

export const PRICES = { MWK: 60000, USD: 35 } as const;
export const YEARLY_FACTOR = 12 * 0.85;

export function useSubscription(businessId?: string) {
  return useQuery({
    queryKey: ["subscription", businessId],
    enabled: !!businessId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("subscriptions").select("trial_ends_at,paid_until,plan").maybeSingle();
      if (error) throw error;
      const s = data as Subscription | null;
      const now = Date.now();
      const trial = s ? new Date(s.trial_ends_at).getTime() > now : false;
      const paid = s?.paid_until ? new Date(s.paid_until).getTime() > now : false;
      return { sub: s, trial, paid, active: trial || paid || !s };
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
