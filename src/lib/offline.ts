// Device-local persistence for the till: an instant-start snapshot of reference
// data and a queue of sales made while the internet was down. Browser-only.
import type { QueryClient } from "@tanstack/react-query";

const CACHE_PREFIX = "storq-cache-";
const QUEUE_PREFIX = "storq-offline-";
// v2 stores each entry's fetch time so a reload can honour staleTime instead of
// re-reading the database on every refresh (v1 snapshots are discarded).
const CACHE_VERSION = 2;

// Reference data the register needs to open instantly. Never persist role-gated
// data (buying costs, reports) — only what every staff role can already read.
const PERSIST = new Set([
  "business",
  "stores",
  "products",
  "collections",
  "stock",
  "staff-names",
  "subscription",
]);
const persistable = (key: readonly unknown[]) =>
  PERSIST.has(String(key[0])) &&
  !(key[0] === "products" && key[2] === true) &&
  !(key[0] === "subscription" && key[1] === "history");

/**
 * Role-neutral reference data every staff role may read. It survives PIN
 * lock/unlock so the till stays warm; everything else (costs, reports, staff
 * lists, history) is dropped on lock and refetched for the next person.
 */
export const isSharedReference = (key: readonly unknown[]) => persistable(key);
export const isRoleScoped = (key: readonly unknown[]) => !persistable(key);

export function hydrateCache(qc: QueryClient, userId: string) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return;
    const snap = JSON.parse(raw) as {
      v: number;
      q: { k: unknown[]; d: unknown; t?: number }[];
    };
    if (snap.v !== CACHE_VERSION) return;
    const now = Date.now();
    // Rehydrate each row with the time it was actually fetched. A refresh (or
    // a burst of F5s) then obeys the query's staleTime instead of forcing one
    // database read per query; an old or clock-skewed snapshot simply looks
    // stale and refreshes in the background as before.
    for (const { k, d, t } of snap.q) {
      if (qc.getQueryData(k) !== undefined) continue;
      const fetchedAt = Number(t);
      const updatedAt = Number.isFinite(fetchedAt) && fetchedAt > 0 ? Math.min(fetchedAt, now) : 0;
      qc.setQueryData(k, d, { updatedAt });
    }
  } catch {
    localStorage.removeItem(CACHE_PREFIX + userId);
  }
}

export function persistCache(qc: QueryClient, userId: string) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    const q = qc
      .getQueryCache()
      .findAll()
      .filter(
        (x) =>
          x.state.status === "success" && x.state.data !== undefined && persistable(x.queryKey),
      )
      .map((x) => ({ k: x.queryKey as unknown[], d: x.state.data, t: x.state.dataUpdatedAt }));
    try {
      localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify({ v: CACHE_VERSION, q }));
    } catch {
      /* storage full: skip, the app still works online */
    }
  };
  const unsub = qc.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || !persistable(e.query.queryKey)) return;
    clearTimeout(t);
    t = setTimeout(save, 1500);
  });
  return () => {
    clearTimeout(t);
    unsub();
  };
}

export function clearDeviceCache() {
  for (const k of Object.keys(localStorage))
    if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
}

export type QueuedSale = {
  ref: string;
  at: string;
  total: number;
  storeId: string;
  args: Record<string, unknown>;
  error?: string | undefined;
};

export const loadQueue = (userId: string): QueuedSale[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_PREFIX + userId) ?? "[]");
  } catch {
    return [];
  }
};
export const saveQueue = (userId: string, q: QueuedSale[]) => {
  if (q.length) localStorage.setItem(QUEUE_PREFIX + userId, JSON.stringify(q));
  else localStorage.removeItem(QUEUE_PREFIX + userId);
};

export const isNetworkError = (m: string) =>
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(m);

export const newRef = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
      );
