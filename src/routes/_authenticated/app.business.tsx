import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos, type Business } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NoAccess, PageHeader } from "@/components/pos/bits";
import { DetailSkeleton } from "@/components/pos/skeletons";
import { DesktopCard } from "@/components/pos/DesktopCard";
import { CurrencyField } from "@/components/pos/payment-methods";
import { methodLabel } from "@/lib/payment-methods";

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
  if (!can("money", "view_money")) return <NoAccess />;
  if (!business) return <DetailSkeleton />;
  // Remount when the saved value changes so the form starts from the fetched row.
  return <BusinessForm key={`${business.id}:${business.currency}`} business={business} />;
}

function BusinessForm({ business }: { business: Business }) {
  const { rpc, can, staff, stores, paymentMethodsFor } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const canEdit = can("money");
  // Payment methods are set per location, on the location's own screen.
  const canLocations = can("locations", "view_locations");
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
        title={t("biz.title")}
        sub={t("biz.sub")}
        actions={
          <Button onClick={save} disabled={!canEdit || !owner || !dirty || busy}>
            {t("biz.save")}
          </Button>
        }
      />
      <div className="grid gap-4">
        <Card className="space-y-4 p-4">
          <div className="space-y-0.5">
            <h2 className="text-[13px] font-semibold">{t("biz.details")}</h2>
            <p className="text-xs text-muted-foreground">{t("biz.detailsHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* The name is fixed at creation; showing it keeps the page about
                the business rather than a lone currency picker. */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t("biz.name")}</div>
              <div className="truncate text-[13px] font-medium">{business.name}</div>
              <p className="text-xs text-muted-foreground">{t("biz.nameFixed")}</p>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t("biz.currency")}</div>
              <CurrencyField
                value={currency}
                onChange={setCurrency}
                disabled={!canEdit || !owner}
              />
              <p className="text-xs text-muted-foreground">{t("biz.currencyHint")}</p>
            </div>
          </div>
          {!owner && <p className="text-xs text-muted-foreground">{t("biz.currencyOwnerOnly")}</p>}
        </Card>
        <Card className="space-y-2 p-4">
          <div className="space-y-0.5">
            <h2 className="text-[13px] font-semibold">{t("biz.paymentMethods")}</h2>
            <p className="text-xs text-muted-foreground">{t("biz.methodsPerLocation")}</p>
          </div>
          <ul className="divide-y">
            {stores.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {paymentMethodsFor(s.id).map(methodLabel).join(" · ")}
                  </div>
                </div>
                {canLocations && (
                  <Link
                    to="/app/stores/$id"
                    params={{ id: s.id }}
                    className="inline-flex shrink-0 text-xs font-medium underline"
                  >
                    {t("biz.openLocation")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {!canLocations && (
            <p className="text-xs text-muted-foreground">{t("biz.methodsNoAccess")}</p>
          )}
        </Card>
        {/* The website's equivalent of this slot is "get the Windows app"; here
            the app is already running, so it names its own build instead. */}
        <DesktopCard />
      </div>
    </>
  );
}
