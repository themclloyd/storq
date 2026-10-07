import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { supabase } from "@/integrations/supabase/client";
import { PRICES, YEARLY_FACTOR, loadPaychangu, useSubscription } from "@/lib/billing";
import { getPaychanguKey, verifySubscriptionPayment } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

declare global { interface Window { PaychanguCheckout?: (o: Record<string, unknown>) => void } }

const fmt = (c: "MWK" | "USD", n: number) => c === "MWK" ? `MK${Math.round(n).toLocaleString()}` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function Billing({ locked }: { locked?: boolean }) {
  const { business, stores, can, rpc, lock } = usePos();
  const qc = useQueryClient();
  const sub = useSubscription(business?.id);
  const getKey = useServerFn(getPaychanguKey);
  const verify = useServerFn(verifySubscriptionPayment);
  const [currency, setCurrency] = useState<"MWK" | "USD">("MWK");
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = useState(false);
  const checked = useRef(false);
  const n = Math.max(stores.length, 1);
  const monthly = PRICES[currency] * n;
  const total = period === "yearly" ? monthly * YEARLY_FACTOR : monthly;

  async function check(ref: string) {
    const r = await verify({ data: { tx_ref: ref } });
    if (r.ok) { toast.success("Payment received — thank you!"); qc.invalidateQueries({ queryKey: ["subscription"] }); }
    else toast.error(r.message);
  }

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const ref = new URLSearchParams(window.location.search).get("tx_ref");
    if (ref) { check(ref); window.history.replaceState(null, "", window.location.pathname); }
  }, []);

  async function pay() {
    setBusy(true);
    try {
      const [{ key }, start, { data: u }] = await Promise.all([
        getKey(), rpc<{ tx_ref: string; amount: number }>("start_subscription_payment", { p_period: period, p_currency: currency }), supabase.auth.getUser(), loadPaychangu(),
      ]);
      if (!key) throw new Error("Payments are not configured yet.");
      const url = `${window.location.origin}/app/billing`;
      window.PaychanguCheckout?.({
        public_key: key, tx_ref: start.tx_ref, amount: start.amount, currency,
        callback_url: url, return_url: url,
        customer: { email: u.user?.email ?? "", first_name: business?.name ?? "Storq", last_name: "" },
        customization: { title: "Storq subscription", description: `${n} store${n > 1 ? "s" : ""} · ${period}` },
        meta: { business: business?.id },
      });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const s = sub.data;
  const until = s?.sub?.paid_until && s.paid ? new Date(s.sub.paid_until) : null;
  const trialEnd = s?.sub ? new Date(s.sub.trial_ends_at) : null;

  return (
    <div className={cn("mx-auto w-full max-w-2xl", locked && "py-12")}>
      <h1 className="text-2xl font-bold">{locked ? "Your free trial has ended" : "Subscription"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {until ? `Active until ${until.toLocaleDateString()}.` : s?.trial && trialEnd ? `Free trial ends ${trialEnd.toLocaleString()}.` : "Subscribe to keep selling with Storq."}
      </p>

      {!can("admin", "manager") ? (
        <div className="pos-card mt-6 p-6 text-sm">Ask an admin or manager to renew the subscription.{locked && <Button className="mt-4 w-full" variant="outline" onClick={lock}>Switch staff</Button>}</div>
      ) : (
        <div className="pos-card mt-6 space-y-5 p-6">
          <div className="grid grid-cols-2 gap-2">
            {(["monthly", "yearly"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={cn("rounded-lg border p-4 text-left", period === p && "border-primary ring-2 ring-primary")}>
                <div className="font-bold capitalize">{p}</div>
                <div className="text-xs text-muted-foreground">{p === "yearly" ? "Save 15%" : "Billed every month"}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["MWK", "USD"] as const).map((c) => (
              <Button key={c} size="sm" variant={currency === c ? "default" : "outline"} onClick={() => setCurrency(c)}>{c}</Button>
            ))}
          </div>
          <div className="space-y-1 rounded-lg bg-muted p-4 text-sm">
            <div className="flex justify-between"><span>{fmt(currency, PRICES[currency])} × {n} store{n > 1 ? "s" : ""} / month</span><span>{fmt(currency, monthly)}</span></div>
            {period === "yearly" && <div className="flex justify-between text-muted-foreground"><span>12 months, 15% off</span><span>−{fmt(currency, monthly * 12 - total)}</span></div>}
            <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span>{fmt(currency, total)}</span></div>
          </div>
          <Button size="lg" variant="accent" className="w-full" disabled={busy} onClick={pay}>{busy ? "Opening…" : `Pay ${fmt(currency, total)}`}</Button>
          <p className="text-center text-xs text-muted-foreground">Pay with Airtel Money, TNM Mpamba or card via PayChangu.</p>
          {locked && <Button variant="ghost" className="w-full" onClick={lock}>Switch staff</Button>}
        </div>
      )}
    </div>
  );
}
