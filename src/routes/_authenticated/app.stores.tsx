import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, Tick02Icon } from "@/lib/icons";
import { usePos, type Store } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { LIMITS, requireText, sanitizeText, validateAmount } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/pos/bits";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/app/stores")({
  head: () => ({
    meta: [
      { title: "Locations — Storq" },
      { name: "description", content: "Manage your Storq locations and tax settings." },
      { property: "og:title", content: "Locations — Storq" },
      { property: "og:description", content: "Manage your Storq locations and tax settings." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Stores,
});

const storeTypeStyle: Record<string, string> = {
  approval: "bg-warning-soft text-warning-foreground",
  direct: "bg-success-soft text-success",
};

function StoreTypeTag({ type }: { type: string }) {
  const { t } = useI18n();
  return (
    <Badge
      className={cn(
        "rounded-full border-transparent px-2 py-0.5 text-[11px] uppercase tracking-wide",
        storeTypeStyle[type] ?? "bg-success-soft text-success",
      )}
    >
      {type === "approval" ? t("store.typeApproval") : t("store.typeDirect")}
    </Badge>
  );
}

function Stores() {
  const { stores, can, business } = usePos();
  const { t } = useI18n();
  const subscription = useSubscription(business?.id, stores.length);
  const [edit, setEdit] = useState<Partial<Store> | null>(null);
  if (!can("admin"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("store.onlyAdmins")}</Card>
    );
  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("nav.locations")}`}
        title={t("store.title")}
        sub={pluralize(stores.length, t("store.oneLocation"), t("store.manyLocations"))}
        actions={
          <Button
            disabled={!subscription.data?.canAddStore}
            onClick={() => setEdit({ store_type: "direct" })}
          >
            <HugeiconsIcon icon={PlusSignIcon} /> {t("store.addBtn")}
          </Button>
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
        {!subscription.data?.canAddStore && (
          <Link to="/app/billing" className="font-medium underline">
            {t("store.payMore")}
          </Link>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {stores.map((s) => (
          <Card key={s.id} className="flex min-w-0 items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="truncate font-medium">{s.name}</div>
              <div className="mt-1.5">
                <StoreTypeTag type={s.store_type} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>
              {t("common.edit")}
            </Button>
          </Card>
        ))}
      </div>
      <TaxSettings />
      {edit && <StoreDialog s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

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

function StoreDialog({ s, onClose }: { s: Partial<Store>; onClose: () => void }) {
  const { rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(s.name ?? "");
  const [type, setType] = useState<Store["store_type"]>(s.store_type ?? "direct");
  async function save() {
    const err = requireText(name, t("store.locationName"), LIMITS.storeName);
    if (err) {
      toast.error(err);
      return;
    }
    try {
      await rpc("save_store", {
        p_id: s.id ?? null,
        p_name: sanitizeText(name, LIMITS.storeName),
        p_type: type,
      });
      toast.success(t("common.saved"));
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{s.id ? t("store.editTitle") : t("store.addBtn")}</DialogTitle>
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
        <Button disabled={!name} onClick={save}>
          {t("store.saveBtn")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function TaxSettings() {
  const { business, rpc, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [rate, setRate] = useState(String(business?.tax_rate ?? 0));
  const [incl, setIncl] = useState(business?.tax_inclusive ?? true);
  async function save() {
    const err = validateAmount(rate, { label: t("store.taxRate"), min: 0, max: 50 });
    if (err) {
      toast.error(err);
      return;
    }
    try {
      await rpc("save_tax_settings", { p_rate: Number(rate || 0), p_inclusive: incl });
      toast.success(t("store.taxSaved"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const sample = 1000;
  const rateNum = Number(rate || 0);
  const net = incl ? sample / (1 + rateNum / 100) : sample;
  const vat = incl ? sample - net : (sample * rateNum) / 100;
  return (
    <Card className="mt-5 max-w-xl space-y-3 p-5">
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
      <Button onClick={save}>{t("store.saveTaxBtn")}</Button>
    </Card>
  );
}

function RadioCard({
  checked,
  onSelect,
  title,
  desc,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors",
        checked ? "border-primary bg-secondary/50" : "border-input bg-card hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border [&_svg]:size-3",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked && <HugeiconsIcon icon={Tick02Icon} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
