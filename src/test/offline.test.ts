import { describe, expect, it, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clearDeviceCache, hydrateCache, isNetworkError, loadQueue, persistCache, saveQueue } from "@/lib/offline";

beforeEach(() => localStorage.clear());

describe("offline helpers", () => {
  it("recognises dropped connections but not business errors", () => {
    expect(isNetworkError("TypeError: Failed to fetch")).toBe(true);
    expect(isNetworkError("Not enough stock for: Bread")).toBe(false);
  });

  it("keeps queued sales per account and clears empty queues", () => {
    saveQueue("u1", [{ ref: "r", at: "", total: 10, storeId: "s", args: {} }]);
    expect(loadQueue("u1")).toHaveLength(1);
    expect(loadQueue("u2")).toHaveLength(0);
    saveQueue("u1", []);
    expect(localStorage.getItem("storq-offline-u1")).toBeNull();
  });

  it("persists the till catalog but never buying costs, and restores it as stale", async () => {
    const qc = new QueryClient();
    const stop = persistCache(qc, "u1");
    qc.setQueryData(["products", "b", false], [{ id: "p" }]);
    qc.setQueryData(["products", "b", true], [{ id: "p", cost: 5 }]);
    qc.setQueryData(["sales", "x"], [1]);
    await new Promise((r) => setTimeout(r, 1700));
    stop();
    const fresh = new QueryClient();
    hydrateCache(fresh, "u1");
    expect(fresh.getQueryData(["products", "b", false])).toEqual([{ id: "p" }]);
    expect(fresh.getQueryData(["products", "b", true])).toBeUndefined();
    expect(fresh.getQueryData(["sales", "x"])).toBeUndefined();
    expect(fresh.getQueryState(["products", "b", false])?.dataUpdatedAt).toBe(0);
    clearDeviceCache();
    expect(localStorage.getItem("storq-cache-u1")).toBeNull();
  });
});
