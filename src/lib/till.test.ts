import { describe, expect, it } from "vitest";
import { changeDue, composeNote, depositPresets, tenderTotal } from "@/lib/till";

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
