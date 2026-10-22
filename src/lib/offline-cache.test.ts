import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { hydrateCache, persistCache } from "@/lib/offline";

const user = "user-1";
const catalog = ["products", "b1", false];
const costs = ["products", "b1", true];

const snapshot = (entries: unknown) => JSON.stringify({ v: 2, q: entries });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("offline reference cache", () => {
  it("rehydrates each entry at the time it was actually fetched", () => {
    const fetchedAt = Date.now() - 5_000;
    localStorage.setItem(
      "storq-cache-" + user,
      snapshot([{ k: catalog, d: [{ id: "p1" }], t: fetchedAt }]),
    );
    const qc = new QueryClient();
    hydrateCache(qc, user);
    expect(qc.getQueryData(catalog)).toEqual([{ id: "p1" }]);
    // Preserving `t` is what stops a page refresh from forcing a fresh read:
    // the query's staleTime is measured from the original fetch, not from now.
    expect(qc.getQueryState(catalog)?.dataUpdatedAt).toBe(fetchedAt);
  });

  it("refuses a snapshot from the future instead of pinning it fresh forever", () => {
    const now = Date.now();
    localStorage.setItem(
      "storq-cache-" + user,
      snapshot([{ k: catalog, d: [], t: now + 86_400_000 }]),
    );
    const qc = new QueryClient();
    hydrateCache(qc, user);
    // The clamp stamps `Date.now()` when it hydrates, which can be a millisecond
    // later than the `now` captured before the call; what matters is that the
    // future timestamp was not kept.
    expect(qc.getQueryState(catalog)?.dataUpdatedAt).toBeLessThanOrEqual(Date.now());
  });

  it("discards v1 snapshots, which carry no fetch times", () => {
    localStorage.setItem(
      "storq-cache-" + user,
      JSON.stringify({ v: 1, q: [{ k: catalog, d: [] }] }),
    );
    const qc = new QueryClient();
    hydrateCache(qc, user);
    expect(qc.getQueryData(catalog)).toBeUndefined();
  });

  it("never writes role-gated data to disk", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const stop = persistCache(qc, user);
    qc.setQueryData(catalog, [{ id: "p1" }]);
    qc.setQueryData(costs, [{ id: "p1", cost: 10 }]);
    await vi.advanceTimersByTimeAsync(2_000);
    stop();
    const saved = JSON.parse(localStorage.getItem("storq-cache-" + user) ?? "{}");
    expect(saved.q.map((e: { k: unknown[] }) => e.k)).toEqual([catalog]);
    expect(saved.q[0].t).toBeTypeOf("number");
  });
});
