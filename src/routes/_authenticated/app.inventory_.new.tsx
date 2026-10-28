import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { viewOnly, type InventoryView } from "@/lib/inventory-view";
import { Card } from "@/components/ui/card";
import { ProductBulkAddForm } from "@/components/pos/product-bulk";

export const Route = createFileRoute("/_authenticated/app/inventory_/new")({
  // The scanner's "unknown code" shortcut lands here with the code it read, so
  // the first row arrives filled in instead of the person retyping a label. The
  // table's own view rides along, so Save and Cancel return to that page of it.
  validateSearch: (
    search: Record<string, unknown>,
  ): { code?: string | undefined } & Partial<InventoryView> => ({
    ...viewOnly(search),
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "New items | Storq" },
      { name: "description", content: "Add one or several items at once." },
      { property: "og:title", content: "New items | Storq" },
      { property: "og:description", content: "Add one or several items at once." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: NewItems,
});

function NewItems() {
  const { can } = usePos();
  const { t } = useI18n();
  const search = Route.useSearch();
  const back = useMemo(() => viewOnly(search as Record<string, unknown>), [search]);
  if (!can("stock"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.noAccess")}</Card>
    );
  return <ProductBulkAddForm initialCode={search.code} back={back} />;
}
