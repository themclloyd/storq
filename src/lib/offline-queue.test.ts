import { beforeEach, describe, expect, it } from "vitest";
import { loadQueue, saveQueue, isNetworkError, newRef, type QueuedSale } from "@/lib/offline";

const sale = (over: Partial<QueuedSale> = {}): QueuedSale => ({
  ref: newRef(),
  at: new Date().toISOString(),
  total: 12.5,
  storeId: "s1",
  args: { items: [{ product_id: "p1", qty: 1 }] },
  ...over,
});

beforeEach(() => localStorage.clear());

describe("offline sales queue (replayed through checkout_ref)", () => {
  it("round-trips queued sales for one account", () => {
    const q = [sale(), sale({ total: 99 })];
    saveQueue("u1", q);
    const back = loadQueue("u1");
    expect(back).toHaveLength(2);
    expect(back.at(-1)?.total).toBe(99);
  });

  it("keeps accounts isolated, one device login's queue never replays into another", () => {
    saveQueue("u1", [sale()]);
    expect(loadQueue("u2")).toEqual([]);
  });

  it("emptying the queue removes the storage key entirely", () => {
    saveQueue("u1", [sale()]);
    saveQueue("u1", []);
    expect(localStorage.getItem("storq-offline-u1")).toBeNull();
    expect(loadQueue("u1")).toEqual([]);
  });

  it("a corrupt blob degrades to an empty queue instead of throwing on unlock", () => {
    localStorage.setItem("storq-offline-u1", "{not json");
    expect(loadQueue("u1")).toEqual([]);
  });
});

describe("replay helpers", () => {
  it("recognises transport failures as queueable, but not business rejections", () => {
    expect(isNetworkError("Failed to fetch")).toBe(true);
    expect(isNetworkError("NetworkError when attempting to fetch resource")).toBe(true);
    expect(isNetworkError("Timeout of 30000ms exceeded")).toBe(true);
    // A server-side rejection (e.g. insufficient stock) must surface, not queue.
    expect(isNetworkError("Not enough stock for Sugar 1kg")).toBe(false);
  });

  it("newRef produces a distinct uuid per call (unique on sales.client_ref)", () => {
    const refs = new Set(Array.from({ length: 20 }, () => newRef()));
    expect(refs.size).toBe(20);
    expect([...refs][0]).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
