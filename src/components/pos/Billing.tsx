/**
 * Billing page — subscription management for Storq.
 *
 * Three flows, each with its own dialog:
 *
 * 1. RENEW / EXTEND  — user already has an active paid sub. They pick:
 *    - How many months to add (1, 2, 3, 6, 12, or any stepper value 1-24)
 *    - Currency
 *    The store count is locked — extending time, not changing capacity.
 *    12-month discount (15%) is applied automatically.
 *
 * 2. ADD STORES — user has an active paid sub and wants more locations. They pick:
 *    - How many NEW stores to add (delta, not total)
 *    - How many months for the new capacity
 *    Currency is shared. Proration is explained plainly.
 *
 * 3. NEW SUBSCRIPTION — trial or expired. They pick:
 *    - How many stores to cover
 *    - How many months
 *    Currency is shared.
 *
 * Backend constraint: `start_store_subscription_payment` accepts p_months (1-24).
 * 15% discount applies at 12+ months.
 */

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
import { SITE_URL } from "@/lib/seo";
import { downloadPdf } from "@/lib/pdf";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  CreditCardIcon,
  Download01Icon,
  File01Icon,
  PlusSignIcon,
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

type PlanMode = "renew" | "add-stores" | "new";
type Currency = "MWK" | "USD";

// ── Quick-pick months (shown as tap targets; stepper allows any value 1-24) ──
const MONTH_PRESETS = [1, 3, 6, 12] as const;

/** Unit price for a given month count: flat rate × possible 12-month discount. */
function calcTotal(currency: Currency, stores: number, months: number): number {
  const monthly = PRICES[currency] * stores;
  const discount = months >= 12 ? YEARLY_FACTOR / 12 : 1; // YEARLY_FACTOR = 12 × 0.85
  return Math.round(monthly * months * discount * 100) / 100;
}

/** What date will the subscription expire after this payment clears? */
function projectedExpiry(until: Date | null, months: number): Date {
  const base = until && until > new Date() ? new Date(until) : new Date();
  base.setMonth(base.getMonth() + months);
  return base;
}

// ── Shared sub-components ───────────────────────────────────────────────────

function CurrencyToggle({
  value,
  onChange,
  label,
}: {
  value: Currency;
  onChange: (v: Currency) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <SegmentedControl
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: "MWK", label: "MWK" },
          { value: "USD", label: "USD" },
        ]}
      />
    </div>
  );
}

/**
 * Month picker: quick-select buttons (1, 3, 6, 12) plus a +/- stepper for any value.
 * Shows the 15% discount badge on 12+.
 */
