import { describe, expect, it } from "vitest";
import { cashPresets, changeDue, composeNote, depositPresets, tenderTotal } from "@/lib/till";

describe("smart cash tender (Square's quick-cash buttons)", () => {
  it("leads with the exact total and no change", () => {
    const [exact] = cashPresets(7420);
    expect(exact).toEqual({ amount: 7420, change: 0, exact: true });
  });

  it("offers the next notes above the total, never a duplicate or a lower amount", () => {
    expect(cashPresets(7420)).toEqual([
      { amount: 7420, change: 0, exact: true },
      { amount: 8000, change: 580, exact: false },
      { amount: 10000, change: 2580, exact: false },
      { amount: 20000, change: 12580, exact: false },
    ]);
  });

  it("keeps every button above the total when the total is already a round note", () => {
    const presets = cashPresets(8000);
    expect(presets.map((p) => p.amount)).toEqual([8000, 9000, 10000, 20000]);
    expect(presets.every((p) => p.amount >= 8000)).toBe(true);
  });

  it("handles a zero total without offering the same button twice", () => {
    const amounts = cashPresets(0).map((p) => p.amount);
    expect(new Set(amounts).size).toBe(amounts.length);
    expect(amounts[0]).toBe(0);
  });

  it("rounds a fractional total to two decimals", () => {
    expect(cashPresets(7420.555)[0]!.amount).toBe(7420.56);
  });
});

describe("layby deposit presets", () => {
  it("offers the full amount and half of it", () => {
    expect(depositPresets(10000)).toEqual([10000, 5000]);
  });

  it("never repeats a half that rounds to nothing", () => {
    expect(depositPresets(0)).toEqual([0]);
  });

  it("keeps a real half on a small total", () => {
    expect(depositPresets(1)).toEqual([1, 0.5]);
  });
});

describe("change due", () => {
  it("returns the cash above the total", () => {
    expect(changeDue([{ method: "cash", amount: 8000 }], 7420, "sale")).toBe(580);
  });

  it("subtracts what a non-cash tender already covered", () => {
    expect(
      changeDue(
        [
          { method: "cash", amount: 3000 },
          { method: "airtel_money", amount: 5000 },
        ],
        7420,
        "sale",
      ),
    ).toBe(580);
  });

  it("never returns a negative change and never changes a layby deposit", () => {
    expect(changeDue([{ method: "cash", amount: 1000 }], 7420, "sale")).toBe(0);
    expect(changeDue([{ method: "cash", amount: 9000 }], 7420, "layby")).toBe(0);
  });

  it("sums tenders to two decimals", () => {
    expect(
      tenderTotal([
        { method: "cash", amount: 0.1 },
        { method: "cash", amount: 0.2 },
      ]),
    ).toBe(0.3);
  });
});

describe("sale note", () => {
  it("keeps an empty sale empty", () => {
    expect(composeNote("   ", [])).toBe("");
  });

  it("puts the order note first, then each line note with its item name", () => {
    expect(
      composeNote("Deliver after 5pm", [
        { name: "T-shirt", note: "Size 42" },
        { name: "Sugar 1kg" },
      ]),
    ).toBe("Deliver after 5pm · T-shirt: Size 42");
  });

  it("caps the note at the 500 characters the checkout RPC accepts", () => {
    expect(composeNote("x".repeat(600), []).length).toBe(500);
  });
});
