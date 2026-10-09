import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePos, type Store } from "@/lib/pos";
import { LIMITS, requireText, sanitizeText, validateAmount } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  approval: "bg-warning/25 text-warning-foreground",
  direct: "bg-success/15 text-success",
};

function StoreTypeTag({ type }: { type: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full border-transparent px-2 py-0.5 text-[11px] uppercase tracking-wide",
        storeTypeStyle[type] ?? "bg-success/15 text-success",
      )}
    >
      {type === "approval" ? "Approval" : "Direct sale"}
    </Badge>
  );
}

function Stores() {
  const { stores, can, business } = usePos();
  const subscription = useSubscription(business?.id, stores.length);
  const [edit, setEdit] = useState<Partial<Store> | null>(null);
  if (!can("admin"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
        Only admins can manage locations.
      </Card>
    );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Locations</h1>
        <Button
          variant="accent"
          disabled={!subscription.data?.canAddStore}
          onClick={() => setEdit({ store_type: "direct" })}
        >
          <HugeiconsIcon icon={PlusSignIcon} /> Add location
        </Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-[13px]">
        <p className="text-muted-foreground">
          {subscription.data?.trial
            ? "Free trial"
            : `${stores.length} locations · ${subscription.data?.capacity ?? 0} paid location slots`}
        </p>
        {!subscription.data?.canAddStore && (
          <Link to="/app/billing" className="font-medium underline">
            Pay for more locations
          </Link>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {stores.map((s) => (
          <Card
            key={s.id}
            className="flex min-w-0 items-center justify-between gap-3 p-3 shadow-none"
          >
            <div className="min-w-0">
              <div className="truncate font-bold">{s.name}</div>
              <div className="mt-1">
                <StoreTypeTag type={s.store_type} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>
              Edit
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
    t: "Direct sale",
    d: "Cashier rings up and takes payment. Stock leaves immediately.",
  },
  {
    v: "approval",
    t: "Approval based",
    d: "Cashier creates an invoice. A manager or admin approves it before stock leaves and payment is recorded.",
  },
] as const;

function StoreDialog({ s, onClose }: { s: Partial<Store>; onClose: () => void }) {
  const { rpc } = usePos();
  const qc = useQueryClient();
  const [name, setName] = useState(s.name ?? "");
  const [type, setType] = useState<Store["store_type"]>(s.store_type ?? "direct");
  async function save() {
    const err = requireText(name, "Location name", LIMITS.storeName);
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
      toast.success("Saved");
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.id ? "Edit location" : "Add location"}</DialogTitle>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Location name</span>
          <Input
            maxLength={LIMITS.storeName}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, LIMITS.storeName))}
          />
        </Label>
        <div className="space-y-2">
          {types.map((t) => (
            <Button
              key={t.v}
              type="button"
              variant={type === t.v ? "secondary" : "outline"}
              onClick={() => setType(t.v)}
              className="block h-auto w-full rounded-lg whitespace-normal p-3 text-left shadow-none"
            >
              <span className="block text-sm font-semibold">{t.t}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t.d}</span>
            </Button>
          ))}
        </div>
        <Button disabled={!name} onClick={save}>
          Save location
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function TaxSettings() {
  const { business, rpc } = usePos();
  const qc = useQueryClient();
  const [rate, setRate] = useState(String(business?.tax_rate ?? 0));
  const [incl, setIncl] = useState(business?.tax_inclusive ?? true);
  async function save() {
    const err = validateAmount(rate, { label: "Tax rate", min: 0, max: 50 });
    if (err) {
      toast.error(err);
      return;
    }
    try {
      await rpc("save_tax_settings", { p_rate: Number(rate || 0), p_inclusive: incl });
      toast.success("Tax settings saved");
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Card className="mt-5 max-w-xl space-y-3 p-4 shadow-none">
      <div>
        <h3 className="text-sm font-bold">VAT / sales tax</h3>
        <p className="text-[13px] text-muted-foreground">
          Applies to all locations. Set 0 if you are not VAT registered. Past sales keep the tax
          they were sold with.
        </p>
      </div>
      <Label className="block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">Tax rate (%)</span>
        <Input
          inputMode="decimal"
          maxLength={5}
          value={rate}
          onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </Label>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            [true, "Prices include VAT", "Shelf price is what the customer pays."],
            [false, "Add VAT at till", "VAT is added on top of the shelf price."],
          ] as const
        ).map(([v, t, d]) => (
          <Button
            key={String(v)}
            type="button"
            variant={incl === v ? "secondary" : "outline"}
            onClick={() => setIncl(v as boolean)}
            className="h-auto rounded-lg whitespace-normal p-3 text-left shadow-none"
          >
            <span className="block text-sm font-semibold">{t}</span>
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{d}</span>
          </Button>
        ))}
      </div>
      <Button onClick={save}>Save tax settings</Button>
    </Card>
  );
}
