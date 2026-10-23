import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos, type Business } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NoAccess, PageHeader } from "@/components/pos/bits";
import { CurrencyField } from "@/components/pos/payment-methods";

export const Route = createFileRoute("/_authenticated/app/business")({
  head: () => ({
    meta: [
      { title: "Business | Storq" },
      {
        name: "description",
        content:
          "Set the currency your business reports in. Payment methods live with each location.",
      },
      { property: "og:title", content: "Business | Storq" },
      {
        property: "og:description",
        content:
          "Set the currency your business reports in. Payment methods live with each location.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BusinessPage,
});

function BusinessPage() {
  const { business, can } = usePos();
  const { t } = useI18n();
  if (!can("money", "view_money")) return <NoAccess />;
  if (!business)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("common.loading")}</Card>
    );
  // Remount when the saved value changes so the form starts from the fetched row.
  return <BusinessForm key={`${business.id}:${business.currency}`} business={business} />;
}

function BusinessForm({ business }: { business: Business }) {
  const { rpc, can, staff } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const canEdit = can("money");
  // Prepaid time and history are never converted, so the unit of money is the
  // owner's call alone (the RPC enforces the same rule).
  const owner = !!staff?.owner;
  const [currency, setCurrency] = useState(business.currency);
  const [busy, setBusy] = useState(false);

  const dirty = currency !== business.currency;

  async function save() {
    setBusy(true);
    try {
      await rpc("save_business_settings", { p_currency: currency });
      toast.success(t("biz.saved"));
      await qc.invalidateQueries({ queryKey: ["business"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("nav.business")}`}
        title={t("biz.title")}
        sub={business.name}
        actions={
          <Button onClick={save} disabled={!canEdit || !owner || !dirty || busy}>
            {t("biz.save")}
          </Button>
        }
      />
      <div className="grid gap-4">
        <Card className="space-y-3 p-4">
          <div className="space-y-0.5">
            <h2 className="font-display text-sm font-medium">{t("biz.currency")}</h2>
            <p className="text-xs text-muted-foreground">{t("biz.currencyHint")}</p>
          </div>
          <div className="max-w-xs">
            <CurrencyField value={currency} onChange={setCurrency} disabled={!canEdit || !owner} />
          </div>
          {!owner && <p className="text-xs text-muted-foreground">{t("biz.currencyOwnerOnly")}</p>}
        </Card>
        <Card className="space-y-2 p-4">
          <div className="space-y-0.5">
            <h2 className="font-display text-sm font-medium">{t("biz.paymentMethods")}</h2>
            <p className="text-xs text-muted-foreground">{t("biz.methodsPerLocation")}</p>
          </div>
          <Link to="/app/stores" className="inline-flex text-xs font-medium underline">
            {t("nav.locations")}
          </Link>
        </Card>
      </div>
    </>
  );
}