function MonthPicker({
  value,
  onChange,
  label,
  discountBadge,
  unitSingular,
  unitPlural,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  discountBadge: string;
  unitSingular: string;
  unitPlural: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>

      {/* Quick-pick row */}
      <div className="grid grid-cols-4 gap-1.5">
        {MONTH_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "relative rounded-xl border py-2.5 text-center text-sm font-medium transition-colors",
              value === m
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-muted",
            )}
          >
            {m}
            {m >= 12 && (
              <span className="absolute -right-1 -top-2 rounded-full bg-success px-1 py-0.5 text-[9px] font-bold text-success-foreground leading-none">
                {discountBadge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Custom stepper for any value not in presets */}
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-2.5">
        <span className="text-xs text-muted-foreground">
          {value} {value === 1 ? unitSingular : unitPlural}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            disabled={value <= 1}
            onClick={() => onChange(Math.max(1, value - 1))}
            aria-label="One month less"
          >
            −
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            disabled={value >= 24}
            onClick={() => onChange(Math.min(24, value + 1))}
            aria-label="One month more"
          >
            +
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Stepper for a count (stores delta or total). Uses +/- buttons with big central number. */
function CountStepper({
  value,
  min,
  max,
  onChange,
  label,
  unitSingular,
  unitPlural,
  note,
  confirmLine,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  unitSingular: string;
  unitPlural: string;
  note?: React.ReactNode;
  confirmLine?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 rounded-full text-lg font-light"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label="Decrease"
        >
          −
        </Button>
        <div className="flex-1 text-center">
          <span
            className="font-display tabular text-5xl font-semibold leading-none"
            aria-live="polite"
            aria-atomic="true"
          >
            {value}
          </span>
          <p className="mt-1 text-xs text-muted-foreground">
            {value === 1 ? unitSingular : unitPlural}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 rounded-full text-lg font-light"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label="Increase"
        >
          +
        </Button>
      </div>
      {confirmLine && (
        <div className="border-t pt-2 text-sm text-muted-foreground">{confirmLine}</div>
      )}
      {note && <div className="border-t pt-2">{note}</div>}
    </div>
  );
}

/** Price breakdown + total. */
function PriceSummary({
  currency,
  stores,
  months,
  breakdownLabel,
  discountLabel,
  totalLabel,
}: {
  currency: Currency;
  stores: number;
  months: number;
  breakdownLabel: string;
  discountLabel: string;
  totalLabel: string;
}) {
  const monthly = PRICES[currency] * stores;
  const total = calcTotal(currency, stores, months);
  const hasDiscount = months >= 12;
  const gross = monthly * months;

  return (
    <div className="space-y-1.5 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">{breakdownLabel}</span>
        <span className="tabular font-medium">{fmt(currency, gross)}</span>
      </div>
      {hasDiscount && (
        <div className="flex justify-between text-xs text-success">
          <span>{discountLabel}</span>
          <span>−{fmt(currency, gross - total)}</span>
        </div>
      )}
      <div className="flex justify-between border-t pt-1.5 font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular">{fmt(currency, total)}</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function Billing({ locked }: { locked?: boolean }) {
  const { business, stores, can, rpc, lock } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const sub = useSubscription(business?.id, stores.length);
  const getKey = useServerFn(getPaychanguKey);
  const verify = useServerFn(verifySubscriptionPayment);

  const [planMode, setPlanMode] = useState<PlanMode | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [currency, setCurrency] = useState<Currency>("MWK");
  const [busy, setBusy] = useState(false);
  const checked = useRef(false);

  // ── Per-mode state ────────────────────────────────────────────────────────
  const [renewMonths, setRenewMonths] = useState(1);

  const [addDelta, setAddDelta] = useState(1);
  const [addMonths, setAddMonths] = useState(1);

  const [newSlots, setNewSlots] = useState<number | null>(null);
  const [newMonths, setNewMonths] = useState(1);

  const s = sub.data;
  const paidCapacity = s?.paid ? s.capacity : 0;
  const until = s?.sub?.paid_until && s.paid ? new Date(s.sub.paid_until) : null;
  const trialEnd = s?.sub ? new Date(s.sub.trial_ends_at) : null;

  // Renew: store count fixed at current paid capacity
  const renewSlots = Math.max(paidCapacity, stores.length, 1);

  // Add stores: delta (min 1, max 1000-current)
  const addDeltaMax = Math.max(1, 1000 - paidCapacity);
  const safeAddDelta = Math.max(1, Math.min(addDeltaMax, addDelta));
  const addTotal = paidCapacity + safeAddDelta;

  // New subscription: total slots (min = existing stores count)
  const newSlotsMin = Math.max(stores.length, 1);
  const resolvedNewSlots = Math.max(newSlotsMin, Math.min(1000, newSlots ?? newSlotsMin));

  // The n and months sent to the RPC
  const n =
    planMode === "renew" ? renewSlots : planMode === "add-stores" ? addTotal : resolvedNewSlots;
  const months =
    planMode === "renew" ? renewMonths : planMode === "add-stores" ? addMonths : newMonths;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pay() {
    setBusy(true);
    try {
      const [{ key }, start, { data: u }] = await Promise.all([
        getKey(),
        rpc<{ tx_ref: string; amount: number }>("start_store_subscription_payment", {
          p_months: months,
          p_currency: currency,
          p_stores: n,
        }),
        supabase.auth.getUser(),
        loadPaychangu(),
      ]);
      if (!key) throw new Error(t("billing.payNotConfigured"));
      const url = `${SITE_URL || window.location.origin}/app/billing`;
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
          description: `${n} store${n > 1 ? "s" : ""} · ${months} month${months > 1 ? "s" : ""}`,
        },
        meta: { business: business?.id },
      });
      setPlanMode(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const history = useQuery({
    queryKey: ["subscription", "history", business?.id],
    enabled: !!business?.id,
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

  // Shared props for month pickers
  const monthPickerSharedProps = {
    discountBadge: t("billing.discountBadge"),
    unitSingular: t("billing.monthUnit"),
    unitPlural: t("billing.monthUnits"),
  };

  // Shared pay button
  const payBtn = (
    <Button disabled={busy} className="w-full sm:w-auto" onClick={pay}>
      <HugeiconsIcon icon={CreditCardIcon} />
      {busy
        ? t("billing.opening")
        : t("billing.payAmount", { amount: fmt(currency, calcTotal(currency, n, months)) })}
    </Button>
  );

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
        {/* ── Current plan card ──────────────────────────────────────────── */}
        <Card className="flex flex-col justify-between p-5">
          <div className="space-y-5">
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
              <div className="shrink-0 text-right">
                <div className="font-display tabular text-3xl font-medium">
                  {fmt(currency, PRICES[currency])}
                </div>
                <div className="text-xs text-muted-foreground">{t("billing.perStoreMonth")}</div>
              </div>
            </div>

            {s?.capacity ? (
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-medium">
                  <span>
                    {t("billing.storesUsed", { used: stores.length, capacity: s.capacity })}
                  </span>
                  <span className="tabular text-muted-foreground">
                    {fmt(currency, PRICES[currency])} × {stores.length}
                    {t("billing.perMo")}
                  </span>
                </div>
                <Progress
                  value={usagePct}
                  className={cn(
                    "h-1.5 bg-muted [&>div]:bg-primary",
                    s.overLimit && "[&>div]:bg-destructive",
                  )}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            {locked ? (
              <Button variant="outline" size="sm" onClick={lock}>
                {t("billing.switchStaff")}
              </Button>
            ) : (
              <span />
            )}

            {canPay && (
              <div className="flex flex-wrap items-center gap-2">
                {s?.paid ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAddDelta(1);
                        setAddMonths(1);
                        setPlanMode("add-stores");
                      }}
                    >
                      <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                      {t("billing.addStores")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary hover:text-primary"
                      onClick={() => {
                        setRenewMonths(1);
                        setPlanMode("renew");
                      }}
                    >
                      {t("billing.renewOrExtend")}
                      <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setNewSlots(newSlotsMin);
                      setNewMonths(1);
                      setPlanMode("new");
                    }}
                  >
                    {t("billing.upgradePlan")}
                    <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── Payment method card ───────────────────────────────────────── */}
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
                    ? `${new Date(lastPaid.paid_at ?? lastPaid.created_at).toLocaleDateString(
                        undefined,
                        { dateStyle: "long" },
                      )} · ${fmt(lastPaid.currency as Currency, Number(lastPaid.amount))}`
                    : t("billing.payProviders")}
                </div>
              </div>
              {canPay && (
                <Button variant="ghost" size="sm" onClick={() => setPayOpen(true)}>
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

      {/* ── Invoices ─────────────────────────────────────────────────────── */}
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
                      <span className="shrink-0 tabular font-medium">
                        {fmt(r.currency as Currency, Number(r.amount))}
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
              // Period column may be 'monthly', 'yearly', or an integer string
              const monthCount = r.period === "monthly" ? 1 : r.period === "yearly" ? 12 : Number(r.period);
              const periodDisplay = !isNaN(monthCount)
                ? `${monthCount} month${monthCount !== 1 ? "s" : ""}`
                : r.period;
              return (
                <div key={r.tx_ref} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {t("billing.storesCount", { count: r.stores })}
                        <span className="font-normal text-muted-foreground">
                          {" · "}
                          {periodDisplay} {t("billing.planWord")}
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
                    {fmt(r.currency as Currency, Number(r.amount))}
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

      {/* ══ RENEW / EXTEND ═════════════════════════════════════════════════
          Fixed store count. User picks how many months they want:
          quick-tap 1 / 3 / 6 / 12, or stepper for anything in between.
          12-month discount (15%) applied automatically.
      ═════════════════════════════════════════════════════════════════════= */}
      <Dialog open={planMode === "renew"} onOpenChange={(o) => !o && setPlanMode(null)}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("billing.renewExtendTitle")}</DialogTitle>
            <DialogDescription>
              {t("billing.renewExtendDesc", {
                capacity: renewSlots,
                date: until?.toLocaleDateString(undefined, { dateStyle: "long" }) ?? "—",
              })}
            </DialogDescription>
          </DialogHeader>

          {!canPay ? (
            <p className="text-sm text-muted-foreground">{t("billing.askAdminRenew")}</p>
          ) : (
            <>
              <CurrencyToggle
                value={currency}
                onChange={setCurrency}
                label={t("billing.currencyWord")}
              />

              {/* Stores — locked, display only */}
              <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
                <div>
                  <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("billing.slotsLabel")}
                  </p>
                  <p className="text-sm font-medium">
                    {renewSlots}{" "}
                    {renewSlots === 1 ? t("billing.storeUnit") : t("billing.storeUnits")}
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                  {t("billing.renewOrExtend")}
                </span>
              </div>

              {/* Month picker — THE main choice */}
              <MonthPicker
                value={renewMonths}
                onChange={setRenewMonths}
                label={t("billing.monthsLabel")}
                {...monthPickerSharedProps}
              />

              {/* "Your subscription will be active until ~X" */}
              <p className="text-xs text-muted-foreground">
                {t("billing.expiresAfterPay", {
                  date: projectedExpiry(until, renewMonths).toLocaleDateString(undefined, {
                    dateStyle: "long",
                  }),
                })}
              </p>

              <PriceSummary
                currency={currency}
                stores={renewSlots}
                months={renewMonths}
                breakdownLabel={t("billing.priceBreakdown", {
                  price: fmt(currency, PRICES[currency]),
                  count: renewSlots,
                  months: renewMonths,
                })}
                discountLabel={t("billing.yearDiscountLine")}
                totalLabel={t("common.total")}
              />

              <DialogFooter>{payBtn}</DialogFooter>
              <p className="text-center text-xs text-muted-foreground">
                {t("billing.payProviders")}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ══ ADD STORES ═════════════════════════════════════════════════════
          Delta-first: the big number = how many NEW stores.
          Then the user picks how many months for the expanded capacity.
      ═════════════════════════════════════════════════════════════════════= */}
      <Dialog open={planMode === "add-stores"} onOpenChange={(o) => !o && setPlanMode(null)}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("billing.addStoresTitle")}</DialogTitle>
            <DialogDescription>
              {t("billing.addStoresIntro", {
                capacity: paidCapacity,
                delta: safeAddDelta,
                total: addTotal,
              })}
            </DialogDescription>
          </DialogHeader>

          {!canPay ? (
            <p className="text-sm text-muted-foreground">{t("billing.askAdminRenew")}</p>
          ) : (
            <>
              <CurrencyToggle
                value={currency}
                onChange={setCurrency}
                label={t("billing.currencyWord")}
              />

              <CountStepper
                value={safeAddDelta}
                min={1}
                max={addDeltaMax}
                onChange={setAddDelta}
                label={t("billing.addStoresDeltaLabel")}
                unitSingular={t("billing.newStore")}
                unitPlural={t("billing.newStores")}
                confirmLine={
                  <span>
                    {t("billing.addStoresTotalLine", { total: addTotal })}{" "}
                    <span className="text-xs">({paidCapacity} + {safeAddDelta})</span>
                  </span>
                }
              />

              <MonthPicker
                value={addMonths}
                onChange={setAddMonths}
                label={t("billing.monthsLabel")}
                {...monthPickerSharedProps}
              />

              <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                {t("billing.addStoresProrateNote")}
              </p>

              <PriceSummary
                currency={currency}
                stores={addTotal}
                months={addMonths}
                breakdownLabel={t("billing.priceBreakdown", {
                  price: fmt(currency, PRICES[currency]),
                  count: addTotal,
                  months: addMonths,
                })}
                discountLabel={t("billing.yearDiscountLine")}
                totalLabel={t("common.total")}
              />

              <DialogFooter>{payBtn}</DialogFooter>
              <p className="text-center text-xs text-muted-foreground">
                {t("billing.payProviders")}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ══ NEW SUBSCRIPTION ═══════════════════════════════════════════════
          Pick stores then months. Clear, two-step mental model.
      ═════════════════════════════════════════════════════════════════════= */}
      <Dialog open={planMode === "new"} onOpenChange={(o) => !o && setPlanMode(null)}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("billing.choosePlanTitle")}</DialogTitle>
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
              <CurrencyToggle
                value={currency}
                onChange={setCurrency}
                label={t("billing.currencyWord")}
              />

              <CountStepper
                value={resolvedNewSlots}
                min={newSlotsMin}
                max={1000}
                onChange={setNewSlots}
                label={t("billing.slotsLabel")}
                unitSingular={t("billing.storeUnit")}
                unitPlural={t("billing.storeUnits")}
                note={
                  resolvedNewSlots < stores.length ? (
                    <p className="text-xs text-amber-600" role="alert">
                      {t("billing.minSlotsWarning", { count: stores.length })}
                    </p>
                  ) : undefined
                }
              />

              <MonthPicker
                value={newMonths}
                onChange={setNewMonths}
                label={t("billing.monthsLabel")}
                {...monthPickerSharedProps}
              />

              <PriceSummary
                currency={currency}
                stores={resolvedNewSlots}
                months={newMonths}
                breakdownLabel={t("billing.priceBreakdown", {
                  price: fmt(currency, PRICES[currency]),
                  count: resolvedNewSlots,
                  months: newMonths,
                })}
                discountLabel={t("billing.yearDiscountLine")}
                totalLabel={t("common.total")}
              />

              <DialogFooter>{payBtn}</DialogFooter>
              <p className="text-center text-xs text-muted-foreground">
                {t("billing.payProviders")}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ══ PAYMENT METHOD INFO ════════════════════════════════════════════ */}
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
                amount: fmt(lastPaid.currency as Currency, Number(lastPaid.amount)),
              })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              {t("common.close")}
            </Button>
            {canPay && (
              <Button
                onClick={() => {
                  setPayOpen(false);
                  if (s?.paid) {
                    setRenewMonths(1);
                    setPlanMode("renew");
                  } else {
                    setNewSlots(newSlotsMin);
                    setNewMonths(1);
                    setPlanMode("new");
                  }
                }}
              >
                <HugeiconsIcon icon={Settings01Icon} /> {t("billing.paySetupPlan")}
              </Button>
            )}
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
  const c = r.currency as Currency;
  const d = new Date(r.paid_at ?? r.created_at).toLocaleDateString("en-ZA", { dateStyle: "long" });
  const amt = fmt(c, Number(r.amount));
  const monthCount =
    r.period === "monthly" ? 1 : r.period === "yearly" ? 12 : Number(r.period);
  const periodDisplay = !isNaN(monthCount)
    ? `${monthCount} month${monthCount !== 1 ? "s" : ""}`
    : r.period;
  void downloadPdf({
    filename: `storq-invoice-${r.tx_ref}`,
    title: tInv("billing.invTitle"),
    business: "Storq",
    subtitle: tInv("billing.invSubtitle", { ref: r.tx_ref }),
    badge: r.status === "paid" ? tInv("billing.badgePaid") : r.status.toUpperCase(),
    meta: [
      [tInv("billing.billedTo"), biz || "—"],
      [tInv("billing.invoiceDate"), d],
      [tInv("billing.invPlan"), `${r.stores} store${r.stores !== 1 ? "s" : ""} · ${periodDisplay}`],
      [tInv("billing.currencyWord"), c],
    ],
    sections: [
      {
        type: "table",
        head: [tInv("billing.thDescription"), tInv("billing.thStores"), tInv("billing.thAmount")],
        align: ["left", "right", "right"],
        body: [
          [
            tInv("billing.invLineDesc", { period: periodDisplay }) +
              (monthCount >= 12 ? tInv("billing.yearlyDiscountSuffix") : ""),
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
