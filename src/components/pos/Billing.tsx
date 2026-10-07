import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { supabase } from "@/integrations/supabase/client";
import { PRICES, YEARLY_FACTOR, loadPaychangu, useSubscription } from "@/lib/billing";
import { getPaychanguKey, verifySubscriptionPayment } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { CreditCardIcon, Download01Icon, ReceiptIcon, StoreIcon } from "@hugeicons/core-free-icons";

declare global { interface Window { PaychanguCheckout?: (o: Record<string, unknown>) => void } }

const fmt = (c: "MWK" | "USD", n: number) => c === "MWK" ? `MK${Math.round(n).toLocaleString()}` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function Billing({ locked }: { locked?: boolean }) {
  const { business, stores, can, rpc, lock } = usePos();
  const qc = useQueryClient();
  const sub = useSubscription(business?.id, stores.length);
  const getKey = useServerFn(getPaychanguKey);
  const verify = useServerFn(verifySubscriptionPayment);
  const [currency, setCurrency] = useState<"MWK" | "USD">("MWK");
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = useState(false);
  const checked = useRef(false);
  const [requestedStores, setRequestedStores] = useState(0);
  const minimumStores = Math.max(stores.length, sub.data?.paid ? sub.data.capacity : 0, 1);
  const n = Math.max(requestedStores, minimumStores);
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
        getKey(), rpc<{ tx_ref: string; amount: number }>("start_store_subscription_payment", { p_period: period, p_currency: currency, p_stores: n }), supabase.auth.getUser(), loadPaychangu(),
      ]);
      if (!key) throw new Error("Payments are not configured yet.");
      const url = `${window.location.origin}/app/billing`;
      if (!document.getElementById("wrapper")) {
        const w = document.createElement("div");
        w.id = "wrapper";
        document.body.appendChild(w);
      }
      if (!window.PaychanguCheckout) throw new Error("PayChangu could not open. Please try again.");
      window.PaychanguCheckout({
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
  const history = useQuery({
    queryKey: ["subscription", "history", business?.id],
    enabled: !!business?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("subscription_payments").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Inv[];
    },
  });
  const status = s?.overLimit ? { label: "Store limit exceeded", cls: "bg-destructive/15 text-destructive" } : until ? { label: "Active", cls: "bg-accent/15 text-accent" } : s?.trial ? { label: "Free trial", cls: "bg-secondary text-foreground" } : { label: "Expired", cls: "bg-destructive/15 text-destructive" };
  const canPay = can("admin", "manager");

  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-10", locked && "py-12")}>
      <div>
        <h1 className="text-3xl font-semibold">{locked ? s?.overLimit ? "Your stores exceed paid capacity" : "Your subscription needs attention" : "Billing & subscription"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Your plan, payments and invoices.</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
        <section className="space-y-7 border-b pb-8 lg:col-span-2 lg:border-b-0 lg:border-r lg:pr-10">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><HugeiconsIcon icon={CreditCardIcon} className="size-4" /> Current subscription</span>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", status.cls)}>{status.label}</span>
          </div>
          <div>
            <div className="text-3xl font-semibold capitalize">{sub.isPending ? "Loading…" : until ? `${s?.sub?.plan ?? "Storq"} plan` : s?.trial ? "Free trial" : "No active plan"}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {until ? `Renews / expires ${until.toLocaleDateString(undefined, { dateStyle: "long" })}` : s?.trial && trialEnd ? `Trial ends ${trialEnd.toLocaleString()}` : "Subscribe to keep selling."}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t pt-6 text-sm">
            <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><HugeiconsIcon icon={StoreIcon} className="size-4" /> Stores / paid slots</dt><dd className="mt-3 text-2xl font-semibold">{stores.length} / {s?.capacity ?? 0}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Monthly / store</dt><dd className="mt-3 text-xl font-semibold">{fmt(currency, PRICES[currency])}</dd></div>
          </dl>
          {locked && <Button variant="outline" className="w-full" onClick={lock}>Switch staff</Button>}
        </section>

        <section className="space-y-6 lg:col-span-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{until ? "Renew or extend" : "Choose a plan"}</span>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(["MWK", "USD"] as const).map((c) => (
                <Button key={c} size="sm" variant="ghost" aria-pressed={currency === c} onClick={() => setCurrency(c)} className={cn("text-xs font-semibold", currency === c ? "bg-secondary text-foreground" : "text-muted-foreground")}>{c}</Button>
              ))}
            </div>
          </div>
          {!canPay ? <p className="text-sm text-muted-foreground">Ask an admin or manager to renew the subscription.</p> : <>
            <div className="space-y-2">
              <label htmlFor="billing-stores" className="text-sm font-medium">Store slots to subscribe</label>
              <Input id="billing-stores" type="number" min={minimumStores} max={1000} step={1} value={n} onChange={(e) => setRequestedStores(Math.max(minimumStores, Math.min(1000, Math.trunc(Number(e.target.value) || minimumStores))))} />
              <p className="text-xs text-muted-foreground">Each store needs a paid slot. Buy extra slots before adding stores.{s?.paid && n > s.capacity ? " Remaining prepaid time is credited across the larger store count; your expiry date is recalculated after payment." : ""}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["monthly", "yearly"] as const).map((p) => {
                const amt = p === "yearly" ? monthly * YEARLY_FACTOR : monthly;
                return (
                  <Button key={p} variant="outline" aria-pressed={period === p} onClick={() => setPeriod(p)} className={cn("billing-plan h-auto flex-col items-stretch justify-start gap-0 whitespace-normal p-5 text-left shadow-none", period === p && "border-accent")}>
                    <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium capitalize">{p}</span>{p === "yearly" && <span className="rounded bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent">Save 15%</span>}</span>
                    <span className="mt-5 text-2xl font-semibold tabular">{fmt(currency, amt)}</span>
                    <span className="mt-2 text-xs font-normal text-muted-foreground">{p === "yearly" ? "Billed every year" : "Billed every month"}</span>
                  </Button>
                );
              })}
            </div>
            <div className="space-y-3 border-y py-5 text-sm">
              <div className="flex justify-between"><span>{fmt(currency, PRICES[currency])} × {n} store{n > 1 ? "s" : ""} / month</span><span>{fmt(currency, monthly)}</span></div>
              {period === "yearly" && <div className="flex justify-between text-muted-foreground"><span>12 months, 15% off</span><span>−{fmt(currency, monthly * 12 - total)}</span></div>}
              <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span>{fmt(currency, total)}</span></div>
            </div>
            <Button size="lg" variant="accent" className="w-full" disabled={busy} onClick={pay}><HugeiconsIcon icon={CreditCardIcon} />{busy ? "Opening…" : `Pay ${fmt(currency, total)}`}</Button>
            <p className="text-center text-xs text-muted-foreground">Airtel Money, TNM Mpamba or card via PayChangu.</p>
          </>}
        </section>
      </div>

      <section className="overflow-hidden border-t pt-8">
        <div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-semibold">Billing history</h2><span className="text-xs text-muted-foreground">{history.data?.length ?? 0} payments</span></div>
        {history.isPending ? <p className="py-8 text-sm text-muted-foreground">Loading payments…</p> : history.isError ? <p className="py-8 text-sm text-destructive">Payments could not be loaded.</p> : !history.data?.length ? <div className="flex flex-col items-center gap-3 border-y py-12"><HugeiconsIcon icon={ReceiptIcon} className="size-7 text-muted-foreground" /><p className="font-medium">No payments yet</p><p className="text-sm text-muted-foreground">Your paid invoices will appear here.</p></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="p-3">Date</th><th className="p-3">Invoice</th><th className="p-3">Plan</th><th className="p-3">Stores</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
              <tbody>
                {history.data.map((r) => (
                  <tr key={r.tx_ref} className="border-t">
                    <td className="p-3">{new Date(r.paid_at ?? r.created_at).toLocaleDateString()}</td>
                    <td className="p-3 font-mono text-xs">{r.tx_ref}</td>
                    <td className="p-3 capitalize">{r.period}</td>
                    <td className="p-3">{r.stores}</td>
                    <td className="p-3 font-semibold">{fmt(r.currency as "MWK" | "USD", Number(r.amount))}</td>
                    <td className="p-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", r.status === "paid" ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground")}>{r.status}</span></td>
                    <td className="p-3 text-right">{r.status === "paid" ? <Button size="sm" variant="ghost" aria-label={`Download invoice ${r.tx_ref}`} title="Download invoice" onClick={() => printInvoice(r, business?.name ?? "")}><HugeiconsIcon icon={Download01Icon} /> Invoice</Button> : <span className="text-xs text-muted-foreground">Not paid</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type Inv = { tx_ref: string; period: string; currency: string; amount: number; stores: number; status: string; created_at: string; paid_at: string | null };

function printInvoice(r: Inv, biz: string) {
  const c = r.currency as "MWK" | "USD";
  const d = new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, { dateStyle: "long" });
  const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] ?? ch));
  const w = window.open("", "_blank");
  if (!w) { toast.error("Allow pop-ups to download the invoice."); return; }
  w.document.write(`<!doctype html><html><head><title>Invoice ${esc(r.tx_ref)}</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111;padding:0 24px}h1{margin:0;font-size:28px}.m{color:#666;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:32px}td,th{padding:12px 0;border-bottom:1px solid #eee;text-align:left}.r{text-align:right}.t{font-weight:700;font-size:18px}.paid{display:inline-block;background:#e7f6ec;color:#147a3d;padding:4px 10px;border-radius:99px;font-weight:600;font-size:12px}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:start"><div><h1>Storq</h1><div class="m">Subscription invoice</div></div><span class="paid">PAID</span></div>
<div style="display:flex;justify-content:space-between;margin-top:32px"><div><div class="m">Billed to</div><b>${esc(biz)}</b></div><div class="r"><div class="m">Invoice</div><b>${esc(r.tx_ref)}</b><div class="m">${d}</div></div></div>
<table><tr><th>Description</th><th class="r">Amount</th></tr><tr><td>Storq ${esc(r.period)} plan · ${r.stores} store${r.stores > 1 ? "s" : ""}</td><td class="r">${fmt(c, Number(r.amount))}</td></tr><tr><td class="t">Total paid</td><td class="r t">${fmt(c, Number(r.amount))}</td></tr></table>
<p class="m" style="margin-top:32px">Paid via PayChangu. Thank you for using Storq.</p><script>onload=()=>print()</script></body></html>`);
  w.document.close();
}
