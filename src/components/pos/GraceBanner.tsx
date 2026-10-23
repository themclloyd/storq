/**
 * Grace / due / trial banner. SQL stretches the paid-expiry test by three days inside
 * `subscription_active()`, so a shop keeps selling while the owner — usually the only
 * person carrying the mobile-money SIM — is away. This makes that window visible
 * instead of silent, and lets any staff member hand the renewal to the owner over
 * WhatsApp. It grants nothing: the renew button opens the same billing screen whose
 * payment UI stays role-gated, and sharing only passes information along.
 *
 * The free trial gets the same treatment for the opposite reason: it ends without a
 * grace window, so the only warning the shop ever gets is this countdown.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, ArrowUpRight01Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { calcTotal, fmtMoney, useSubscription } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DAY_MS = 86_400_000;

export function GraceBanner() {
  const { t } = useI18n();
  const { business, stores, store } = usePos();
  // Same cached entitlement row the gate uses — no extra database read per screen.
  const sub = useSubscription(business?.id, stores.length);
  const s = sub.data;
  const [number, setNumber] = useState<string | null>(null);

  const paidUntil = s?.sub?.paid_until ? new Date(s.sub.paid_until) : null;
  const trialEnds = s?.sub?.trial_ends_at ? new Date(s.sub.trial_ends_at) : null;
  // Three states worth warning about: already inside the grace window, a term that is
  // still running but ends within two days, or a trial in its last week. A suspension,
  // a closure or an over-capacity account is excluded — those stop writes immediately,
  // so counting down days there would be a false comfort.
  const blocked = !s || s.suspended || s.closed || s.overLimit;
  const dueSoon = !!s?.paid && !!paidUntil && paidUntil.getTime() - Date.now() < 2 * DAY_MS;
  // Grace outranks the trial notice: a lapsed prepaid term is the real deadline even
  // when the trial clock happens to still be running behind it.
  const mode: "grace" | "due" | "trial" | null = !s
    ? null
    : s.inGrace
      ? "grace"
      : dueSoon
        ? "due"
        : s.trialEndingSoon
          ? "trial"
          : null;
  if (blocked || !mode) return null;
  const ends = mode === "trial" ? trialEnds : paidUntil;
  if (!ends) return null;

  const date = ends.toLocaleDateString(undefined, { dateStyle: "medium" });
  const days =
    mode === "grace"
      ? s.graceDaysRemaining
      : Math.max(1, Math.ceil((ends.getTime() - Date.now()) / DAY_MS));
  // Every slot for one month is the least that reopens the tills, so the note can
  // quote a real number instead of "some amount".
  const amount = calcTotal("MWK", Math.max(s.capacity, stores.length, 1), 1);
  const digits = (number ?? store?.phone ?? "").replace(/\D/g, "");

  const noticeKey =
    mode === "grace"
      ? "billing.graceNotice"
      : mode === "due"
        ? "billing.graceDueNotice"
        : "billing.trialEndingNotice";

  function share() {
    const text = t(mode === "trial" ? "billing.waTrialShareMsg" : "billing.waShareMsg", {
      name: business?.name ?? t("billing.yourAccount"),
      amount: fmtMoney("MWK", amount),
      date,
      days,
      link: `${window.location.origin}/app/billing`,
    });
    // Without a usable number the plain share still works — WhatsApp asks the sender
    // to pick a chat, which is exactly what a cashier at the counter would do anyway.
    const url = digits
      ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning/15 px-3.5 py-2.5 text-[13px] text-warning-foreground"
    >
      <HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t(noticeKey, { date, days })}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={share}>
          {t("billing.graceShareCta")}
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/app/billing">
            {t(mode === "trial" ? "billing.trialChooseCta" : "billing.graceRenewCta")}
            <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5" />
          </Link>
        </Button>
        <button
          type="button"
          className="text-xs underline-offset-2 hover:underline"
          onClick={() => setNumber(digits)}
        >
          {t("billing.graceNumberChange")}
        </button>
        {number !== null && (
          <label className="flex items-center gap-1.5 text-xs">
            <span>{t("billing.graceNumberLabel")}</span>
            <Input
              className="h-8 w-36"
              inputMode="tel"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
        )}
      </div>
    </div>
  );
}
