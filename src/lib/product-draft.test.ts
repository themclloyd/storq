import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import type { Product } from "@/lib/products";
import {
  changedDrafts,
  draftFromProduct,
  emptyDraft,
  isBlankDraft,
  validateDraft,
} from "@/lib/product-draft";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Cotton Robe",
  sku: "SABC234567",
  category: null,
  price: 100,
  cost: 40,
  active: true,
  reorder_point: null,
  ...over,
});

const filled = (over: Partial<ReturnType<typeof emptyDraft>> = {}) => ({
  ...emptyDraft("SROW234567"),
  name: "Cotton Robe",
  price: "100",
  cost: "40",
  ...over,
});

describe("isBlankDraft", () => {
  it("treats an untouched spare row as blank", () => {
    expect(isBlankDraft(emptyDraft())).toBe(true);
  });

  it("counts a row with only a name as typed into", () => {
    expect(isBlankDraft({ ...emptyDraft(), name: "Robe" })).toBe(false);
  });
});

describe("validateDraft", () => {
  it("passes a complete row", () => {
    expect(validateDraft(filled(), { codes: [] })).toBeNull();
  });

  it("requires a name", () => {
    expect(validateDraft(filled({ name: "  " }), { codes: [] })).toBe(
      t("validate.required", { label: t("common.name") }),
    );
  });

  it("reports an existing item that already holds the code", () => {
    expect(validateDraft(filled({ sku: "sabc234567" }), { codes: [product()] })).toBe(
      t("inv.codeTaken", { name: "Cotton Robe" }),
    );
  });

  it("lets an edited item keep its own code", () => {
    const draft = { ...filled({ sku: "SABC234567" }), id: "p1" };
    expect(validateDraft(draft, { codes: [product()] })).toBeNull();
  });

  it("reports two rows of one sheet claiming the same code", () => {
    const first = filled({ name: "Robe" });
    const second = filled({ name: "Socks" });
    expect(validateDraft(second, { codes: [], others: [first] })).toBe(t("inv.codeTakenInRow"));
  });

  it("refuses a cost at or above the selling price", () => {
    expect(validateDraft(filled({ cost: "100" }), { codes: [] })).toBe(t("inv.errCostAbovePrice"));
  });

  it("refuses a quantity that is not a number", () => {
    expect(validateDraft(filled({ qty: "1.2.3" }), { codes: [] })).toBe(
      t("validate.amountNumber", { label: t("inv.quantity") }),
    );
  });
});

describe("changedDrafts", () => {
  const before = draftFromProduct(product(), 7);

  it("keeps only rows that differ from the catalog", () => {
    const untouched = { ...before };
    const repriced = { ...before, price: "120" };
    expect(changedDrafts([before], [untouched, repriced])).toEqual([repriced]);
  });

  it("ignores a code that differs only in case or spacing", () => {
    expect(changedDrafts([before], [{ ...before, sku: " sabc234567 " }])).toEqual([]);
  });

  it("ignores a quantity rewritten the same way", () => {
    expect(changedDrafts([before], [{ ...before, qty: "7.00" }])).toEqual([]);
  });
});
