import { useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { viewOnly, type InventoryView } from "@/lib/inventory-view";
import { Card } from "@/components/ui/card";
import { ProductBulkEditForm } from "@/components/pos/product-bulk";

export const Route = createFileRoute("/_authenticated/app/inventory_/bulk")({
  // The ids are the rows ticked in the table, carried as one comma-joined string
  // so the link stays short and readable; a JSON array is still accepted because
  // the router parses JSON-looking values back into arrays. The table's view
  // rides along so the grid returns to the page the rows were picked on.
  validateSearch: (search: Record<string, unknown>): { ids: string } & Partial<InventoryView> => {
    const raw = search["ids"];
    return {
      ...viewOnly(search),
      ids: Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string").join(",")
        : typeof raw === "string"
          ? raw
          : "",
    };
  },
  head: () => ({
    meta: [
      { title: "Edit items | Storq" },
      { name: "description", content: "Edit several items in one grid." },
      { property: "og:title", content: "Edit items | Storq" },
      { property: "og:description", content: "Edit several items in one grid." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BulkEdit,
});

function BulkEdit() {
  const search = Route.useSearch();
  const { ids } = search;
  // The router keeps `search` stable per location, so this stays stable too and
  // the redirect effect below fires once instead of on every render.
  const back = useMemo(() => viewOnly(search as Record<string, unknown>), [search]);
  const { can } = usePos();
  const { t } = useI18n();
  const nav = useNavigate();
  const list = useMemo(
    () =>
      ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [ids],
  );
  // An empty list is a stale link, not a screen: send the person back to the
  // table they pick rows on.
  useEffect(() => {
    if (!list.length) void nav({ to: "/app/inventory", search: back, replace: true });
  }, [list.length, back, nav]);
  if (!can("stock"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.noAccess")}</Card>
    );
  if (!list.length)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.bulkEmpty")}</Card>
    );
  return <ProductBulkEditForm ids={list} back={back} />;
}
