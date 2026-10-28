// Device-local persistence for the till: an instant-start snapshot of reference
// data and a queue of sales made while the internet was down. Browser-only.
//
// Two stores, one snapshot. The webview's own localStorage is the hot copy the
// register reads synchronously at start; the installed Windows app additionally
// mirrors every write into SQLite (`storqdesktop/src-tauri/src/db.rs`) and
// restores from it at boot. That mirror is what survives a webview profile
// reset, a repair install or "clear site data" — the till still opens with its
// catalogue and, more importantly, with every sale it has not filed yet.
import type { QueryClient } from "@tanstack/react-query";
import { desktopInvoke, isDesktop } from "@/lib/desktop";

const CACHE_PREFIX = "storq-cache-";
const QUEUE_PREFIX = "storq-offline-";
// v2 stores each entry's fetch time so a reload can honour staleTime instead of
// re-reading the database on every refresh (v1 snapshots are discarded).
const CACHE_VERSION = 2;

// Reference data the register needs to open instantly. Never persist gated
// data (buying costs, reports), only what every staff member can already read.
const PERSIST = new Set([
  "business",
  "stores",
  "store-payment-methods",
  "products",
  "collections",
  "stock",
  "staff-names",
  "subscription",
]);
const persistable = (key: readonly unknown[]) =>
  PERSIST.has(String(key[0])) &&
  !(key[0] === "products" && key[2] === true) &&
  !(key[0] === "subscription" && key[1] === "history") &&
  // The register's catalogue is read per search, per collection and per code,
  // not kept as one catalogue snapshot: persisting every page would grow this
  // snapshot with each keystroke. What an offline till needs between two sales
  // is the short recent-items list it keeps on its own (`recent-items.ts`).
  !(key[0] === "products" && key[1] === "till") &&
  !(key[0] === "stock" && key[1] === "till") &&
  !(key[0] === "collections" && key[1] === "members");

/**
 * Access-neutral reference data every staff member may read. It survives PIN
 * lock/unlock so the till stays warm; everything else (costs, reports, staff
 * lists, history) is dropped on lock and refetched for the next person.
 */
export const isSharedReference = (key: readonly unknown[]) => persistable(key);
export const isRoleScoped = (key: readonly unknown[]) => !persistable(key);

// ── SQLite mirror (installed app only) ─────────────────────────────────────────

type CacheRow = { userId: string; cacheKey: string; data: string; fetchedAt: number };
type OutboxRow = { userId: string; entry: string };
type CacheEntry = { cacheKey: string; data: string; fetchedAt: number };

let booted = false;
let bootPromise: Promise<void> | null = null;

/** One snapshot, as stored on disk: `{ v, q: [{ k, d, t }] }`. */
type DiskSnapshot = { v: number; q: { k: unknown[]; d: unknown; t?: number }[] };

/**
 * Copy the SQLite snapshot back into the webview's storage, and the outbox into
 * each account's queue, before any query runs.
 *
 * The queue is a union rather than a replace: if the webview wrote a sale that
 * the mirror missed (a crash between the two writes), dropping either copy
 * would lose money. `ref` is unique, so a duplicate is harmless.
 *
 * Resolves always — a till with a broken database still opens.
 */
