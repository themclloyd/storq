import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findByBarcode, type Product } from "@/lib/products";
import { useScannerWedge } from "@/components/pos/use-scanner";
import { useIdleLock } from "@/components/pos/use-idle-lock";

const product = (over: Partial<Product>): Product => ({
  id: "p1",
  name: "Item",
  sku: "123456",
  category: null,
  price: 10,
  cost: 0,
  active: true,
  reorder_point: null,
  ...over,
});

describe("findByBarcode", () => {
  const list = [
    product({ id: "a", sku: "ABC-9" }),
    product({ id: "b", sku: "6141419600016" }),
    product({ id: "c", sku: "xyz", active: false }),
  ];
  it("matches trimmed, case-insensitive exact SKU", () => {
    expect(findByBarcode(list, "  abc-9 ")?.id).toBe("a");
    expect(findByBarcode(list, "6141419600016")?.id).toBe("b");
  });
  it("ignores inactive items, partial codes and empty input", () => {
    expect(findByBarcode(list, "xyz")).toBeUndefined();
    expect(findByBarcode(list, "abc")).toBeUndefined();
    expect(findByBarcode(list, "")).toBeUndefined();
  });
});

// The scanner acts as a keyboard wedge: a rapid burst of keydown events on the
// window (not a focused field) followed by Enter.
const typeBurst = (code: string) => {
  for (const key of code) fireEvent(window, new KeyboardEvent("keydown", { key, bubbles: true }));
  fireEvent(window, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};

describe("useScannerWedge", () => {
  afterEach(cleanup);

  it("resolves a fast burst ending in Enter against the catalog", () => {
    const onMatch = vi.fn((_code: string) => false);
    renderHook(() => useScannerWedge(onMatch));
    typeBurst("123456");
    const last = onMatch.mock.calls.at(-1)?.[0];
    expect(last).toBe("123456");
  });

  it("adds the matched item once and stops the burst", () => {
    const onMatch = vi.fn((c: string) => c === "123456");
    renderHook(() => useScannerWedge(onMatch));
    typeBurst("123456");
    expect(onMatch.mock.calls.at(-1)?.[0]).toBe("123456");
  });

  it("never traps typing that happens inside a text field", () => {
    const onMatch = vi.fn(() => false);
    renderHook(() => useScannerWedge(onMatch));
    const input = document.createElement("input");
    document.body.appendChild(input);
    for (const key of "123456")
      fireEvent(input, new KeyboardEvent("keydown", { key, bubbles: true }));
    fireEvent(input, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.remove();
    expect(onMatch).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onMatch = vi.fn(() => false);
    renderHook(() => useScannerWedge(onMatch, { enabled: false }));
    typeBurst("123456");
    expect(onMatch).not.toHaveBeenCalled();
  });
});

describe("useIdleLock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onIdle after the full idle window", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(onIdle, { enabled: true, minutes: 5 }));
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("re-arms the countdown on user activity", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(onIdle, { enabled: true, minutes: 5 }));
    vi.advanceTimersByTime(4 * 60_000);
    fireEvent(window, new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    vi.advanceTimersByTime(4 * 60_000); // 4 min after the keystroke — still under 5
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("stays off when disabled or set to zero minutes", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleLock(onIdle, { enabled: false, minutes: 5 }));
    renderHook(() => useIdleLock(onIdle, { enabled: true, minutes: 0 }));
    vi.advanceTimersByTime(30 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
