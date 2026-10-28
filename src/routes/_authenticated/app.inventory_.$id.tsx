import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { useProducts } from "@/lib/products";
import { viewOnly, type InventoryView } from "@/lib/inventory-view";
import { Card } from "@/components/ui/card";
import { ProductForm } from "@/components/pos/product-form";
import { DetailSkeleton } from "@/components/pos/skeletons";

export const Route = createFileRoute("/_authenticated/app/inventory_/$id")({
  // The table's view travels with the link, so Save lands back on the page the
  // row was opened from instead of the top of the catalogue.
  validateSearch: (search: Record<string, unknown>): Partial<InventoryView> => viewOnly(search),
  head: () => ({
    meta: [
      { title: "Edit item | Storq" },
      { name: "description", content: "Change an item's price, code and stock in this store." },
      { property: "og:title", content: "Edit item | Storq" },
      {
        property: "og:description",
        content: "Change an item's price, code and stock in this store.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EditItem,
});

function EditItem() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { store, can } = usePos();
  const { t } = useI18n();
  const back = useMemo(() => viewOnly(search as Record<string, unknown>), [search]);
  // The row comes from the same cached catalog the table listed, so opening the
  // page costs no extra read in the common case.
  const products = useProducts(store?.id, { withCost: true });
  if (!can("stock"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.noAccess")}</Card>
    );
  const product = products.data?.find((p) => p.id === id);
  if (!product) {
    // The row normally arrives with the cached catalogue; a cold device holds
    // the form's shape instead of saying "Loading" on a blank page.
    if (products.isPending) return <DetailSkeleton />;
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.notFound")}</Card>
    );
  }
  // Keyed so a refreshed catalog row resets the draft once the query returns.
  return <ProductForm key={product.id} product={product} back={back} />;
}
