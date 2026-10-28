/**
 * Billing page, subscription management for Storq.
 *
 * The page is deliberately small: one card says what plan the business is on, when
 * it runs out, how many locations it covers and what another one costs, followed by
 * the receipts. Each purchase starts from that card's own buttons, which open
 * `planMode` in the mode the button means, the dialog never asks "what do you want
 * to do?" on top of "how many?":
 *
 * 1. RENEW / EXTEND, a running paid term. They pick:
 *    - How many locations the new term covers. It defaults to the slots already
 *      paid for and can come down to the locations actually open, so capacity
 *      bought for a branch that has since gone stops being charged.
 *    - How many months to add (1, 3, 6, 12, or any stepper value 1-24)
 *    15% off at 12+ months.
 *
 * 2. ADD STORES, a running paid term that needs more locations. They pick the
 *    number to add; the months are NOT a choice. New slots join the term already
 *    paid for, so the price is "new slots × whole months left", and the expiry does
 *    not move. SQL derives the same months from `paid_until`, so the quote on this
 *    screen is the amount the provider is asked for.
 *
 * 3. NEW SUBSCRIPTION, trial or expired. They pick the slots to cover and the
 *    months.
 *
 * All three bill off the single `subscriptions.paid_until` per business, so every
 * location always shares one expiry date.
 *
 * `paymentQuote()` in `@/lib/billing` is the only place a price is worked out: the
 * summary, the button and the expiry line all read from it, and it mirrors
 * `start_store_subscription_payment` and `complete_subscription_payment` in SQL.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { useI18n, t as tInv } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  MONTH_PRESETS,
  PRICES,
  calcTotal,
  fmtMoney as fmt,
  loadPaychangu,
  paymentQuote,
  remainingTermMonths,
  useSubscription,
  type Currency,
} from "@/lib/billing";
import { getPaychanguKey, verifySubscriptionPayment } from "@/lib/billing.functions";
import { publicAppUrl } from "@/lib/desktop";
import { clearUrlQuery, urlParam } from "@/lib/url";
import { useOnce } from "@/hooks/use-once";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/pos/bits";
import { RowsSkeleton } from "@/components/pos/skeletons";
import { GraceBanner } from "@/components/pos/GraceBanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  PlusSignIcon,
  Wallet01Icon,
} from "@/lib/icons";

declare global {
  interface Window {
    PaychanguCheckout?: (o: Record<string, unknown>) => void;
  }
}

type PlanMode = "renew" | "add-stores" | "new";

// How long a checkout can plausibly stay open. Mirrors the thirty minutes SQL uses to
// reuse a pending intent, and, since 011, to abandon one. A reference older than this
// is a click the buyer walked away from, not a payment still on its way.
const ATTEMPT_TTL_MS = 30 * 60_000;
const PENDING_KEY = "paychangu_pending_tx_ref";

/** The stored attempt with the moment it was opened, if the browser still has one. */
function readStoredAttempt(): { ref: string; at: number } | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { ref?: unknown; at?: unknown };
    if (typeof v?.ref === "string" && v.ref) {
      return { ref: v.ref, at: typeof v.at === "number" ? v.at : 0 };
    }
    return null;
  } catch {
    // Written before the age was kept: it carries no timestamp, so it is treated as
    // spent rather than allowed to keep a cancelled click on screen indefinitely.
    return { ref: raw, at: 0 };
  }
}

/** The reference, only while the checkout that produced it could still be open. */
function freshStoredRef(): string | null {
  const stored = readStoredAttempt();
  if (!stored) return null;
  if (Date.now() - stored.at < ATTEMPT_TTL_MS) return stored.ref;
  localStorage.removeItem(PENDING_KEY);
  return null;
}

function writeStoredAttempt(ref: string) {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ ref, at: Date.now() }));
}

// ── Shared sub-components ───────────────────────────────────────────────────

/**
 * Month picker: quick-select buttons (1, 3, 6, 12) plus a +/- stepper for any value.
 * Each preset prints its own unit, so "12" never reads as a dozen of something else,
 * and 12+ months wears the discount badge.
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
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      {/* Quick-pick row */}
      <div className="grid grid-cols-4 gap-1.5">
        {MONTH_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "relative rounded-xl border px-1 py-2 transition-colors",
              value === m
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:border-primary/40 hover:bg-muted",
            )}
          >
            <span className="tabular block text-lg leading-none font-extrabold">{m}</span>
            <span className="mt-1 block text-[11px] leading-none opacity-70">
              {m === 1 ? unitSingular : unitPlural}
            </span>
            {m >= 12 && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-success px-1.5 py-0.5 text-[9px] font-bold leading-none text-success-foreground">
                {discountBadge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Custom stepper for any value not in presets */}
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-1.5">
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
            aria-label={t("billing.decrease")}
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
            aria-label={t("billing.increase")}
          >
            +
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stepper for a count (slots bought or added). The label row carries the arithmetic,
 * "2 of 3 stores used", "New total: 4 slots", so the big number is never bare.
 */
function CountStepper({
  value,
  min,
  max,
  onChange,
  label,
  hint,
  unitSingular,
  unitPlural,
  note,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  hint?: React.ReactNode;
  unitSingular: string;
  unitPlural: string;
  note?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="shrink-0 text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </p>
        {hint ? <p className="min-w-0 truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-3 rounded-xl border bg-card px-2.5 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 rounded-lg text-lg font-light"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={t("billing.decrease")}
        >
          −
        </Button>
        <div className="flex flex-1 items-baseline justify-center gap-1.5">
          <span
            className="tabular text-3xl leading-none font-extrabold"
            aria-live="polite"
            aria-atomic="true"
          >
            {value}
          </span>
          <span className="text-xs text-muted-foreground">
            {value === 1 ? unitSingular : unitPlural}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 rounded-lg text-lg font-light"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={t("billing.increase")}
        >
          +
        </Button>
      </div>
      {note ? (
        <div className="space-y-1 text-xs leading-snug text-muted-foreground">{note}</div>
      ) : null}
    </div>
  );
}

/**
 * Price breakdown + total. `note` carries the one consequence the owner must know
 * before paying (the date the plan will run to), so it travels with the number.
 */
function PriceSummary({
  currency,
  stores,
  months,
  breakdownLabel,
  discountLabel,
  totalLabel,
  note,
}: {
  currency: Currency;
  stores: number;
  months: number;
  breakdownLabel: string;
  discountLabel: string;
  totalLabel: string;
  note?: React.ReactNode;
}) {
  const monthly = PRICES[currency] * stores;
  const total = calcTotal(currency, stores, months);
  const hasDiscount = months >= 12;
  const gross = monthly * months;

  return (
    <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{breakdownLabel}</span>
        <span className="tabular shrink-0 text-muted-foreground">{fmt(currency, gross)}</span>
      </div>
      {hasDiscount && (
        <div className="mt-1 flex justify-between gap-3 text-xs text-success">
          <span>{discountLabel}</span>
          <span className="tabular shrink-0">−{fmt(currency, gross - total)}</span>
        </div>
      )}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {totalLabel}
        </span>
        <span className="tabular shrink-0 text-xl leading-none font-extrabold">
          {fmt(currency, total)}
        </span>
      </div>
      {note ? <p className="mt-2 text-xs leading-snug text-muted-foreground">{note}</p> : null}
    </div>
  );
}

// ── Dialog chrome ───────────────────────────────────────────────────────────
// The three dialogs are one shape: a titled head that stays put, a body that
// scrolls when a phone is short, and a footer bar holding the single action.

/** Content preset for a sheet, head and footer pinned, body scrolls. */
const SHEET = "flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-[16px] p-0";

function SheetHead({ title, desc }: { title: string; desc: React.ReactNode }) {
  return (
    <DialogHeader className="space-y-1 border-b px-5 pb-4 pr-14 pt-5 text-left">
      <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
      <DialogDescription className="text-[13px] leading-snug">{desc}</DialogDescription>
    </DialogHeader>
  );
}

function SheetBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4", className)}>
      {children}
    </div>
  );
}

function SheetFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-t bg-muted/40 px-5 py-3", className)}>{children}</div>;
}

// ── Main component ──────────────────────────────────────────────────────────

export function Billing({ locked }: { locked?: boolean }) {
  const { business, stores, store, can, rpc, lock } = usePos();
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
  // A debit the provider took but our server never confirmed survives in localStorage.
  // That pending reference is what the "already debited?" recovery button re-verifies.
  const [pendingTx, setPendingTx] = useState<string | null>(null);
  const checked = useRef(false);
  // tx_ref of the checkout we opened in the PayChangu iframe this session,
  // used to authenticate postMessage results and ignore stale messages.
  const pendingRef = useRef<string | null>(null);

  // ── Per-mode state ────────────────────────────────────────────────────────
  const [renewMonths, setRenewMonths] = useState(1);
  // Null until the owner touches the stepper, so the default keeps following the
  // paid capacity as the subscription row arrives instead of freezing a stale 0.
  const [renewSlotsDraft, setRenewSlotsDraft] = useState<number | null>(null);

  const [addDelta, setAddDelta] = useState(1);

  const [newSlots, setNewSlots] = useState<number | null>(null);
  const [newMonths, setNewMonths] = useState(1);

  // Which receipts the table shows. A failed attempt is the one worth isolating, so
  // it can never hide between two paid rows.
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "open">("all");

  const s = sub.data;
  const paidCapacity = s?.paid ? s.capacity : 0;
  const liveStores = Math.max(stores.length, 1);
  // The date the term was paid to, whether or not it has already passed: a lapsed
  // account still needs to read "ended on <date>" instead of an em dash.
  const paidUntil = s?.sub?.paid_until ? new Date(s.sub.paid_until) : null;
  const trialEnd = s?.sub ? new Date(s.sub.trial_ends_at) : null;

  // Renew = (locations open) × (months). The ceiling is what is paid for today; the
  // floor is what is actually trading, so capacity bought for a branch that has
  // since closed can be released instead of renewed forever.
  const renewCeiling = Math.max(paidCapacity, liveStores);
  const renewSlots = Math.min(renewCeiling, Math.max(liveStores, renewSlotsDraft ?? renewCeiling));

  // Add stores: delta (min 1, max 1000-current)
  const addDeltaMax = Math.max(1, 1000 - paidCapacity);
  const safeAddDelta = Math.max(1, Math.min(addDeltaMax, addDelta));
  const addTotal = paidCapacity + safeAddDelta;

  // New subscription: total slots (min = existing stores count)
  const newSlotsMin = Math.max(stores.length, 1);
  const resolvedNewSlots = Math.max(newSlotsMin, Math.min(1000, newSlots ?? newSlotsMin));

  // The n sent to the RPC. A capacity purchase has no month choice at all: the term
  // is whatever is left on the one already paid for, and `paymentQuote` derives it.
  const n =
    planMode === "renew" ? renewSlots : planMode === "add-stores" ? addTotal : resolvedNewSlots;
  const monthChoice =
    planMode === "renew" ? renewMonths : planMode === "add-stores" ? 1 : newMonths;

  // What this payment charges for and the expiry it buys. SQL derives both the same
  // way, so the number shown can never differ from the amount actually taken.
  const quote = paymentQuote({
    currency,
    totalSlots: n,
    paidSlots: paidCapacity,
    paidUntil: s?.sub?.paid_until ?? null,
    months: monthChoice,
  });
  const billedSlots = quote.billedSlots;
  const months = quote.months;
  const isCapacityPurchase = quote.isCapacity;
  const payUntil = quote.expiry;
  // The term a newly bought slot joins, the same months the RPC derives and charges.
  const termMonthsLeft = remainingTermMonths(s?.sub?.paid_until ?? null);

  // A paid term can carry more slots than locations, and a capacity purchase is only
  // half a job: the slot exists, the location does not. Derived rather than
  // remembered, so the invitation survives a reload or a payment made on another till.
  const spareSlots = s?.paid ? Math.max(0, (s.capacity ?? 0) - stores.length) : 0;
  // The number that answers "what does the next one cost": one month at the slots a
  // running term keeps, or at the locations actually open when no term is running.
  const nextAmount = calcTotal(currency, s?.paid ? renewSlots : liveStores, 1);
  const graceDays = s?.inGrace
    ? s.graceDaysRemaining
    : s?.inTrialGrace
      ? s.trialGraceDaysRemaining
      : 0;

  async function check(ref: string, quiet = false): Promise<boolean> {
    try {
      const r = await verify({ data: { tx_ref: ref } });
      if (r.ok) {
        toast.success(t("billing.paymentReceived"));
        qc.invalidateQueries({ queryKey: ["subscription"] });
        return true;
      }
      // A reference the server can never complete (its payment row no longer
      // exists) is forgotten; transient failures stay put and retry next load.
      if (r.drop) {
        if (pendingRef.current === ref) pendingRef.current = null;
        localStorage.removeItem(PENDING_KEY);
        setPendingTx(null);
      }
      if (!quiet) toast.error(r.message);
      return false;
    } catch (e) {
      if (!quiet) toast.error((e as Error).message);
      return false;
    }
  }

  // The checkout overlay is dismissed once PayChangu reports success, but the
  // pending reference is only cleared after OUR server confirms the payment.
  // A transient failure (provider not yet consistent, missing service key) then
  // survives in localStorage and is retried on the next load, so a charge that
  // really happened is never silently dropped.
  async function finalizePayment(ref: string, quiet = false) {
    document.getElementById("iframe1")?.remove();
    document.querySelector(".page-loading")?.remove();
    if (await check(ref, quiet)) {
      if (pendingRef.current === ref) pendingRef.current = null;
      localStorage.removeItem(PENDING_KEY);
      setPendingTx(null);
    }
  }

  // References this account left pending, held server-side so a payment made on
  // another till (or one whose browser storage was wiped) can still be recovered.
  const pendingQ = useQuery({
    queryKey: ["pending-payment-refs", business?.id],
    enabled: !!business && can("money"),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => (await rpc<{ tx_ref: string }[] | null>("pending_payment_refs", {})) ?? [],
  });
  const pendingCount = pendingQ.data?.length ?? 0;

  // Recovery for a mobile-money charge the owner knows went through while the
  // screen still shows a locked plan: settle every pending reference this
  // business has, not only the one this browser remembers. One sweep covers the
  // tab that closed on the return redirect, the till that paid and crashed, and
  // the charge that landed after the shop was already locked out.
  const { run: sweep } = useOnce(async ({ silent }: { silent: boolean }) => {
    const refs = (pendingQ.data ?? []).map((row) => row.tx_ref);
    const localRef = freshStoredRef();
    if (localRef && !refs.includes(localRef)) refs.push(localRef);
    if (!refs.length) {
      if (!silent) toast.info(t("billing.nothingPending"));
      return;
    }
    // Quiet per reference: a reference the provider has not seen yet is normal,
    // and one toast per pending charge would bury the success.
    let paid = false;
    for (const ref of refs) if (await check(ref, true)) paid = true;
    if (!paid && !silent) toast.error(t("billing.pendingNotYet"));
    void pendingQ.refetch();
  }, 5_000);

  // Only a press flips anything on screen to "Verifying…". The background sweep stays
  // invisible on purpose: a button that greys out and re-labels itself every half
  // minute reads as the page reloading under the owner's hands, and a red "not seen
  // yet" each time reads as an error to act on when nothing is wrong. A payment that
  // does land still announces itself, that is the one message worth a toast.
  const [verifying, setVerifying] = useState(false);
  const verifyRecent = useCallback(
    async (silent = false) => {
      if (!silent) setVerifying(true);
      try {
        await sweep({ silent });
      } finally {
        if (!silent) setVerifying(false);
      }
    },
    [sweep],
  );

  // "We keep checking" used to be a promise nothing kept: the references were only
  // looked at once, on mount. Now the page re-reads the pending list and settles it
  // on its own, so a payment approved on a phone, or made on another till, shows up
  // without the owner having to press anything.
  const awaitingPayment = pendingCount > 0 || !!pendingTx;
  const refetchPending = pendingQ.refetch;
  useEffect(() => {
    if (!awaitingPayment) return;
    const id = setInterval(() => {
      // A backgrounded tab is not being read: checking there only spends the network
      // and makes the screen snap the moment the owner comes back to it.
      if (document.visibilityState !== "visible") return;
      void refetchPending().then(() => verifyRecent(true));
    }, 30_000);
    return () => clearInterval(id);
  }, [awaitingPayment, refetchPending, verifyRecent]);

  // "I didn't pay": the intent exists only because the provider needed a reference
  // before the checkout opened, so closing it here ends the banner, the polling and
  // the provider lookups at once. A charge that landed anyway still activates the
  // term it paid for, the row is closed, not deleted.
  const [cancelling, setCancelling] = useState(false);
  async function cancelAttempt() {
    setCancelling(true);
    try {
      const n = await rpc<number>("cancel_pending_payments", {});
      localStorage.removeItem(PENDING_KEY);
      pendingRef.current = null;
      setPendingTx(null);
      await pendingQ.refetch();
      void qc.invalidateQueries({ queryKey: ["subscription", "history", business?.id] });
      toast.success(n > 0 ? t("billing.attemptCancelled") : t("billing.nothingPending"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  // The PayChangu checkout loads inside an iframe (popup.js), so a successful
  // payment NEVER navigates our top-level window, the iframe's own callback
  // redirect lands inside the frame (and our CSP frame-ancestors 'none' blocks
  // it there). The only reliable completion signal is the
  // `paychangu:payment.success` postMessage the checkout sends to its parent.
  // The message is trusted only because it comes from the checkout origin AND
  // we have a locally-started tx_ref awaiting payment; the real confirmation
  // always happens server-side via verify-payment. (The message's own
  // `payment.reference` is PayChangu's internal ref_id, not our tx_ref.)
  function handlePaychanguMessage(e: MessageEvent) {
    if (!/^https:\/\/(?:test-)?checkout\.paychangu\.com$/.test(e.origin)) return;
    const msg = e.data as { type?: string } | null;
    if (msg?.type !== "paychangu:payment.success") return;
    const ref = pendingRef.current;
    if (!ref) return;
    void finalizePayment(ref);
  }

  // Keep the listener on the latest closure (translated toasts, fresh verify).
  const paychanguMsgHandler = useRef(handlePaychanguMessage);
  paychanguMsgHandler.current = handlePaychanguMessage;

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    // Check URL param first (PayChangu redirect), then fall back to the stored
    // reference, but only while the checkout it belongs to could still be open.
    // Re-checking an older one is exactly what kept a cancelled click on the screen.
    const urlRef = urlParam("tx_ref");
    const ref = urlRef || freshStoredRef();
    if (ref) {
      // Quiet on a failed re-check: this fires on every visit while a reference is
      // still pending, and the inline banner already says the money is being waited
      // on. Only a confirmation deserves to interrupt the page.
      void finalizePayment(ref, true);
      // Works for both targets: the website drops `?tx_ref` from the path, the
      // installed app from its hash route.
      clearUrlQuery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface a stored pending reference whenever a billing surface is looked at (read
  // inside an effect only, localStorage does not exist during the server render).
  useEffect(() => {
    setPendingTx(freshStoredRef());
  }, [planMode, payOpen]);

  // The locations page sends an owner here with ?intent=add-stores the moment
  // capacity runs out, so the purchase they were told to make is already open. Wait
  // for the subscription row: reading `paid` before it lands would swallow the intent.
  const intentRead = useRef(false);
  useEffect(() => {
    if (intentRead.current || !s) return;
    intentRead.current = true;
    if (urlParam("intent") !== "add-stores") return;
    // `paid`, not `canAddStore`: the owner is usually here *because* every slot is
    // taken, which is exactly when buying one is the right next move. A lapsed or
    // suspended account lands on the page instead, where paying time comes first.
    if (!s.paid) return;
    setAddDelta(1);
    setPlanMode("add-stores");
    // Drop the query, so a reload does not reopen the dialog over a finished job.
    clearUrlQuery();
  }, [s]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => paychanguMsgHandler.current(e);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function pay() {
    setBusy(true);
    try {
      const [{ key }, start, { data: u }] = await Promise.all([
        getKey(),
        rpc<{ tx_ref: string; amount: number; billed_stores: number }>(
          "start_store_subscription_payment",
          {
            p_months: months,
            p_currency: currency,
            p_stores: n,
          },
        ),
        supabase.auth.getUser(),
        loadPaychangu(),
      ]);
      if (!key) throw new Error(t("billing.payNotConfigured"));
      // The provider sends the buyer back to a web page, never to the app's own
      // `tauri.localhost` origin.
      const callbackUrl = publicAppUrl("/app/billing");
      if (!document.getElementById("wrapper")) {
        const w = document.createElement("div");
        w.id = "wrapper";
        document.body.appendChild(w);
      }
      if (!window.PaychanguCheckout) throw new Error(t("billing.paychanguFailed"));
      // Persist tx_ref so the verify logic can pick it up even if the
      // PayChangu redirect causes a full page reload (e.g. on localhost).
      pendingRef.current = start.tx_ref;
      writeStoredAttempt(start.tx_ref);
      setPendingTx(start.tx_ref);
      window.PaychanguCheckout({
        public_key: key,
        tx_ref: start.tx_ref,
        amount: start.amount,
        currency,
        callback_url: callbackUrl,
        return_url: callbackUrl,
        customer: {
          email: u.user?.email ?? "",
          first_name: business?.name ?? "Storq",
          last_name: "",
        },
        customization: {
          title: "Storq subscription",
          description: isCapacityPurchase
            ? `+${billedSlots} location${billedSlots > 1 ? "s" : ""} · ${months} month${months > 1 ? "s" : ""}`
            : `${n} location${n > 1 ? "s" : ""} · ${months} month${months > 1 ? "s" : ""}`,
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

  // One pill for one situation, resolved in the same order SQL resolves it: an
  // operator decision outranks the money clock, and a term inside its three-day grace
  // window is *not* "expired", the tills are still selling, so saying otherwise made
  // this screen contradict the counter.
  const status = !s
    ? { label: t("common.loading"), cls: "bg-secondary text-muted-foreground" }
    : s.closed
      ? { label: t("billing.statusClosed"), cls: "bg-destructive-soft text-destructive" }
      : s.suspended
        ? { label: t("billing.statusSuspended"), cls: "bg-warning-soft text-warning-foreground" }
        : s.overLimit
          ? { label: t("billing.statusOverLimit"), cls: "bg-destructive-soft text-destructive" }
          : s.paid
            ? { label: t("billing.statusActive"), cls: "bg-success-soft text-success" }
            : s.inGrace || s.inTrialGrace
              ? { label: t("billing.statusGrace"), cls: "bg-warning-soft text-warning-foreground" }
              : s.trial
                ? { label: t("store.freeTrial"), cls: "bg-secondary text-secondary-foreground" }
                : {
                    label: t("billing.statusExpired"),
                    cls: "bg-destructive-soft text-destructive",
                  };

  // A closed account cannot pay its way back, SQL refuses the intent outright, so
  // it gets no payment affordance at all. A suspension does: paying clears it.
  const canPay = can("money") && !s?.closed;
  // The ledger records what the business paid. A cancelled checkout is a click that
  // never became money: the row stays (a late settlement still activates the term it
  // paid for) but it is not something to read, count, print or download.
  const rows = (history.data ?? []).filter((r) => r.status !== "cancelled");
  const lastPaid = rows.find((r) => r.status === "paid") ?? null;
  const paidInvoices = rows.filter((r) => r.status === "paid");
  // The table is a ledger, so it gets the same filter shape the other lists use:
  // everything, the confirmed payments, or the attempts still waiting on the provider.
  const unpaidInvoices = rows.filter((r) => r.status !== "paid");
  const visibleRows = rows.filter((r) =>
    statusFilter === "all"
      ? true
      : statusFilter === "paid"
        ? r.status === "paid"
        : r.status !== "paid",
  );
  const usagePct = s?.capacity ? Math.min(100, Math.round((stores.length / s.capacity) * 100)) : 0;

  // The page owns the two intents, so each button opens the dialog already in the
  // mode it means. Resetting the pickers on open keeps a choice left over from a
  // previous visit out of the quote.
  const openRenew = () => {
    setRenewMonths(1);
    setRenewSlotsDraft(null);
    setPlanMode("renew");
  };
  const openAdd = () => {
    setAddDelta(1);
    setPlanMode("add-stores");
  };
  const openNew = () => {
    setNewSlots(newSlotsMin);
    setNewMonths(1);
    setPlanMode("new");
  };

  // Whoever is standing at the till is often not the person who can pay, and the
  // locked screen used to offer them nothing at all. This turns "the shop is locked"
  // into a message the owner can act on, from any signed-in device.
  function shareToOwner() {
    const digits = (store?.phone ?? "").replace(/\D/g, "");
    const text = t("billing.waLockedMsg", {
      name: business?.name ?? t("billing.yourAccount"),
      amount: fmt(currency, nextAmount),
      date: (paidUntil ?? trialEnd ?? new Date()).toLocaleDateString(undefined, {
        dateStyle: "medium",
      }),
      link: `${window.location.origin}/app/billing`,
    });
    window.open(
      digits
        ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  // Shared props for month pickers
  const monthPickerSharedProps = {
    discountBadge: t("billing.discountBadge"),
    unitSingular: t("billing.monthUnit"),
    unitPlural: t("billing.monthUnits"),
  };

  // Shared pay button, always the amount `paymentQuote` priced, which is the
  // amount `start_store_subscription_payment` records and the provider charges.
  const payBtn = (
    <Button disabled={busy} className="w-full sm:w-auto" onClick={pay}>
      <HugeiconsIcon icon={CreditCardIcon} />
      {busy ? t("billing.opening") : t("billing.payAmount", { amount: fmt(currency, quote.total) })}
    </Button>
  );

  // ── One dialog, three modes ───────────────────────────────────────────────
  // The picker edits whichever month count the active mode owns.
  const setMonths = (v: number) => {
    if (planMode === "renew") setRenewMonths(v);
    else setNewMonths(v);
  };

  const planHead: Record<PlanMode, { title: string; desc: string }> = {
    // A running term and a lapsed one are different jobs. Saying "you have N slots
    // running to <date>" with no date, or with one in the past, is what printed an em
    // dash where a date belongs.
    renew: s?.paid
      ? {
          title: t("billing.renewExtendTitle"),
          desc: t("billing.renewExtendDesc", {
            capacity: renewSlots,
            date: paidUntil?.toLocaleDateString(undefined, { dateStyle: "long" }) ?? "—",
          }),
        }
      : {
          title: t("billing.renewLapsedTitle"),
          desc: t("billing.renewLapsedDesc", {
            date: paidUntil?.toLocaleDateString(undefined, { dateStyle: "long" }) ?? "—",
            count: liveStores,
          }),
        },
    "add-stores": {
      title: t("billing.addStoresTitle"),
      desc: t("billing.addStoresIntro", {
        capacity: paidCapacity,
        delta: safeAddDelta,
        total: addTotal,
      }),
    },
    // Three ways to arrive here without a running term: a trial that is still open, a
    // suspension the payment lifts, and a term that simply ran out.
    new: s?.suspended
      ? {
          title: t("billing.settleTitle"),
          desc: t("billing.settleDesc", {
            amount: fmt(currency, calcTotal(currency, resolvedNewSlots, newMonths)),
            months: newMonths,
            count: newMonths,
          }),
        }
      : s?.trial
        ? {
            title: t("billing.choosePlanTitle"),
            desc: t("billing.choosePlanDesc", {
              count: stores.length,
              name: business?.name ?? t("billing.yourAccount"),
            }),
          }
        : {
            title: t("billing.reopenTitle"),
            desc: t("billing.reopenDesc", {
              date: paidUntil?.toLocaleDateString(undefined, { dateStyle: "long" }) ?? "—",
              count: resolvedNewSlots,
            }),
          },
  };
  const head = planHead[planMode ?? "renew"];

  // Which clock ran out decides both the heading and what to do about it. Before
  // this a suspension, a spent free trial and an account holding more stores than
  // it paid for all read "needs attention", which tells an owner standing at a
  // locked till nothing at all.
  const trialEnded = !!s && !s.sub?.paid_until && !s.paid && !s.trial && !s.suspended && !s.closed;
  // The card below already carries the long suspension and closure notices, so only
  // the trial, which has no notice of its own, gets an explanatory sub-line.
  const lockedHead = !s
    ? { title: t("billing.needsAttentionTitle"), sub: t("billing.sub") }
    : s.closed
      ? { title: t("billing.closedTitle"), sub: t("billing.sub") }
      : s.suspended
        ? { title: t("billing.suspendedTitle"), sub: t("billing.sub") }
        : trialEnded
          ? { title: t("billing.trialEndedTitle"), sub: t("billing.trialEndedSub") }
          : s.overLimit
            ? { title: t("billing.overLimitTitle"), sub: t("billing.sub") }
            : { title: t("billing.expiredTitle"), sub: t("billing.trialEndedSub") };

  return (
    <div className={cn("mx-auto w-full max-w-5xl space-y-8", locked && "max-w-xl py-6")}>
      <PageHeader
        breadcrumb={locked ? undefined : `${t("nav.settings")} / ${t("nav.subscription")}`}
        title={locked ? lockedHead.title : t("billing.title")}
        sub={locked ? lockedHead.sub : t("billing.sub")}
      />

      {/* The shell hides its own copy of this banner on the billing route, so the
          renewal prompt is never shown twice on one screen. The link is dropped here
          because this page is its destination. */}
      <GraceBanner hideLink />

      {/* Summary band: the plan on the left, how paying works on the right. Below
          `lg` the rail simply stacks under the card, and a closed account drops it,
          there is nothing left to pay. */}
      <div
        className={cn(
          "grid gap-4",
          !s?.closed && "lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start",
        )}
      >
        {/* ── Current plan card ──────────────────────────────────────────── */}
        <Card className="flex flex-col justify-between p-4">
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize",
                      status.cls,
                    )}
                  >
                    {status.label}
                  </span>
                  <span className="text-[13px] font-semibold">
                    {sub.isPending ? (
                      <Skeleton className="h-3.5 w-28" aria-hidden />
                    ) : s?.paid ? (
                      t("billing.planOf", { plan: s?.sub?.plan ?? "Storq" })
                    ) : s?.trial ? (
                      t("store.freeTrial")
                    ) : (
                      t("billing.noActivePlan")
                    )}
                  </span>
                </div>
                {/* Date first, coverage second: the two facts an owner is asked
                    about at the counter. Inside the grace window that date is in the
                    past, so the countdown takes its place. */}
                <p className="text-sm text-muted-foreground">
                  {s?.paid && paidUntil
                    ? t("billing.paidUntilLine", {
                        date: paidUntil.toLocaleDateString(undefined, { dateStyle: "long" }),
                      })
                    : s?.inGrace || s?.inTrialGrace
                      ? t("billing.graceCardLine", { days: graceDays, count: graceDays })
                      : s?.trial && trialEnd
                        ? t("billing.trialEnds", { date: trialEnd.toLocaleDateString() })
                        : t("billing.subscribeToKeep")}
                  {s?.capacity
                    ? ` · ${t("billing.storesUsed", { used: stores.length, capacity: s.capacity, count: s.capacity })}`
                    : ""}
                </p>
                {s?.capacity ? (
                  <Progress
                    value={usagePct}
                    className={cn(
                      "h-1.5 w-full max-w-xs bg-muted [&>div]:bg-primary",
                      s.overLimit && "[&>div]:bg-destructive",
                    )}
                  />
                ) : null}
              </div>

              {/* The number this page exists to answer: what the next payment costs
                  and when it falls due. The unit price is context, so it drops to a
                  caption instead of competing with it. */}
              {!s?.closed && (
                <div className="w-full shrink-0 text-left sm:w-auto sm:text-right">
                  <div className="tabular text-3xl leading-none font-extrabold">
                    {fmt(currency, nextAmount)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s?.paid && paidUntil
                      ? t("billing.nextDueOn", {
                          date: paidUntil.toLocaleDateString(undefined, { dateStyle: "medium" }),
                        })
                      : s?.trial && trialEnd
                        ? t("billing.trialEnds", { date: trialEnd.toLocaleDateString() })
                        : t("billing.dueNow")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("billing.nextBasis", { count: s?.paid ? renewSlots : liveStores })}
                  </div>
                </div>
              )}
            </div>

            {/* One notice, and the one that actually explains the block: a shop
                holding more locations than it paid for used to get no explanation. */}
            {s?.closed ? (
              <p className="rounded-xl bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
                {t("billing.closedNotice")}
              </p>
            ) : s?.suspended ? (
              <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning-foreground">
                {t("billing.suspendedNotice")}
              </p>
            ) : s?.overLimit ? (
              <p className="rounded-xl bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
                {t("billing.overLimitNotice", {
                  count: stores.length,
                  capacity: s.capacity,
                })}
              </p>
            ) : null}

            {/* A capacity purchase finishes only half the job: the slot exists, the
                location does not. Shown whenever a paid slot is unused, derived, so
                it survives a reload and a payment made on another till. */}
            {spareSlots > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-success-soft px-3 py-2 text-[13px] text-success">
                <p className="min-w-0">{t("billing.spareSlots", { count: spareSlots })}</p>
                <Link
                  to="/app/stores"
                  search={{ add: 1 }}
                  className="inline-flex shrink-0 items-center gap-1 font-medium underline"
                >
                  {t("billing.addLocationNow")}
                  <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
                </Link>
              </div>
            ) : null}

            {/* A charge the provider took but our server has not confirmed yet. Quiet
                chrome on purpose: nothing is wrong, the bank is still settling and this
                page is watching, so it does not get a third warning block. */}
            {awaitingPayment ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border px-3 py-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{t("billing.pendingTitle")}</p>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {t("billing.pendingBody")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={verifying}
                    onClick={() => void verifyRecent()}
                  >
                    {verifying ? t("billing.verifying") : t("billing.checkNow")}
                  </Button>
                  {/* The buyer may know better than the page does. Closing the attempt
                      is what stops a cancelled checkout being watched. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={cancelling}
                    onClick={() => void cancelAttempt()}
                  >
                    {cancelling ? t("billing.cancelling") : t("billing.cancelAttempt")}
                  </Button>
                </div>
              </div>
            ) : null}

            {/* On a locked screen the fear is that the shop's data is gone with the
                term. One line, where the eye already is. */}
            {locked || s?.closed || s?.suspended || s?.overLimit ? (
              <p className="text-xs text-muted-foreground">{t("billing.dataSafe")}</p>
            ) : null}
          </div>

          {/* One row of controls rather than a separate settings block: the currency
              the charge is actually made in, and the jobs an owner comes here for. */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("billing.pricesIn")}</span>
              <SegmentedControl
                size="sm"
                value={currency}
                onChange={setCurrency}
                options={[
                  { value: "MWK", label: "MWK" },
                  { value: "USD", label: "USD" },
                ]}
              />
              {locked && (
                <Button variant="outline" size="sm" onClick={lock}>
                  {t("billing.switchStaff")}
                </Button>
              )}
            </div>

            {/* A closed account cannot pay its way back, so it gets no button. A
                person without the money permission gets the one action they do have:
                hand the job to the owner. */}
            {s?.closed ? null : canPay ? (
              <div className="flex flex-wrap items-center gap-2">
                {s?.paid ? (
                  <>
                    <Button variant="outline" size="sm" onClick={openAdd}>
                      <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                      {t("billing.addLocationTab")}
                    </Button>
                    <Button size="sm" onClick={openRenew}>
                      {t("billing.renewOrExtend")}
                      <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={openNew}>
                    {s?.trial ? t("billing.trialChooseCta") : t("billing.reopenTillsCta")}
                    <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPlanMode(s?.paid ? "renew" : "new")}
              >
                {t("billing.askOwnerToPay")}
              </Button>
            )}
          </div>
        </Card>

        {/* ── How paying works ───────────────────────────────────────── */}
        {/* No stored card: PayChangu is a checkout, not a vault. So the rail answers
            the questions a payer actually has, who takes the money, whether anything
            is charged on its own, and how one date covers every location. */}
        {!s?.closed && (
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold">
              <HugeiconsIcon icon={Wallet01Icon} className="size-4 text-muted-foreground" />
              {t("billing.howPayingWorks")}
            </h2>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{t("billing.payProviders")}</p>
            <div className="mt-3 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
              <p>{t("billing.onePriceNote")}</p>
              <p>{t("billing.noAutoCharge")}</p>
              <p>{t("billing.oneExpiryNote")}</p>
              <p>{t("billing.graceNote")}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mt-1 px-2 text-primary hover:text-primary"
              onClick={() => setPayOpen(true)}
            >
              {t("billing.mmStepsTitle")}
              <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
            </Button>
          </Card>
        )}
      </div>

      {/* ── Payments ─────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">{t("billing.sectionTitle")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("billing.sectionSub")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              aria-label={t("billing.historyFilterLabel")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={
                [
                  {
                    value: "all",
                    label: `${t("billing.filterAll")} · ${rows.length}`,
                  },
                  { value: "paid", label: `${t("billing.filterPaid")} · ${paidInvoices.length}` },
                  {
                    value: "open",
                    label: `${t("billing.filterOpen")} · ${unpaidInvoices.length}`,
                  },
                ] as const
              }
            />
            <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <HugeiconsIcon icon={Download01Icon} /> {t("billing.downloadStatement")}
                </Button>
              </DialogTrigger>
              <DialogContent className={SHEET}>
                <SheetHead
                  title={t("billing.stmtTitle")}
                  desc={t("billing.stmtIntro", { count: paidInvoices.length })}
                />
                <SheetBody>
                  {paidInvoices.length ? (
                    <div className="divide-y rounded-xl border">
                      {paidInvoices.map((r) => (
                        <div
                          key={r.tx_ref}
                          className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <HugeiconsIcon
                              icon={File01Icon}
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">
                              {new Date(r.paid_at ?? r.created_at).toLocaleDateString(undefined, {
                                dateStyle: "medium",
                              })}
                            </span>
                          </span>
                          <span className="tabular shrink-0 font-medium">
                            {fmt(r.currency as Currency, Number(r.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-2 text-sm text-muted-foreground">
                      {t("billing.noPaidInvoices")}
                    </p>
                  )}
                </SheetBody>
                <SheetFooter>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => setDownloadOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    {/* One document, not one per payment: a browser stops honouring a
                        chain of timed downloads, and the owner wants the total anyway. */}
                    <Button
                      disabled={!paidInvoices.length}
                      onClick={() => {
                        printStatement(paidInvoices, business?.name ?? "");
                        setDownloadOpen(false);
                      }}
                    >
                      {t("billing.downloadStatement")}
                    </Button>
                  </div>
                </SheetFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="divide-y overflow-hidden">
          {history.isPending ? (
            <RowsSkeleton rows={4} className="p-4" />
          ) : history.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              {t("billing.invoicesError")}
            </p>
          ) : !history.data?.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("billing.noInvoicesYet")}
            </p>
          ) : (
            <>
              <div className="px-4 py-2.5 text-xs text-muted-foreground">
                {t("billing.historyCount", { count: visibleRows.length })}
              </div>
              {visibleRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t("billing.noPaymentsMatch")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28 pl-4">{t("doc.date")}</TableHead>
                      <TableHead>{t("billing.thDescription")}</TableHead>
                      <TableHead className="w-28">{t("billing.thAmount")}</TableHead>
                      <TableHead className="hidden w-24 sm:table-cell">
                        {t("billing.thStatus")}
                      </TableHead>
                      <TableHead className="w-14" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((r) => {
                      const paid = r.status === "paid";
                      const when = new Date(r.paid_at ?? r.created_at);
                      // Capacity purchases charge the new slots only, so the label has to
                      // say what was billed, not the resulting total capacity.
                      const billed = r.billed_stores ?? r.stores;
                      // Period column may be 'monthly', 'yearly', or an integer string
                      const monthCount =
                        r.period === "monthly" ? 1 : r.period === "yearly" ? 12 : Number(r.period);
                      const periodDisplay = !isNaN(monthCount)
                        ? `${monthCount} ${t(
                            monthCount === 1 ? "billing.monthUnit" : "billing.monthUnits",
                          )}`
                        : r.period;
                      const pill = cn(
                        "rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize",
                        paid
                          ? "bg-success-soft text-success"
                          : "bg-secondary text-muted-foreground",
                      );
                      // Provider statuses are codes; an owner reads words. Anything
                      // the ledger still calls "pending" is money the provider has
                      // not settled yet, which is what the badge says.
                      const status = paid
                        ? t("status.completed")
                        : r.status === "pending"
                          ? t("billing.stPending")
                          : r.status === "failed"
                            ? t("billing.stFailed")
                            : t("billing.stCancelled");
                      return (
                        <TableRow key={r.tx_ref} className="text-[13px]">
                          <TableCell className="whitespace-nowrap pl-4 text-muted-foreground">
                            {when.toLocaleDateString(undefined, { dateStyle: "medium" })}
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">
                                {billed < r.stores
                                  ? t("billing.addedStoresCount", { count: billed })
                                  : t("billing.storesCount", { count: billed })}
                                <span className="font-normal text-muted-foreground">
                                  {" · "}
                                  {periodDisplay} {t("billing.planWord")}
                                </span>
                              </span>
                              {/* The status column folds away on phones, so the badge
                                travels with the description there. */}
                              <span className={cn(pill, "shrink-0 sm:hidden")}>{status}</span>
                            </div>
                          </TableCell>
                          <TableCell className="tabular whitespace-nowrap font-medium">
                            {fmt(r.currency as Currency, Number(r.amount))}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <span className={pill}>{status}</span>
                          </TableCell>
                          <TableCell className="w-14">
                            {paid && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-muted-foreground hover:text-primary"
                                aria-label={t("billing.downloadInvoiceAria", { ref: r.tx_ref })}
                                onClick={() => printInvoice(r, business?.name ?? "")}
                              >
                                <HugeiconsIcon icon={Download01Icon} />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </Card>
      </section>

      {/* ══ RENEW / ADD / NEW ═════════════════════════════════════════════════
          One dialog, three modes, decided by the button that opened it. Renew locks
          the store count and buys months; add-stores bills the delta only; new
          subscribes a total slot count. Duration, expiry line, price summary and the
          pay button are shared, as is the single `paid_until` every mode renews.
      ═════════════════════════════════════════════════════════════════════= */}
      <Dialog open={planMode !== null} onOpenChange={(o) => !o && setPlanMode(null)}>
        <DialogContent className={SHEET}>
          <SheetHead title={head.title} desc={head.desc} />

          {!canPay ? (
            <>
              <SheetBody>
                <p className="text-sm text-muted-foreground">{t("billing.askAdminRenew")}</p>
              </SheetBody>
              {/* The person who cannot pay is usually the one standing at the till.
                  Give them the hand-off instead of a dead end. */}
              <SheetFooter>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={() => setPlanMode(null)}>
                    {t("common.close")}
                  </Button>
                  <Button onClick={shareToOwner}>{t("billing.graceShareCta")}</Button>
                </div>
              </SheetFooter>
            </>
          ) : (
            <>
              <SheetBody>
                {/* Slots, the one thing the three modes genuinely mean differently. The
                    hint on the label row does the arithmetic, so the big number reads
                    against something ("2 of 3 stores used" / "New total: 4 slots"). */}
                {planMode === "add-stores" ? (
                  <CountStepper
                    value={safeAddDelta}
                    min={1}
                    max={addDeltaMax}
                    onChange={setAddDelta}
                    label={t("billing.addStoresDeltaLabel")}
                    hint={t("billing.addStoresTotalLine", { total: addTotal })}
                    unitSingular={t("billing.newStore")}
                    unitPlural={t("billing.newStores")}
                    note={
                      <>
                        <div className="flex items-baseline justify-between gap-3">
                          <span>{t("billing.joinsPaidTerm")}</span>
                          <span className="tabular shrink-0 font-medium text-foreground">
                            {t("billing.monthsLeft", { count: termMonthsLeft })}
                          </span>
                        </div>
                        <p>
                          {t("billing.joinsPaidTermDesc", {
                            date:
                              paidUntil?.toLocaleDateString(undefined, { dateStyle: "long" }) ??
                              "—",
                          })}
                        </p>
                      </>
                    }
                  />
                ) : planMode === "new" ? (
                  <CountStepper
                    value={resolvedNewSlots}
                    min={newSlotsMin}
                    max={1000}
                    onChange={setNewSlots}
                    label={t("billing.slotsLabel")}
                    hint={t("billing.storesUsed", {
                      used: stores.length,
                      capacity: resolvedNewSlots,
                      count: resolvedNewSlots,
                    })}
                    unitSingular={t("billing.storeUnit")}
                    unitPlural={t("billing.storeUnits")}
                    note={
                      resolvedNewSlots < stores.length ? (
                        <p className="text-amber-600" role="alert">
                          {t("billing.minSlotsWarning", { count: stores.length })}
                        </p>
                      ) : undefined
                    }
                  />
                ) : (
                  <CountStepper
                    value={renewSlots}
                    min={liveStores}
                    max={renewCeiling}
                    onChange={setRenewSlotsDraft}
                    label={t("billing.slotsLabel")}
                    hint={t("billing.storesUsed", {
                      used: liveStores,
                      capacity: renewSlots,
                      count: renewSlots,
                    })}
                    unitSingular={t("billing.storeUnit")}
                    unitPlural={t("billing.storeUnits")}
                    note={
                      renewSlots < renewCeiling ? (
                        <p>
                          {t("billing.renewRightSizeNote", {
                            released: renewCeiling - renewSlots,
                          })}
                        </p>
                      ) : paidCapacity > liveStores ? (
                        <p>
                          {t("billing.renewSpareSlotsNote", { spare: paidCapacity - liveStores })}
                        </p>
                      ) : undefined
                    }
                  />
                )}

                {/* No month picker in add-stores: a new slot joins the term already paid
                    for. Offering a duration here is what let an owner pick 12 months, pay
                    for one location and receive twelve months on every location. */}
                {planMode !== "add-stores" && (
                  <MonthPicker
                    value={months}
                    onChange={setMonths}
                    label={t("billing.monthsLabel")}
                    {...monthPickerSharedProps}
                  />
                )}

                <PriceSummary
                  currency={currency}
                  stores={quote.billedSlots}
                  months={quote.months}
                  breakdownLabel={[
                    t(
                      planMode === "add-stores"
                        ? "billing.priceBreakdownNew"
                        : "billing.priceBreakdown",
                      {
                        price: fmt(currency, PRICES[currency]),
                        count: quote.billedSlots,
                      },
                    ),
                    t("billing.monthsTerm", { count: quote.months }),
                  ].join(" × ")}
                  discountLabel={t("billing.yearDiscountLine")}
                  totalLabel={t("common.total")}
                  // Add-stores explained its expiry in the note above; the other two
                  // modes are buying time, so the new date belongs next to the total.
                  note={
                    isCapacityPurchase
                      ? undefined
                      : t("billing.expiresAfterPay", {
                          date: payUntil.toLocaleDateString(undefined, { dateStyle: "long" }),
                        })
                  }
                />
              </SheetBody>

              <SheetFooter className="space-y-2">
                {/* The checkout window opens on the click below, say what the phone must
                    do while it is up. */}
                {busy && (
                  <p className="rounded-lg bg-background px-3 py-2 text-xs text-muted-foreground">
                    {t("billing.mmCheckoutHint")}
                  </p>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  {/* The entry button already decided the mode, so the only switch here
                      is a quiet link beside the action, never a tab row asking the same
                      question twice. */}
                  {s?.paid ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => (planMode === "add-stores" ? openRenew() : openAdd())}
                    >
                      {planMode === "add-stores"
                        ? t("billing.orRenewTerm")
                        : t("billing.orAddLocations")}
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {payBtn}
                    {awaitingPayment && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={verifying}
                        onClick={() => void verifyRecent()}
                      >
                        {verifying ? t("billing.verifying") : t("billing.verifyRecent")}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-center text-[11px] text-muted-foreground sm:text-left">
                  {t("billing.payProviders")}
                </p>
              </SheetFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ══ PAYMENT METHOD INFO ════════════════════════════════════════════ */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className={SHEET}>
          <SheetHead title={t("billing.payMethodTitle")} desc={t("billing.noCardStored")} />

          <SheetBody>
            {/* Two rails, one list: what the owner can pick inside the PayChangu
                window, described where they asked about it. */}
            <div className="divide-y rounded-xl border">
              <div className="flex items-center gap-3 px-3.5 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <HugeiconsIcon icon={Wallet01Icon} className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t("billing.mobileMoneyTitle")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("billing.mobileMoneyDesc")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-3.5 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <HugeiconsIcon icon={CreditCardIcon} className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t("billing.cardTitle")}</div>
                  <div className="text-xs text-muted-foreground">{t("billing.cardDesc")}</div>
                </div>
              </div>
            </div>

            {/* Mobile money is approved by hand on the phone, so the three steps live
                right where the owner picks it, no separate help page to find. */}
            <div className="rounded-xl bg-muted/50 px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("billing.mmStepsTitle")}
              </p>
              <ol className="mt-2 space-y-2 text-xs text-muted-foreground">
                {[t("billing.mmStep1"), t("billing.mmStep2"), t("billing.mmStep3")].map(
                  (step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-background text-[11px] font-semibold text-foreground">
                        {i + 1}
                      </span>
                      <span className="leading-snug">{step}</span>
                    </li>
                  ),
                )}
              </ol>
            </div>

            {lastPaid && (
              <p className="text-xs text-muted-foreground">
                {t("billing.lastPaidLine", {
                  date: new Date(lastPaid.paid_at ?? lastPaid.created_at).toLocaleDateString(
                    undefined,
                    { dateStyle: "long" },
                  ),
                  amount: fmt(lastPaid.currency as Currency, Number(lastPaid.amount)),
                })}
              </p>
            )}
          </SheetBody>

          <SheetFooter>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setPayOpen(false)}>
                {t("common.close")}
              </Button>
              {awaitingPayment && (
                <Button variant="ghost" disabled={verifying} onClick={() => void verifyRecent()}>
                  {verifying ? t("billing.verifying") : t("billing.verifyRecent")}
                </Button>
              )}
            </div>
          </SheetFooter>
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
  billed_stores: number | null;
  status: string;
  created_at: string;
  paid_at: string | null;
};

function printInvoice(r: Inv, biz: string) {
  const c = r.currency as Currency;
  const d = new Date(r.paid_at ?? r.created_at).toLocaleDateString("en-ZA", { dateStyle: "long" });
  const amt = fmt(c, Number(r.amount));
  const monthCount = r.period === "monthly" ? 1 : r.period === "yearly" ? 12 : Number(r.period);
  const periodDisplay = !isNaN(monthCount)
    ? `${monthCount} month${monthCount !== 1 ? "s" : ""}`
    : r.period;
  // The invoice must list the slots the amount was charged for.
  const billed = r.billed_stores ?? r.stores;
  const planDisplay =
    billed < r.stores
      ? `+${billed} new location${billed !== 1 ? "s" : ""} · ${periodDisplay}`
      : `${billed} location${billed !== 1 ? "s" : ""} · ${periodDisplay}`;
  void downloadPdf({
    filename: `storq-invoice-${r.tx_ref}`,
    title: tInv("billing.invTitle"),
    business: "Storq",
    subtitle: tInv("billing.invSubtitle", { ref: r.tx_ref }),
    badge: r.status === "paid" ? tInv("billing.badgePaid") : r.status.toUpperCase(),
    meta: [
      [tInv("billing.billedTo"), biz || "—"],
      [tInv("billing.invoiceDate"), d],
      [tInv("billing.invPlan"), planDisplay],
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
            billed,
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

/**
 * One statement for the whole ledger. The old "download all" fired one PDF per
 * payment on a timer; browsers drop the tail of that chain, and an owner who asks for
 * everything wants the total at the bottom anyway.
 */
function printStatement(rows: Inv[], biz: string) {
  if (!rows.length) return;
  const when = (r: Inv) => new Date(r.paid_at ?? r.created_at);
  const sorted = [...rows].sort((a, b) => when(a).getTime() - when(b).getTime());
  const day = (d: Date) => d.toLocaleDateString("en-ZA", { dateStyle: "medium" });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // Amounts can be charged in either currency; a single grand total across both
  // would be a lie, so each one gets its own line.
  const sums = new Map<string, number>();
  for (const r of sorted) sums.set(r.currency, (sums.get(r.currency) ?? 0) + Number(r.amount));
  void downloadPdf({
    filename: "storq-statement",
    title: tInv("billing.stmtTitle"),
    business: "Storq",
    subtitle: tInv("billing.stmtSubtitle", { count: sorted.length, name: biz || "—" }),
    meta: [
      [tInv("billing.billedTo"), biz || "—"],
      [tInv("billing.stmtRange"), first && last ? `${day(when(first))} – ${day(when(last))}` : "—"],
    ],
    sections: [
      {
        type: "table",
        head: [
          tInv("doc.date"),
          tInv("billing.thDescription"),
          tInv("billing.thStores"),
          tInv("billing.thAmount"),
        ],
        align: ["left", "left", "right", "right"],
        body: sorted.map((r) => {
          const billed = r.billed_stores ?? r.stores;
          const monthCount =
            r.period === "monthly" ? 1 : r.period === "yearly" ? 12 : Number(r.period);
          const periodDisplay = !isNaN(monthCount)
            ? `${monthCount} month${monthCount !== 1 ? "s" : ""}`
            : r.period;
          const desc =
            billed < r.stores
              ? `+${billed} new location${billed !== 1 ? "s" : ""}`
              : `${billed} location${billed !== 1 ? "s" : ""}`;
          return [
            day(when(r)),
            `${desc} · ${periodDisplay}`,
            billed,
            fmt(r.currency as Currency, Number(r.amount)),
          ];
        }),
      },
    ],
    totals: [...sums].map(([c, v]) => [
      sums.size === 1 ? tInv("billing.totalPaid") : `${tInv("billing.totalPaid")} · ${c}`,
      fmt(c as Currency, v),
    ]),
    footerNote: tInv("billing.invFooter"),
  }).catch(() => toast.error(tInv("billing.statementPdfError")));
}
