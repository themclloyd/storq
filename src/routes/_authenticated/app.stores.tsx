import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, CreditCardIcon, PlusSignIcon } from "@/lib/icons";
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
import { pluralize } from "@/lib/format";
import { useSubscription } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/app/stores")({
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
  const { stores, can, business } = usePos();
  const { t } = useI18n();
  const subscription = useSubscription(business?.id, stores.length);
  const [adding, setAdding] = useState(false);
  if (!can("locations", "view_locations")) return <NoAccess />;
  // A viewer reads the locations and their receipt setup; creating one or
  // buying capacity stays with the change grant.
  const canEdit = can("locations");
  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("nav.locations")}`}
        title={t("store.title")}
        sub={pluralize(stores.length, t("store.oneLocation"), t("store.manyLocations"))}
        actions={
          !canEdit ? undefined : subscription.data?.canAddStore ? (
            <Button onClick={() => setAdding(true)}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("store.addBtn")}
            </Button>
          ) : (
            <Link to="/app/billing">
              <Button variant="outline">
                <HugeiconsIcon icon={CreditCardIcon} className="size-4" />
                {t("store.payMore")}
              </Button>
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-[13px]">
        <p className="text-muted-foreground">
          {subscription.data?.trial
            ? t("store.freeTrial")
            : t("store.capacityLine", {
                used: stores.length,
                capacity: subscription.data?.capacity ?? 0,
              })}
        </p>
        {canEdit && !subscription.data?.canAddStore && (
          <Link to="/app/billing" className="font-medium underline">
            {t("store.payMore")}
          </Link>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {stores.map((s) => (
          <Link key={s.id} to="/app/stores/$id" params={{ id: s.id }} className="min-w-0">
            <Card className="flex min-w-0 items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40">
              <div className="min-w-0">
                <div className="truncate font-medium">{s.name}</div>
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
      await qc.invalidateQueries({ queryKey: ["stores"] });
      await qc.invalidateQueries({ queryKey: ["store-payment-methods"] });
      onClose();
      if (id) void navigate({ to: "/app/stores/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("store.addBtn")}</DialogTitle>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("store.locationName")}
          </span>
          <Input
            maxLength={LIMITS.storeName}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, LIMITS.storeName))}
          />
        </Label>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("store.phone")}</span>
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
          <p className="text-[11px] font-medium text-muted-foreground">{t("biz.paymentMethods")}</p>
          <PaymentMethodPicker value={methods} onChange={setMethods} />
        </div>
        <Button disabled={!name} onClick={save}>
          {t("store.saveBtn")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
