import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Refresh01Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useCollections } from "@/lib/collections";
import { useProducts, useStock, type Product } from "@/lib/products";
import {
  findCodeClash,
  isAutoCode,
  normalizeCode,
  suggestCode,
  takenCodes,
} from "@/lib/item-codes";
import { draftFromProduct, validateDraft } from "@/lib/product-draft";
import type { InventoryView } from "@/lib/inventory-view";
import { LIMITS, sanitizeText } from "@/lib/validate";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, PageHeader } from "@/components/pos/bits";
import { ItemCodeCard } from "@/components/pos/ItemQr";

/**
 * One existing item as a page (the row's Edit action). Everything that used to
 * live in the modal is here: the code panel, collections, the reorder point and
 * this store's quantity.
 *
 * The quantity field starts blank and only writes stock when it is filled in.
 * The catalog and the stock sheet arrive asynchronously here, so prefilling the
 * field would race the query and re-send a number the person never touched.
 */
export function ProductForm({
  product,
  back,
}: {
  product: Product;
  /** The table's view: where Save and Cancel return to. */
  back: Partial<InventoryView>;
}) {
  const { rpc, store, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const products = useProducts(store?.id, { withCost: true });
  const stock = useStock(store?.id);
  const cols = useCollections();
  const currentQty = stock.data?.[product.id] ?? 0;
  const [sel, setSel] = useState<string[] | null>(null);
  const chosen = sel ?? cols.data?.byProduct[product.id] ?? [];
  const [f, setF] = useState(() => ({ ...draftFromProduct(product, currentQty), qty: "" }));
  // One identifier for the whole item: typed here, printed as the QR, and what
  // the till matches a scan against.
  const code = normalizeCode(f.sku);
  const clash = findCodeClash(products.data ?? [], code, product.id);

  async function save() {
    const err = validateDraft({ ...f, id: product.id }, { codes: products.data ?? [] });
    if (err) {
      toast.error(err);
      return;
    }
    try {
      await rpc("save_product", {
        p_store: store?.id ?? null,
        p_id: product.id,
        p_name: sanitizeText(f.name, LIMITS.productName),
        p_sku: code || null,
        // Category has no field here, pass through what is stored so an edit
        // never silently clears it.
        p_category: product.category ?? null,
        p_price: Number(f.price || 0),
        p_cost: Number(f.cost || 0),
        p_active: f.active,
        p_reorder_point: f.reorder === "" ? null : Number(f.reorder),
      });
      await rpc("set_product_collections", { p_product: product.id, p_collections: chosen });
      // Absolute quantity, never target - cached: set_stock_qty works the
      // movement out against the locked row, so a balance that moved while this
      // page was open cannot write a number nobody typed.
      if (f.qty !== "" && store?.id) {
        await rpc("set_stock_qty", {
          p_store: store.id,
          p_product: product.id,
          p_qty: Number(f.qty),
          p_reason: "correction",
          p_note: "Edited on item",
        });
      }
      toast.success(t("common.saved"));
      invalidateKeys(qc, [
        ["products"],
        ["stock"],
        ["movements"],
        ["collections"],
        ["dash-alerts"],
      ]);
      nav({ to: "/app/inventory", search: back });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        back={{ to: "/app/inventory", label: t("inv.title"), search: back }}
        title={product.name}
        sub={t("inv.editTitleSub")}
      />
      <div className="grid max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-3 p-4">
          <Field label={t("common.name")}>
            <Input
              maxLength={LIMITS.productName}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value.slice(0, LIMITS.productName) })}
            />
          </Field>
          <Field label={t("inv.itemCode")}>
            <div className="flex gap-1.5">
              <Input
                className="min-w-0 flex-1"
                maxLength={LIMITS.sku}
                placeholder={t("inv.codePlaceholder")}
                value={f.sku}
                onChange={(e) => setF({ ...f, sku: e.target.value.slice(0, LIMITS.sku) })}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                title={t("inv.generateCode")}
                aria-label={t("inv.generateCode")}
                onClick={() => setF({ ...f, sku: suggestCode(takenCodes(products.data ?? [])) })}
              >
                <HugeiconsIcon icon={Refresh01Icon} />
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("inv.costPrice")}>
              <Input
                inputMode="decimal"
                maxLength={14}
                value={f.cost}
                onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^0-9.]/g, "") })}
              />
            </Field>
            <Field label={t("inv.sellingPrice")}>
              <Input
                inputMode="decimal"
                maxLength={14}
                value={f.price}
                onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })}
              />
            </Field>
          </div>
          <Field label={t("inv.reorderPoint")}>
            <Input
              inputMode="numeric"
              maxLength={7}
              placeholder={t("inv.reorderPlaceholder")}
              value={f.reorder}
              onChange={(e) => setF({ ...f, reorder: e.target.value.replace(/[^0-9]/g, "") })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={f.active}
              onCheckedChange={(v) => setF({ ...f, active: v === true })}
            />
            {t("inv.availableForSale")}
          </label>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-2 bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {t("inv.codePanel")}
              </span>
              {code && isAutoCode(code) && <Badge variant="secondary">{t("inv.autoTag")}</Badge>}
            </div>
            {clash ? (
              <p className="text-xs text-destructive">{t("inv.codeTaken", { name: clash.name })}</p>
            ) : code ? (
              <ItemCodeCard
                compact
                item={{
                  name: f.name || t("doc.item"),
                  code,
                  price: f.price ? money(f.price) : null,
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t("inv.codeKeepHint")}</p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <Field label={t("inv.collectionsLabel")}>
              <div className="flex flex-wrap gap-1.5">
                {(cols.data?.list ?? []).map((c) => {
                  const on = chosen.includes(c.id);
                  return (
                    <Button
                      type="button"
                      key={c.id}
                      size="sm"
                      variant={on ? "default" : "outline"}
                      onClick={() =>
                        setSel(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id])
                      }
                    >
                      {c.name}
                      {c.discount_pct > 0 ? ` −${c.discount_pct}%` : ""}
                    </Button>
                  );
                })}
                {(cols.data?.list ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground">{t("inv.noCollections")}</span>
                )}
              </div>
            </Field>
            <Field label={`${t("inv.quantity")}, ${store?.name ?? ""}`}>
              <Input
                inputMode="decimal"
                placeholder={String(currentQty)}
                value={f.qty}
                onChange={(e) => setF({ ...f, qty: e.target.value.replace(/[^0-9.]/g, "") })}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {t("inv.currentlyInStock", { qty: currentQty })}
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex max-w-4xl gap-2">
        <Button className="flex-1" disabled={!f.name.trim()} onClick={() => void save()}>
          {t("inv.saveItem")}
        </Button>
        <Button variant="outline" onClick={() => nav({ to: "/app/inventory", search: back })}>
          {t("common.cancel")}
        </Button>
      </div>
    </>
  );
}
