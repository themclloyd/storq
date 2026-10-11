import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { useI18n, t as tInv } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { PRICES, YEARLY_FACTOR, loadPaychangu, useSubscription } from "@/lib/billing";
import { getPaychanguKey, verifySubscriptionPayment } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PageHeader } from "@/components/pos/bits";
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
import { downloadPdf } from "@/lib/pdf";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  CreditCardIcon,
  Download01Icon,
  File01Icon,
  Settings01Icon,
  Wallet01Icon,
} from "@/lib/icons";

declare global {
  interface Window {
    PaychanguCheckout?: (o: Record<string, unknown>) => void;
  }
}

const fmt = (c: "MWK" | "USD", n: number) =>
  c === "MWK"
    ? `MK${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const PERIOD_KEY: Record<string, string> = {
  monthly: "billing.periodMonthly",
  yearly: "billing.periodYearly",
};

export function Billing({ locked }: { locked?: boolean }) {
  const { business, stores, can, rpc, lock } = usePos();
  const { t } = useI18n();
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
      toast.success(t("billing.paymentReceived"));
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
    // Runs once on mount to redeem a returning ?tx_ref; guarded by checked ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (!key) throw new Error(t("billing.payNotConfigured"));
      const url = `${window.location.origin}/app/billing`;
      if (!document.getElementById("wrapper")) {
        const w = document.createElement("div");
        w.id = "wrapper";
        document.body.appendChild(w);
      }
      if (!window.PaychanguCheckout) throw new Error(t("billing.paychanguFailed"));
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
    // Append-only payment log; the ["subscription"] prefix is invalidated when
    // a payment lands, so this can stay cached rather than re-pull on remount.
    staleTime: 300_000,
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
    ? { label: t("billing.statusOverLimit"), cls: "bg-destructive-soft text-destructive" }
    : until
      ? { label: t("billing.statusActive"), cls: "bg-success-soft text-success" }
      : s?.trial
        ? { label: t("store.freeTrial"), cls: "bg-secondary text-secondary-foreground" }
        : { label: t("billing.statusExpired"), cls: "bg-destructive-soft text-destructive" };
  const canPay = can("admin", "manager");
  const lastPaid = history.data?.find((r) => r.status === "paid") ?? null;
  const paidInvoices = (history.data ?? []).filter((r) => r.status === "paid");
  const usagePct = s?.capacity ? Math.min(100, Math.round((stores.length / s.capacity) * 100)) : 0;

  return (
    <div className={cn("mx-auto w-full max-w-6xl space-y-8", locked && "py-6")}>
      <PageHeader
        breadcrumb={locked ? undefined : `${t("nav.settings")} / ${t("nav.subscription")}`}
        title={
          locked
            ? s?.overLimit
              ? t("billing.overLimitTitle")
              : t("billing.needsAttentionTitle")
            : t("billing.title")
        }
        sub={t("billing.sub")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Card className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {sub.isPending
                      ? t("common.loading")
                      : until
                        ? t("billing.planOf", { plan: s?.sub?.plan ?? "Storq" })
                        : s?.trial
                          ? t("store.freeTrial")
                          : t("billing.noActivePlan")}
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
                    ? t("billing.renewsExpires", {
                        date: until.toLocaleDateString(undefined, { dateStyle: "long" }),
                      })
                    : s?.trial && trialEnd
                      ? t("billing.trialEnds", { date: trialEnd.toLocaleDateString() })
                      : t("billing.subscribeToKeep")}
                </p>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-medium tabular">
                  {fmt(currency, PRICES[currency])}
                </div>
                <div className="text-xs text-muted-foreground">{t("billing.perStoreMonth")}</div>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span>
                  {t("billing.storesUsed", { used: stores.length, capacity: s?.capacity ?? 0 })}
                </span>
                <span className="text-muted-foreground">
                  {fmt(currency, PRICES[currency])} × {stores.length} ={" "}
                  {fmt(currency, PRICES[currency] * stores.length)}
                  {t("billing.perMo")}
                </span>
              </div>
              <Progress
                value={usagePct}
                className={cn(
                  "mt-2 h-1.5 bg-muted [&>div]:bg-primary",
                  s?.overLimit && "[&>div]:bg-destructive",
                )}
              />
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between border-t pt-4">
            {locked ? (
              <Button variant="outline" size="sm" onClick={lock}>
                {t("billing.switchStaff")}
              </Button>
            ) : (
              <span />
            )}
            {canPay && (
              <Button
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary"
                onClick={() => setPlanOpen(true)}
              >
                {until ? t("billing.renewOrExtend") : t("billing.upgradePlan")}{" "}
                <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
              </Button>
            )}
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <HugeiconsIcon icon={Wallet01Icon} className="size-4 text-muted-foreground" />{" "}
              {t("billing.payMethodTitle")}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("billing.payMethodSub")}</p>
            <Card className="mt-4 flex items-center gap-3 p-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={CreditCardIcon} className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">
                  {lastPaid
                    ? lastPaid.currency === "USD"
                      ? t("billing.lastCard")
                      : t("billing.lastMobile")
                    : t("billing.noPaymentYet")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {lastPaid
                    ? `${new Date(lastPaid.paid_at ?? lastPaid.created_at).toLocaleDateString(undefined, { dateStyle: "long" })} · ${fmt(lastPaid.currency as "MWK" | "USD", Number(lastPaid.amount))}`
                    : t("billing.payProviders")}
                </div>
              </div>
              {canPay && (
                <Button variant="outline" size="sm" onClick={() => setPayOpen(true)}>
                  {t("billing.update")}
                </Button>
              )}
            </Card>
          </div>
          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
            {t("billing.processedBy")}
          </p>
        </Card>
      </div>

      <section>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-medium">{t("billing.sectionTitle")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("billing.sectionSub")}</p>
          </div>
          <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <HugeiconsIcon icon={Download01Icon} /> {t("billing.downloadAll")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("billing.downloadAllTitle")}</DialogTitle>
                <DialogDescription>
                  {t("billing.downloadAllDesc", { count: paidInvoices.length })}
                </DialogDescription>
              </DialogHeader>
              {paidInvoices.length ? (
                <Card className="max-h-64 divide-y overflow-y-auto text-sm">
                  {paidInvoices.map((r) => (
                    <div
                      key={r.tx_ref}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <HugeiconsIcon
                          icon={File01Icon}
                          className="size-4 shrink-0 text-muted-foreground"
                        />{" "}
                        {t("billing.invoiceWord")}{" "}
                        {new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span className="shrink-0 font-medium tabular">
                        {fmt(r.currency as "MWK" | "USD", Number(r.amount))}
                      </span>
                    </div>
                  ))}
                </Card>
              ) : (
                <p className="py-4 text-sm text-muted-foreground">{t("billing.noPaidInvoices")}</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDownloadOpen(false)}>
                  {t("common.cancel")}
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
                  {t("billing.downloadInvoicesBtn", { count: paidInvoices.length })}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="divide-y overflow-hidden">
          {history.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("billing.loadingInvoices")}
            </p>
          ) : history.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {t("billing.invoicesError")}
            </p>
          ) : !history.data?.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("billing.noInvoicesYet")}
            </p>
          ) : (
            history.data.map((r) => {
              const paid = r.status === "paid";
              const when = new Date(r.paid_at ?? r.created_at);
              return (
                <div key={r.tx_ref} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {t("billing.storesCount", { count: r.stores })}
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {t(PERIOD_KEY[r.period] ?? "billing.periodMonthly")}{" "}
                          {t("billing.planWord")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                          paid
                            ? "bg-success-soft text-success"
                            : "bg-secondary text-muted-foreground",
                        )}
                      >
                        {paid ? t("status.completed") : r.status}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {when.toLocaleDateString(undefined, { dateStyle: "medium" })} · {r.tx_ref}
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-sm font-medium">
                    {fmt(r.currency as "MWK" | "USD", Number(r.amount))}
                  </div>
                  {paid ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-primary"
                      aria-label={t("billing.downloadInvoiceAria", { ref: r.tx_ref })}
                      onClick={() => printInvoice(r, business?.name ?? "")}
                    >
                      <HugeiconsIcon icon={Download01Icon} />
                    </Button>
                  ) : (
                    <div className="size-9 shrink-0" aria-hidden />
                  )}
                </div>
              );
            })
          )}
        </Card>
      </section>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              {until ? t("billing.renewExtendTitle") : t("billing.choosePlanTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("billing.choosePlanDesc", {
                count: stores.length,
                name: business?.name ?? t("billing.yourAccount"),
              })}
            </DialogDescription>
          </DialogHeader>
          {!canPay ? (
            <p className="text-sm text-muted-foreground">{t("billing.askAdminRenew")}</p>
          ) : (
            <>
              <div className="flex justify-end">
                <SegmentedControl
                  size="sm"
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    { value: "MWK", label: "MWK" },
                    { value: "USD", label: "USD" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing-stores" className="text-sm font-medium">
                  {t("billing.storeSlotsLabel")}
                </Label>
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
                  {t("billing.buyExtraSlots")}
                  {s?.paid && n > s.capacity ? t("billing.prepaidCreditNote") : ""}
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
                        "billing-plan h-auto rounded-xl flex-col items-stretch justify-start gap-0 whitespace-normal p-4 text-left",
                        period === p && "border-primary bg-secondary/40",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {t(PERIOD_KEY[p] ?? "billing.periodMonthly")}
                        </span>
                        {p === "yearly" && (
                          <span className="rounded bg-success-soft px-2 py-1 text-[10px] font-semibold text-success">
                            {t("billing.save15")}
                          </span>
                        )}
                      </span>
                      <span className="mt-3 text-xl font-semibold tabular">
                        {fmt(currency, amt)}
                      </span>
                      <span className="mt-1 text-xs font-normal text-muted-foreground">
                        {p === "yearly" ? t("billing.billedYearly") : t("billing.billedMonthly")}
                      </span>
                    </Button>
                  );
                })}
              </div>
              <div className="space-y-2 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <span>
                    {t("billing.multiplyPerMonth", {
                      price: fmt(currency, PRICES[currency]),
                      count: n,
                    })}
                  </span>
                  <span>{fmt(currency, monthly)}</span>
                </div>
                {period === "yearly" && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("billing.yearDiscountLine")}</span>
                    <span>−{fmt(currency, monthly * 12 - total)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <span>{t("common.total")}</span>
                  <span>{fmt(currency, total)}</span>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="default"
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={pay}
                >
                  <HugeiconsIcon icon={CreditCardIcon} />
                  {busy
                    ? t("billing.opening")
                    : t("billing.payAmount", { amount: fmt(currency, total) })}
                </Button>
              </DialogFooter>
              <p className="text-center text-xs text-muted-foreground">
                {t("billing.payProviders")}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("billing.payMethodTitle")}</DialogTitle>
            <DialogDescription>{t("billing.noCardStored")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <Card className="flex items-center gap-3 p-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={Wallet01Icon} className="size-4 text-muted-foreground" />
              </div>
              <div>
                <div className="font-medium">{t("billing.mobileMoneyTitle")}</div>
                <div className="text-xs text-muted-foreground">{t("billing.mobileMoneyDesc")}</div>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={CreditCardIcon} className="size-4 text-muted-foreground" />
              </div>
              <div>
                <div className="font-medium">{t("billing.cardTitle")}</div>
                <div className="text-xs text-muted-foreground">{t("billing.cardDesc")}</div>
              </div>
            </Card>
          </div>
          {lastPaid && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t("billing.lastPaidLine", {
                date: new Date(lastPaid.paid_at ?? lastPaid.created_at).toLocaleDateString(
                  undefined,
                  { dateStyle: "long" },
                ),
                amount: fmt(lastPaid.currency as "MWK" | "USD", Number(lastPaid.amount)),
              })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              {t("common.close")}
            </Button>
            <Button
              onClick={() => {
                setPayOpen(false);
                setPlanOpen(true);
              }}
            >
              <HugeiconsIcon icon={Settings01Icon} /> {t("billing.paySetupPlan")}
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
  const d = new Date(r.paid_at ?? r.created_at).toLocaleDateString("en-ZA", { dateStyle: "long" });
  const amt = fmt(c, Number(r.amount));
  const period = tInv(PERIOD_KEY[r.period] ?? "billing.periodMonthly");
  void downloadPdf({
    filename: `storq-invoice-${r.tx_ref}`,
    title: tInv("billing.invTitle"),
    business: "Storq",
    subtitle: tInv("billing.invSubtitle", { ref: r.tx_ref }),
    badge: r.status === "paid" ? tInv("billing.badgePaid") : r.status.toUpperCase(),
    meta: [
      [tInv("billing.billedTo"), biz || "—"],
      [tInv("billing.invoiceDate"), d],
      [tInv("billing.invPlan"), tInv("billing.invPlanLine", { period, count: r.stores })],
      [tInv("billing.currencyWord"), c],
    ],
    sections: [
      {
        type: "table",
        head: [tInv("billing.thDescription"), tInv("billing.thStores"), tInv("billing.thAmount")],
        align: ["left", "right", "right"],
        body: [
          [
            tInv("billing.invLineDesc", { period }) +
              (r.period === "yearly" ? tInv("billing.yearlyDiscountSuffix") : ""),
            r.stores,
            amt,
          ],
        ],
      },
    ],
    totals: [
      [tInv("doc.subtotal"), amt],
      [tInv("billing.totalPaid"), amt],
    ],
    footerNote: tInv("billing.invFooter"),
  }).catch(() => toast.error(tInv("billing.invoicePdfError")));
}
