import { describe, expect, it } from "vitest";
import {
  round2,
  lineCapBlocked,
  cartCapBlocked,
  findByBarcode,
  DISCOUNT_CAP_RATIO,
  type Product,
} from "@/lib/products";

const p = (over: Partial<Product> = {}): Product => ({
  id: "1",
  name: "Sugar 1kg",
  sku: "SUG-1",
  category: "grocery",
  price: 10,
  cost: 6,
  active: true,
  reorder_point: null,
  ...over,
});

describe("cashier discount caps (mirror app.checkout)", () => {
  it("rounds money to two decimals like the SQL round(x,2)", () => {
    expect(round2(2.567)).toBe(2.57);
    expect(round2(1.1 + 2.2)).toBe(3.3); // 3.3000000000000003
    expect(round2(10)).toBe(10);
  });

  it("allows a line discount up to exactly 10% and blocks anything past it", () => {
    expect(DISCOUNT_CAP_RATIO).toBe(0.1);
    expect(lineCapBlocked(100, 10)).toBe(false); // at the cap is allowed
    expect(lineCapBlocked(100, 10.01)).toBe(true);
    expect(lineCapBlocked(100, 9)).toBe(false);
  });

  it("guards the cart cap and ignores an empty cart", () => {
    expect(cartCapBlocked(200, 20)).toBe(false);
    expect(cartCapBlocked(200, 20.01)).toBe(true);
    expect(cartCapBlocked(0, 5)).toBe(false); // gross 0 never blocks
  });
});

describe("findByBarcode — resolves against the cached catalog, not the network", () => {
  const list = [p({ id: "a", sku: "ABC 123" }), p({ id: "b", sku: "XYZ", active: false })];

  it("matches case- and whitespace-insensitively after normalization", () => {
    expect(findByBarcode(list, "abc 123")?.id).toBe("a");
    expect(findByBarcode(list, "  ABC   123  ")?.id).toBe("a"); // collapsed + trimmed
    expect(findByBarcode(list, "ABC 123")?.id).toBe("a");
  });

  it("never returns an inactive product or a blank code", () => {
    expect(findByBarcode(list, "XYZ")).toBeUndefined(); // inactive
    expect(findByBarcode(list, "")).toBeUndefined();
  });
});
