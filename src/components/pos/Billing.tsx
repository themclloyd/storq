import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { supabase } from "@/integrations/supabase/client";
import { PRICES, YEARLY_FACTOR, loadPaychangu, useSubscription } from "@/lib/billing";
import { getPaychanguKey, verifySubscriptionPayment } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  CreditCardIcon,
  Download01Icon,
  File01Icon,
  ReceiptIcon,
  Settings01Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";

declare global {
  interface Window {
    PaychanguCheckout?: (o: Record<string, unknown>) => void;
  }
}

const fmt = (c: "MWK" | "USD", n: number) =>
  c === "MWK"
    ? `MK${Math.round(n).toLocaleString()}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function Billing({ locked }: { locked?: boolean }) {
  const { business, stores, can, rpc, lock } = usePos();
  const qc = useQueryClient();
  const sub = useSubscription(business?.id, stores.length);
  const getKey = useServerFn(getPaychanguKey);
  const verify = useServerFn(verifySubscriptionPayment);
  const [planOpen, setPlanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
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
    if (r.ok) {
      toast.success("Payment received — thank you!");
      qc.invalidateQueries({ queryKey: ["subscription"] });
    } else toast.error(r.message);
  }

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const ref = new URLSearchParams(window.location.search).get("tx_ref");
    if (ref) {
      check(ref);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function pay() {
    setBusy(true);
    try {
      const [{ key }, start, { data: u }] = await Promise.all([
        getKey(),
        rpc<{ tx_ref: string; amount: number }>("start_store_subscription_payment", {
          p_period: period,
          p_currency: currency,
          p_stores: n,
        }),
        supabase.auth.getUser(),
        loadPaychangu(),
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
        public_key: key,
        tx_ref: start.tx_ref,
        amount: start.amount,
        currency,
        callback_url: url,
        return_url: url,
        customer: {
          email: u.user?.email ?? "",
          first_name: business?.name ?? "Storq",
          last_name: "",
        },
        customization: {
          title: "Storq subscription",
          description: `${n} store${n > 1 ? "s" : ""} · ${period}`,
        },
        meta: { business: business?.id },
      });
      setPlanOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = sub.data;
  const until = s?.sub?.paid_until && s.paid ? new Date(s.sub.paid_until) : null;
  const trialEnd = s?.sub ? new Date(s.sub.trial_ends_at) : null;
  const history = useQuery({
    queryKey: ["subscription", "history", business?.id],
    enabled: !!business?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_payments")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Inv[];
    },
  });
  const status = s?.overLimit
    ? { label: "Store limit exceeded", cls: "bg-destructive/15 text-destructive" }
    : until
      ? { label: "Active", cls: "bg-accent/15 text-accent" }
      : s?.trial
        ? { label: "Free trial", cls: "bg-secondary text-foreground" }
        : { label: "Expired", cls: "bg-destructive/15 text-destructive" };
  const canPay = can("admin", "manager");
  const lastPaid = history.data?.find((r) => r.status === "paid") ?? null;
  const paidInvoices = (history.data ?? []).filter((r) => r.status === "paid");
  const usagePct = s?.capacity ? Math.min(100, Math.round((stores.length / s.capacity) * 100)) : 0;

  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-8", locked && "py-6")}>
      <div>
        <h1 className="text-xl font-semibold">
          {locked
            ? s?.overLimit
              ? "Your stores exceed paid capacity"
              : "Your subscription needs attention"
            : "Billing"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Your plan, payments and invoices.</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="flex flex-col justify-between rounded-xl border bg-card p-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    {sub.isPending
                      ? "Loading…"
                      : until
                        ? `${s?.sub?.plan ?? "Storq"} plan`
                        : s?.trial
                          ? "Free trial"
                          : "No active plan"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                      status.cls,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {until
                    ? `Renews / expires ${until.toLocaleDateString(undefined, { dateStyle: "long" })}`
                    : s?.trial && trialEnd
                      ? `Trial ends ${trialEnd.toLocaleDateString()}`
                      : "Subscribe to keep selling."}
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-semibold tabular">
                  {fmt(currency, PRICES[currency])}
                </div>
                <div className="text-xs text-muted-foreground">per store / month</div>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>
                  {stores.length} of {s?.capacity ?? 0} stores used
                </span>
                <span className="text-muted-foreground">
                  {fmt(currency, PRICES[currency])} × {stores.length} ={" "}
                  {fmt(currency, PRICES[currency] * stores.length)}/mo
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    s?.overLimit ? "bg-destructive" : "bg-accent",
                  )}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between border-t pt-4">
            {locked ? (
              <Button variant="outline" size="sm" onClick={lock}>
                Switch staff
              </Button>
            ) : (
              <span />
            )}
            {canPay && (
              <Button
                variant="ghost"
                size="sm"
                className="text-accent hover:text-accent"
                onClick={() => setPlanOpen(true)}
              >
                {until ? "Renew or extend" : "Upgrade plan"}{" "}
                <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
              </Button>
            )}
          </div>
        </section>

        <section className="flex flex-col justify-between rounded-xl border bg-card p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <HugeiconsIcon icon={Wallet01Icon} className="size-4 text-muted-foreground" /> Payment
              method
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Change how you pay for your plan.</p>
            <div className="mt-4 flex items-center gap-3 rounded-lg border p-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={CreditCardIcon} className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">
                  {lastPaid
                    ? `Last payment · ${lastPaid.currency === "USD" ? "Card / USD" : "Mobile money or card"}`
                    : "No payment yet"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {lastPaid
                    ? `${new Date(lastPaid.paid_at ?? lastPaid.created_at).toLocaleDateString(undefined, { dateStyle: "long" })} · ${fmt(lastPaid.currency as "MWK" | "USD", Number(lastPaid.amount))}`
                    : "Airtel Money, TNM Mpamba or card via PayChangu."}
                </div>
              </div>
              {canPay && (
                <Button variant="outline" size="sm" onClick={() => setPayOpen(true)}>
                  Update
                </Button>
              )}
            </div>
          </div>
          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
            Payments are processed by PayChangu; no card details are stored on Storq.
          </p>
        </section>
      </div>

      <section>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Billing and invoicing</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Invoices for every subscription payment.
            </p>
          </div>
          <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <HugeiconsIcon icon={Download01Icon} /> Download all
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Download all invoices</DialogTitle>
                <DialogDescription>
                  {paidInvoices.length} paid invoice{paidInvoices.length === 1 ? "" : "s"} will open
                  one by one for printing or saving as PDF. Allow pop-ups for this site.
                </DialogDescription>
              </DialogHeader>
              {paidInvoices.length ? (
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {paidInvoices.map((r) => (
                    <li
                      key={r.tx_ref}
                      className="flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <HugeiconsIcon
                          icon={File01Icon}
                          className="size-4 shrink-0 text-muted-foreground"
                        />{" "}
                        Invoice{" "}
                        {new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span className="shrink-0 font-medium tabular">
                        {fmt(r.currency as "MWK" | "USD", Number(r.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-sm text-muted-foreground">No paid invoices yet.</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDownloadOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!paidInvoices.length}
                  onClick={() => {
                    paidInvoices.forEach((r, i) =>
                      setTimeout(() => printInvoice(r, business?.name ?? ""), i * 400),
                    );
                    setDownloadOpen(false);
                  }}
                >
                  Download {paidInvoices.length} invoices
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card">
          {history.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading payments…</p>
          ) : history.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              Payments could not be loaded.
            </p>
          ) : !history.data?.length ? (
            <div className="flex flex-col items-center gap-2.5 py-12">
              <HugeiconsIcon icon={ReceiptIcon} className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No payments yet</p>
              <p className="text-sm text-muted-foreground">Your paid invoices will appear here.</p>
            </div>
          ) : (
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="px-4 py-2.5 text-[11px]">Invoice</TableHead>
                  <TableHead className="px-4 py-2.5 text-[11px]">Billing date</TableHead>
                  <TableHead className="px-4 py-2.5 text-[11px]">Status</TableHead>
                  <TableHead className="px-4 py-2.5 text-[11px]">Amount</TableHead>
                  <TableHead className="px-4 py-2.5 text-[11px]">Plan</TableHead>
                  <TableHead className="px-4 py-2.5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.map((r) => (
                  <TableRow key={r.tx_ref}>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                          <HugeiconsIcon icon={File01Icon} className="size-4 text-accent" />
                        </div>
                        <div>
                          <div className="font-medium">
                            Invoice{" "}
                            {new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              year: "numeric",
                            })}{" "}
                            — {r.stores} store{r.stores > 1 ? "s" : ""}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {r.tx_ref}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">
                      {new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge
                        className={cn(
                          "rounded-full border-transparent capitalize",
                          r.status === "paid"
                            ? "bg-accent/15 text-accent"
                            : "bg-secondary text-muted-foreground",
                        )}
                      >
                        {r.status === "paid" ? "✓ Paid" : r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 font-medium tabular">
                      {fmt(r.currency as "MWK" | "USD", Number(r.amount))}
                    </TableCell>
                    <TableCell className="px-4 py-3 capitalize text-muted-foreground">
                      {r.period} plan
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {r.status === "paid" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-accent hover:text-accent"
                          aria-label={`Download invoice ${r.tx_ref}`}
                          onClick={() => printInvoice(r, business?.name ?? "")}
                        >
                          Download
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not paid</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{until ? "Renew or extend your plan" : "Choose a plan"}</DialogTitle>
            <DialogDescription>
              {stores.length} store{stores.length === 1 ? "" : "s"} on{" "}
              {business?.name ?? "your account"}. Each store needs a paid slot.
            </DialogDescription>
          </DialogHeader>
          {!canPay ? (
            <p className="text-sm text-muted-foreground">
              Ask an admin or manager to renew the subscription.
            </p>
          ) : (
            <>
              <div className="flex justify-end">
                <div className="flex gap-1 rounded-full bg-muted p-1">
                  {(["MWK", "USD"] as const).map((c) => (
                    <Button
                      key={c}
                      size="sm"
                      variant="ghost"
                      aria-pressed={currency === c}
                      onClick={() => setCurrency(c)}
                      className={cn(
                        "text-xs font-semibold",
                        currency === c ? "bg-secondary text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {c}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="billing-stores" className="text-sm font-medium">
                  Store slots to subscribe
                </label>
                <Input
                  id="billing-stores"
                  type="number"
                  min={minimumStores}
                  max={1000}
                  step={1}
                  value={n}
                  onChange={(e) =>
                    setRequestedStores(
                      Math.max(
                        minimumStores,
                        Math.min(1000, Math.trunc(Number(e.target.value) || minimumStores)),
                      ),
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Buy extra slots before adding stores.
                  {s?.paid && n > s.capacity
                    ? " Remaining prepaid time is credited across the larger store count; your expiry date is recalculated after payment."
                    : ""}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["monthly", "yearly"] as const).map((p) => {
                  const amt = p === "yearly" ? monthly * YEARLY_FACTOR : monthly;
                  return (
                    <Button
                      key={p}
                      variant="outline"
                      aria-pressed={period === p}
                      onClick={() => setPeriod(p)}
                      className={cn(
                        "billing-plan h-auto rounded-xl flex-col items-stretch justify-start gap-0 whitespace-normal p-4 text-left shadow-none",
                        period === p && "border-accent",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium capitalize">{p}</span>
                        {p === "yearly" && (
                          <span className="rounded bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent">
                            Save 15%
                          </span>
                        )}
                      </span>
                      <span className="mt-3 text-xl font-semibold tabular">
                        {fmt(currency, amt)}
                      </span>
                      <span className="mt-1 text-xs font-normal text-muted-foreground">
                        {p === "yearly" ? "Billed every year" : "Billed every month"}
                      </span>
                    </Button>
                  );
                })}
              </div>
              <div className="space-y-2 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <span>
                    {fmt(currency, PRICES[currency])} × {n} store{n > 1 ? "s" : ""} / month
                  </span>
                  <span>{fmt(currency, monthly)}</span>
                </div>
                {period === "yearly" && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>12 months, 15% off</span>
                    <span>−{fmt(currency, monthly * 12 - total)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-base font-bold">
                  <span>Total</span>
                  <span>{fmt(currency, total)}</span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="accent" className="w-full sm:w-auto" disabled={busy} onClick={pay}>
                  <HugeiconsIcon icon={CreditCardIcon} />
                  {busy ? "Opening…" : `Pay ${fmt(currency, total)}`}
                </Button>
              </DialogFooter>
              <p className="text-center text-xs text-muted-foreground">
                Airtel Money, TNM Mpamba or card via PayChangu.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment method</DialogTitle>
            <DialogDescription>
              Storq doesn't store card details. Each payment runs through PayChangu.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-3 rounded-lg border p-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={Wallet01Icon} className="size-4 text-muted-foreground" />
              </div>
              <div>
                <div className="font-medium">Airtel Money / TNM Mpamba</div>
                <div className="text-xs text-muted-foreground">
                  Pay from your mobile money wallet at checkout.
                </div>
              </div>
            </li>
            <li className="flex items-center gap-3 rounded-lg border p-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={CreditCardIcon} className="size-4 text-muted-foreground" />
              </div>
              <div>
                <div className="font-medium">Debit / credit card</div>
                <div className="text-xs text-muted-foreground">
                  Visa and Mastercard via the PayChangu secure popup.
                </div>
              </div>
            </li>
          </ul>
          {lastPaid && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Last paid{" "}
              {new Date(lastPaid.paid_at ?? lastPaid.created_at).toLocaleDateString(undefined, {
                dateStyle: "long",
              })}{" "}
              with {fmt(lastPaid.currency as "MWK" | "USD", Number(lastPaid.amount))}.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setPayOpen(false);
                setPlanOpen(true);
              }}
            >
              <HugeiconsIcon icon={Settings01Icon} /> Pay & set up plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Inv = {
  tx_ref: string;
  period: string;
  currency: string;
  amount: number;
  stores: number;
  status: string;
  created_at: string;
  paid_at: string | null;
};

function printInvoice(r: Inv, biz: string) {
  const c = r.currency as "MWK" | "USD";
  const d = new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, {
    dateStyle: "long",
  });
  const esc = (t: string) =>
    t.replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch,
    );
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Allow pop-ups to download the invoice.");
    return;
  }
  w.document
    .write(`<!doctype html><html><head><title>Invoice ${esc(r.tx_ref)}</title><style>body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111;padding:0 24px}h1{margin:0;font-size:28px}.m{color:#666;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:32px}td,th{padding:12px 0;border-bottom:1px solid #eee;text-align:left}.r{text-align:right}.t{font-weight:700;font-size:18px}.paid{display:inline-block;background:#e7f6ec;color:#147a3d;padding:4px 10px;border-radius:99px;font-weight:600;font-size:12px}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:start"><div><h1>Storq</h1><div class="m">Subscription invoice</div></div><span class="paid">PAID</span></div>
<div style="display:flex;justify-content:space-between;margin-top:32px"><div><div class="m">Billed to</div><b>${esc(biz)}</b></div><div class="r"><div class="m">Invoice</div><b>${esc(r.tx_ref)}</b><div class="m">${d}</div></div></div>
<table><tr><th>Description</th><th class="r">Amount</th></tr><tr><td>Storq ${esc(r.period)} plan · ${r.stores} store${r.stores > 1 ? "s" : ""}</td><td class="r">${fmt(c, Number(r.amount))}</td></tr><tr><td class="t">Total paid</td><td class="r t">${fmt(c, Number(r.amount))}</td></tr></table>
<p class="m" style="margin-top:32px">Paid via PayChangu. Thank you for using Storq.</p><script>onload=()=>print()</script></body></html>`);
  w.document.close();
}
