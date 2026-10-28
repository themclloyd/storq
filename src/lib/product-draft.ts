import { findCodeClash, normalizeCode } from "@/lib/item-codes";
import type { Product } from "@/lib/products";
import { t } from "@/lib/i18n";
import { LIMITS, firstError, requireText, validateAmount, validateSku } from "@/lib/validate";

/**
 * One item as an editable page holds it: every number stays the string the
 * person typed, so a half-typed "12." is not silently rounded to 12 before they
 * finish. The same shape serves a single item and a row of a bulk sheet, which
 * is what lets one validator cover both.
 */
export type ProductDraft = {
  /** Catalog id when the row already exists; absent on a row being added. */
  id?: string;
  name: string;
  sku: string;
  cost: string;
  price: string;
  qty: string;
  reorder: string;
  active: boolean;
};

export function emptyDraft(sku = ""): ProductDraft {
  return { name: "", sku, cost: "", price: "", qty: "", reorder: "", active: true };
}

export function draftFromProduct(p: Product, qty: number): ProductDraft {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? "",
    cost: String(p.cost),
    price: String(p.price),
    qty: String(qty),
    reorder: p.reorder_point != null ? String(p.reorder_point) : "",
    active: p.active,
  };
}

/**
 * A row nobody typed into. A bulk add starts with one and offers another, so the
 * save skips blank rows instead of refusing the sheet over an empty spare.
 */
export function isBlankDraft(d: ProductDraft): boolean {
  return !d.name.trim() && !d.sku.trim() && !d.cost && !d.price && !d.qty && !d.reorder;
}

/**
 * The first thing wrong with a draft, or null. Mirrors the `save_product` bounds
 * and the cost-below-price rule in SQL, so a sheet fails on the screen instead of
 * half-way through the batch with stock already moved for the rows before it.
 *
 * `others` are the other rows of the same sheet: two rows claiming one code would
 * otherwise pass here and collide on the second write.
 */
export function validateDraft(
  draft: ProductDraft,
  ctx: { codes: readonly Product[]; others?: readonly ProductDraft[] },
): string | null {
  const code = normalizeCode(draft.sku);
  const clash = findCodeClash([...ctx.codes], code, draft.id);
  const peer = code
    ? ctx.others?.find((o) => normalizeCode(o.sku).toUpperCase() === code.toUpperCase())
    : undefined;
  return firstError(
    requireText(draft.name, t("common.name"), LIMITS.productName),
    validateSku(code),
    clash ? t("inv.codeTaken", { name: clash.name }) : null,
    peer ? t("inv.codeTakenInRow") : null,
    validateAmount(draft.price, {
      label: t("inv.sellingPrice"),
      required: true,
      min: 0,
      max: 1_000_000_000,
    }),
    validateAmount(draft.cost, { label: t("inv.buyingCost"), min: 0, max: 1_000_000_000 }),
    // An item bought at or above its selling price loses money on every unit.
    Number(draft.cost) > 0 && Number(draft.cost) >= Number(draft.price || 0)
      ? t("inv.errCostAbovePrice")
      : null,
    draft.qty === ""
      ? null
      : validateAmount(draft.qty, { label: t("inv.quantity"), min: 0, max: 1_200_000 }),
    draft.reorder === ""
      ? null
      : validateAmount(draft.reorder, {
          label: t("inv.reorderPointField"),
          min: 0,
          max: 1_000_000,
          integer: true,
        }),
  );
}

/** Same item, same numbers: the row a bulk save can leave untouched. */
function sameLine(before: ProductDraft, after: ProductDraft): boolean {
  return (
    before.name.trim() === after.name.trim() &&
    normalizeCode(before.sku).toUpperCase() === normalizeCode(after.sku).toUpperCase() &&
    Number(before.cost || 0) === Number(after.cost || 0) &&
    Number(before.price || 0) === Number(after.price || 0) &&
    Number(before.qty || 0) === Number(after.qty || 0) &&
    before.active === after.active
  );
}

/**
 * The rows of a bulk edit that actually changed. Writing untouched rows would
 * bump every `updated_at` and rewrite stock with a quantity nobody asked for.
 */
export function changedDrafts(
  originals: readonly ProductDraft[],
  drafts: readonly ProductDraft[],
): ProductDraft[] {
  return drafts.filter((d) => {
    const before = originals.find((o) => o.id === d.id);
    return before ? !sameLine(before, d) : true;
  });
}