export function deviceStorageReady(): Promise<void> {
  if (bootPromise) return bootPromise;
  if (typeof window === "undefined" || !isDesktop()) {
    booted = true;
    bootPromise = Promise.resolve();
    return bootPromise;
  }
  bootPromise = (async () => {
    try {
      const [rows, outbox] = await Promise.all([
        desktopInvoke<CacheRow[]>("cache_all"),
        desktopInvoke<OutboxRow[]>("outbox_all"),
      ]);

      const byUser = new Map<string, DiskSnapshot["q"]>();
      for (const row of rows) {
        let data: unknown;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue;
        }
        let key: unknown[];
        try {
          key = JSON.parse(row.cacheKey) as unknown[];
        } catch {
          continue;
        }
        if (!Array.isArray(key) || !persistable(key)) continue;
        const list = byUser.get(row.userId) ?? [];
        list.push({ k: key, d: data, t: row.fetchedAt });
        byUser.set(row.userId, list);
      }
      for (const [userId, q] of byUser) {
        try {
          localStorage.setItem(
            CACHE_PREFIX + userId,
            JSON.stringify({ v: CACHE_VERSION, q } satisfies DiskSnapshot),
          );
        } catch {
          // Webview storage unavailable: the app still reads straight from the
          // network, it just loses the instant start.
        }
      }

      const queued = new Map<string, QueuedSale[]>();
      for (const row of outbox) {
        let sale: QueuedSale;
        try {
          sale = JSON.parse(row.entry) as QueuedSale;
        } catch {
          continue;
        }
        if (!sale?.ref) continue;
        const list = queued.get(row.userId) ?? [];
        list.push(sale);
        queued.set(row.userId, list);
      }
      for (const [userId, fromDisk] of queued) {
        const merged = new Map<string, QueuedSale>();
        for (const sale of [...loadQueue(userId), ...fromDisk]) merged.set(sale.ref, sale);
        try {
          localStorage.setItem(
            QUEUE_PREFIX + userId,
            JSON.stringify([...merged.values()].sort((a, b) => a.at.localeCompare(b.at))),
          );
        } catch {
          // A full disk keeps the in-memory queue authoritative for this run.
        }
      }
    } catch (e) {
      console.warn("storq: could not restore the local database", e);
    } finally {
      booted = true;
    }
  })();
  return bootPromise;
}

/** Mirror one account's cache snapshot. Debounced: a screenful of queries is one write. */
function mirrorCache(userId: string, entries: CacheEntry[]) {
  if (!booted) return;
  queueMirror(userId, entries);
}

let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
let mirrorPending = new Map<string, CacheEntry[]>();

function queueMirror(userId: string, entries: CacheEntry[]) {
  mirrorPending.set(userId, entries);
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    const batch = mirrorPending;
    mirrorPending = new Map();
    for (const [user, rows] of batch) {
      void desktopInvoke("cache_replace", { userId: user, entries: rows }).catch((e) =>
        console.warn("storq: cache mirror failed", e),
      );
    }
  }, 1500);
}

/** Mirror one account's outbox. Immediate: this is money already taken. */
function mirrorQueue(userId: string, queue: QueuedSale[]) {
  if (!booted) return;
  void desktopInvoke("outbox_replace", {
    userId,
    entries: queue.map((sale) => JSON.stringify(sale)),
  }).catch((e) => console.warn("storq: outbox mirror failed", e));
}

// ── instant-start snapshot ─────────────────────────────────────────────────────

export function hydrateCache(qc: QueryClient, userId: string) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return;
    const snap = JSON.parse(raw) as DiskSnapshot;
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
    const rows = qc
      .getQueryCache()
      .findAll()
      .filter(
        (x) =>
          x.state.status === "success" && x.state.data !== undefined && persistable(x.queryKey),
      )
      .map((x) => ({ k: x.queryKey as unknown[], d: x.state.data, t: x.state.dataUpdatedAt }));
    try {
      localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify({ v: CACHE_VERSION, q: rows }));
    } catch {
      /* storage full: skip, the app still works online */
    }
    mirrorCache(
      userId,
      rows.map((row) => ({
        cacheKey: JSON.stringify(row.k),
        data: JSON.stringify(row.d),
        fetchedAt: row.t,
      })),
    );
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
  // The queue is deliberately left alone: a sale taken offline must still file
  // itself after the next person signs in. Only the catalogue is wiped.
  if (isDesktop()) {
    void desktopInvoke("cache_clear").catch((e) => console.warn("storq: cache clear failed", e));
  }
}

// ── offline sales queue ────────────────────────────────────────────────────────

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
export const saveQueue = (userId: string, q: QueuedSale[]): boolean => {
  try {
    if (q.length) localStorage.setItem(QUEUE_PREFIX + userId, JSON.stringify(q));
    else localStorage.removeItem(QUEUE_PREFIX + userId);
  } catch {
    // A full disk (or a browser in private mode) must not swallow a sale: the
    // caller refuses it and tells the cashier to reconnect instead of showing a
    // receipt for money the device cannot remember.
    return false;
  }
  mirrorQueue(userId, q);
  return true;
};

export const isNetworkError = (m: string) =>
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(m);

export const newRef = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
      );
