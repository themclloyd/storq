import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  CreditCardIcon,
  PlusSignIcon,
} from "@/lib/icons";
import { usePos, type Store } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { LIMITS, firstError, requireText, sanitizeText, validatePhone } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NoAccess, PageHeader } from "@/components/pos/bits";
import { RadioCard, StoreTypeTag } from "@/components/pos/store-settings";
import { PaymentMethodPicker } from "@/components/pos/payment-methods";
import { LEGACY_PAYMENT_METHODS } from "@/lib/payment-methods";
import { useSubscription } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/app/stores")({
  // Billing returns an owner here with ?add=1 once the extra slot is paid for, so
  // the dialog they were told to open is already waiting for them.
  validateSearch: (search: Record<string, unknown>): { add?: number | undefined } => ({
    add: Number(search["add"]) === 1 ? 1 : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Locations | Storq" },
      { name: "description", content: "Manage your Storq locations, VAT and receipt details." },
      { property: "og:title", content: "Locations | Storq" },
      {
        property: "og:description",
        content: "Manage your Storq locations, VAT and receipt details.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Stores,
});

const types = [
  {
    v: "direct",
    tKey: "store.typeDirect",
    dKey: "store.directDesc",
  },
  {
    v: "approval",
    tKey: "store.approvalTitle",
    dKey: "store.approvalDesc",
  },
] as const;

function Stores() {
  const { stores, archivedStores, can, business, rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { add } = Route.useSearch();
  const subscription = useSubscription(business?.id, stores.length);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  // ?add=1 arrives from Billing after the slot was paid for: open the dialog, then
  // clear the flag so a reload does not reopen it over a finished job.
  useEffect(() => {
    if (add !== 1) return;
    setAdding(true);
    void navigate({ to: "/app/stores", search: {}, replace: true });
  }, [add, navigate]);

  if (!can("locations", "view_locations")) return <NoAccess />;
  // A viewer reads the locations and their receipt setup; creating one, buying
  // capacity, archiving and restoring stay with the change grant.
  const canEdit = can("locations");
  // Out of slots, has a lapsed term, or is suspended — all three read the same to
  // an owner holding a locked till, and all three are answered on Billing.
  const atCapacity = !subscription.data?.canAddStore;

  // Reopening a branch is the mirror of archiving: SQL decides whether a slot is
  // free, and this only reports what it answered.
  async function restore(s: Store) {
    setRestoring(s.id);
    try {
      await rpc("restore_store", { p_id: s.id });
      toast.success(t("store.restored", { name: s.name }));
      await qc.invalidateQueries({ queryKey: ["stores"] });
      await qc.invalidateQueries({ queryKey: ["subscription"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t("store.title")}
        // One count, not two: the capacity sentence already says how many
        // locations exist, so the old "2 locations" subtitle and the bar under
        // it were the same fact printed twice.
        sub={
          subscription.data?.trial
            ? t("store.freeTrial")
            : t("store.capacityLine", {
                used: stores.length,
                capacity: subscription.data?.capacity ?? 0,
              })
        }
        actions={
          !canEdit ? undefined : atCapacity ? (
            <Link to="/app/billing" search={{ intent: "add-stores" }}>
              <Button variant="outline">
                <HugeiconsIcon icon={CreditCardIcon} className="size-4" />
                {t("store.payMore")}
              </Button>
            </Link>
          ) : (
            <Button onClick={() => setAdding(true)}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("store.addBtn")}
            </Button>
          )
        }
      />
      <div className="grid gap-2 md:grid-cols-2">
        {stores.map((s) => (
          <Link key={s.id} to="/app/stores/$id" params={{ id: s.id }} className="min-w-0">
            <Card className="flex min-w-0 items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{s.name}</div>
                {(s.phone || s.address) && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[s.phone, s.address].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StoreTypeTag type={s.store_type} />
                  <span className="text-[11px] text-muted-foreground">
                    {t("till.vat")} {Number(s.tax_rate ?? 0)}%
                    {s.tax_inclusive === false ? ` · ${t("till.added")}` : ""}
                  </span>
                </div>
              </div>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="size-4 shrink-0 text-muted-foreground"
              />
            </Card>
          </Link>
        ))}
      </div>

      {/* Closed branches stay here, with every sale they ever made, and can be put
          back without losing a number. Collapsed by default: they are history, not
          a second list of places to trade from. */}
      {archivedStores.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b pb-2">
            <div>
              <h2 className="text-[13px] font-semibold">{t("store.archivedTitle")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("store.archivedSub", { count: archivedStores.length })}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? t("store.hideArchived") : t("store.showArchived")}
            </Button>
          </div>
          {showArchived && (
            <div className="grid gap-2 md:grid-cols-2">
              {archivedStores.map((s) => (
                <Card
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-dashed p-4"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-muted-foreground">
                      {s.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("store.archivedOn", {
                        date: new Date(s.archived_at as string).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        }),
                      })}
                    </div>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={restoring === s.id}
                      onClick={() => void restore(s)}
                    >
                      <HugeiconsIcon icon={ArrowReloadHorizontalIcon} className="size-3.5" />
                      {t("store.restoreBtn")}
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {adding && <StoreDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function StoreDialog({ onClose }: { onClose: () => void }) {
  const { rpc, paymentMethods } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState<Store["store_type"]>("direct");
  const [phone, setPhone] = useState("");
  // A new branch starts with the same ways money comes in as the one in use;
  // retired codes are never added to a location that never carried them.
  const [methods, setMethods] = useState(() =>
    paymentMethods.filter((code) => !LEGACY_PAYMENT_METHODS.some((m) => m.code === code)),
  );
  async function save() {
    const err = firstError(
      requireText(name, t("store.locationName"), LIMITS.storeName),
      validatePhone(phone, true),
    );
    if (err) {
      toast.error(err);
      return;
    }
    try {
      const id = await rpc<string>("save_store", {
        p_id: null,
        p_name: sanitizeText(name, LIMITS.storeName),
        p_type: type,
        p_phone: phone.trim(),
        p_payment_methods: methods,
      });
      toast.success(t("store.added"));
      // Wait for the list to carry the new location before opening its page.
      // The subscription is refreshed too: the last free slot just went, so the
      // header must switch from "Add" to "Upgrade" without a manual reload. SQL
      // re-counts live locations, so this only mirrors what it will answer.
      await qc.invalidateQueries({ queryKey: ["stores"] });
      await qc.invalidateQueries({ queryKey: ["store-payment-methods"] });
      await qc.invalidateQueries({ queryKey: ["subscription"] });
      onClose();
      if (id) void navigate({ to: "/app/stores/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("store.addBtn")}</DialogTitle>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {t("store.locationName")}
          </span>
          <Input
            maxLength={LIMITS.storeName}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, LIMITS.storeName))}
          />
        </Label>
        <Label className="block space-y-1">
          <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {t("store.phone")}
          </span>
          <Input
            inputMode="tel"
            maxLength={LIMITS.phone}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Label>
        <div role="radiogroup" aria-label={t("store.locationName")} className="space-y-2">
          {types.map((opt) => (
            <RadioCard
              key={opt.v}
              checked={type === opt.v}
              onSelect={() => setType(opt.v)}
              title={t(opt.tKey)}
              desc={t(opt.dKey)}
            />
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {t("biz.paymentMethods")}
          </p>
          <PaymentMethodPicker value={methods} onChange={setMethods} />
        </div>
        <Button disabled={!name} onClick={save}>
          {t("store.saveBtn")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
