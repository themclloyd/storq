import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos, type Store } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import {
  LIMITS,
  firstError,
  optionalText,
  requireText,
  sanitizeText,
  validateAmount,
  validateEmail,
  validatePhone,
} from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackLink, PageHeader } from "@/components/pos/bits";
import { RadioCard, StoreTypeTag } from "@/components/pos/store-settings";

export const Route = createFileRoute("/_authenticated/app/stores_/$id")({
  head: () => ({
    meta: [
      { title: "Location — Storq" },
      { name: "description", content: "Location VAT and receipt details." },
      { property: "og:title", content: "Location — Storq" },
      { property: "og:description", content: "Location VAT and receipt details." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StorePage,
});

const types = [
  { v: "direct", tKey: "store.typeDirect", dKey: "store.directDesc" },
  { v: "approval", tKey: "store.approvalTitle", dKey: "store.approvalDesc" },
] as const;

function StorePage() {
  const { id } = Route.useParams();
  const { stores, can } = usePos();
  const { t } = useI18n();
  if (!can("admin"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("store.onlyAdmins")}</Card>
    );
  const store = stores.find((s) => s.id === id);
  if (!store)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {stores.length ? t("store.notFound") : t("common.loading")}
      </Card>
    );
  // Keyed so a refreshed store row resets the draft once the query returns.
  return <StoreForm key={store.id} store={store} />;
}

function StoreForm({ store }: { store: Store }) {
  const { rpc, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(store.name);
  const [type, setType] = useState<Store["store_type"]>(store.store_type);
  const [phone, setPhone] = useState(store.phone ?? "");
  const [email, setEmail] = useState(store.email ?? "");
  const [address, setAddress] = useState(store.address ?? "");
  const [taxNumber, setTaxNumber] = useState(store.tax_number ?? "");
  const [rate, setRate] = useState(String(store.tax_rate ?? 0));
  const [incl, setIncl] = useState(store.tax_inclusive ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    const err = firstError(
      requireText(name, t("store.locationName"), LIMITS.storeName),
      validatePhone(phone, true),
      email.trim() ? validateEmail(email) : null,
      optionalText(address, t("store.address"), LIMITS.address),
      optionalText(taxNumber, t("store.taxNumber"), LIMITS.taxId),
      validateAmount(rate, { label: t("store.taxRate"), min: 0, max: 50 }),
    );
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      await rpc("save_store", {
        p_id: store.id,
        p_name: sanitizeText(name, LIMITS.storeName),
        p_type: type,
        p_phone: phone.trim(),
        p_email: email.trim() || null,
        p_address: address.trim() ? sanitizeText(address, LIMITS.address) : null,
        p_tax_number: taxNumber.trim() || null,
        p_tax_rate: Number(rate || 0),
        p_tax_inclusive: incl,
      });
      toast.success(t("common.saved"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sample = 1000;
  const rateNum = Number(rate || 0);
  const net = incl ? sample / (1 + rateNum / 100) : sample;
  const vat = incl ? sample - net : (sample * rateNum) / 100;

  return (
    <>
      <BackLink to="/app/stores" label={t("store.title")} />
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("store.title")} / ${store.name}`}
        title={store.name}
        sub={<StoreTypeTag type={store.store_type} />}
      />

      <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <div>
            <h3 className="font-display text-base font-medium">{t("store.detailsTitle")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("store.detailsDesc")}</p>
          </div>
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
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.phone")}
            </span>
            <Input
              inputMode="tel"
              maxLength={LIMITS.phone}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.email")}
            </span>
            <Input
              type="email"
              inputMode="email"
              maxLength={LIMITS.email}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.address")}
            </span>
            <Input
              maxLength={LIMITS.address}
              value={address}
              onChange={(e) => setAddress(e.target.value.slice(0, LIMITS.address))}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.taxNumber")}
            </span>
            <Input
              maxLength={LIMITS.taxId}
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value.slice(0, LIMITS.taxId))}
            />
          </Label>
        </Card>

        <Card className="space-y-3 p-5">
          <div>
            <h3 className="font-display text-base font-medium">{t("store.taxTitle")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("store.taxDesc")}</p>
          </div>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.taxRatePct")}
            </span>
            <Input
              inputMode="decimal"
              maxLength={5}
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </Label>
          <div role="radiogroup" aria-label={t("store.taxTitle")} className="space-y-2">
            {(
              [
                [true, "store.inclTitle", "store.inclDesc"],
                [false, "store.addVatTitle", "store.addVatDesc"],
              ] as const
            ).map(([v, ti, di]) => (
              <RadioCard
                key={String(v)}
                checked={incl === v}
                onSelect={() => setIncl(v)}
                title={t(ti)}
                desc={t(di)}
              />
            ))}
          </div>
          <div className="rounded-2xl bg-secondary/50 p-3 text-[13px]">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("store.taxExample", { amount: money(sample) })}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("store.exampleNet")}</span>
              <span className="tabular font-medium">{money(net)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("store.exampleVat")}</span>
              <span className="tabular font-medium">{money(vat)}</span>
            </div>
            <div className="mt-1 flex justify-between gap-3 border-t pt-1.5">
              <span className="font-medium">{t("store.exampleTotal")}</span>
              <span className="tabular font-semibold">{money(net + vat)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 max-w-4xl rounded-2xl border p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("store.typeTitle")}
        </div>
        <div
          role="radiogroup"
          aria-label={t("store.typeTitle")}
          className="grid gap-2 md:grid-cols-2"
        >
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
      </div>

      <Button className="mt-5" disabled={busy || !name || !phone} onClick={save}>
        {t("common.save")}
      </Button>
    </>
  );
}
