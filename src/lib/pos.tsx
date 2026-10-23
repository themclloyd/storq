import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { validatePin } from "@/lib/validate";
import { SALE_TOUCHED, invalidateKeys } from "@/lib/cache-invalidation";
import {
  hydrateCache,
  isNetworkError,
  loadQueue,
  newRef,
  persistCache,
  saveQueue,
  type QueuedSale,
  isRoleScoped,
} from "@/lib/offline";
import { formatCompactMoney, formatMoney } from "@/lib/format";
import { getDeviceId, staffStorageKey } from "@/lib/staff-session";
import { useIdleLock } from "@/components/pos/use-idle-lock";
import { t, useI18n } from "@/lib/i18n";
import { permits, toPermissions, type Access, type Permission } from "@/lib/permissions";
import { sortPaymentMethods } from "@/lib/payment-methods";

export type CheckoutResult = {
  id: string;
  number: number;
  status: string;
  total: number;
  tax: number;
  offline?: boolean;
};

/**
 * Why a PIN entry did not open a session. Wrong PINs are counted server-side
 * (`pin_throttle`), and a throttled answer carries the seconds still to wait;
 * both come back as a value, never as a thrown error, so the counter commits.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; code: "wrong_pin"; attemptsLeft: number }
  | { ok: false; code: "throttled"; retryAfter: number };
/**
 * Who this device is unlocked as: the PIN session token plus the access the
 * database grants that person. `store_id` binds them to one location.
 */
export type StaffSession = Access & {
  token: string;
  id: string;
  name: string;
  store_id: string | null;
  expires_at?: string;
};
export type Store = {
  id: string;
  name: string;
  store_type: "direct" | "approval";
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  tax_rate: number;
  tax_inclusive: boolean;
};
export type Business = {
  id: string;
  name: string;
  currency: string;
  tax_rate: number;
  tax_inclusive: boolean;
};

type PosCtx = {
  userId: string;
  business: Business | null | undefined;
  stores: Store[];
  store: Store | null;
  setStoreId: (id: string) => void;
  staff: StaffSession | null;
  unlock: (pin: string) => Promise<UnlockResult>;
  lock: () => Promise<void>;
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  money: (n: number | string | null | undefined) => string;
  /** Compact chart-axis label (`40k`, `−20k`); currency symbol omitted. */
  compactMoney: (n: number | string | null | undefined) => string;
  /** Configured currency symbol (e.g. "MWK", "R"), or null before the business loads. */
  currency: string | null;
  /** Payment methods this location accepts, catalogue order; cash is always here. */
  paymentMethods: string[];
  /** Methods a location accepts (invoice/refund dialogs act on another store). */
  paymentMethodsFor: (storeId: string | null | undefined) => string[];
  /** True when the signed-in person holds any of these grants (the owner: always). */
  can: (...perms: Permission[]) => boolean;
  refresh: () => void;
  /** Sale checkout that queues direct-store cash/card/mobile sales on this device when offline. */
  checkout: (
    args: Record<string, unknown>,
    opts: { offlineOk: boolean; estTotal: number },
  ) => Promise<CheckoutResult>;
  online: boolean;
  queue: QueuedSale[];
  syncQueue: () => Promise<void>;
  dropQueued: (ref: string) => void;
  /** Till-hygiene: lock the workspace after this many idle minutes (0 = off). */
  autoLockMinutes: number;
  setAutoLockMinutes: (n: number) => void;
};

const Ctx = createContext<PosCtx | null>(null);

/**
 * The server throws controlled business messages ("Only 4 left in stock", etc.).
 * Anything carrying SQL internals — relation names, columns, policy text — is
 * replaced by a generic message so a raw Postgres error never reaches the UI.
 */
function maskRpcError(raw: string): string {
  if (/new row violates row-level security policy/i.test(raw)) return t("errors.noAccess");
  if (
    /permission denied|duplicate key|constraint|does not exist|syntax error|violates check|function .* does not exist|null value in column/i.test(
      raw,
    )
  )
    return t("errors.generic");
  if (/\b(?:public|extensions|pg_.+)\.[a-z_]+|relation "|column "|table "/i.test(raw))
    return t("errors.generic");
  return raw.length > 240 ? t("errors.generic") : raw;
}

// Shared POS context module: provider + hook + helpers are intentionally
// co-located (see project rules); fast-refresh advisory only.
// eslint-disable-next-line react-refresh/only-export-components
export function usePos() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePos outside provider");
  return c;
}

export function PosProvider({ userId, children }: { userId: string; children: ReactNode }) {
  useI18n(); // Subscribe so the offline banner re-localizes when the language changes.
  const qc = useQueryClient();
  const staffKey = staffStorageKey(userId);
  const storeKey = `pos-store-${userId}`;
  const autoLockKey = `pos-autolock-${userId}`;
  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [storeId, setStoreIdState] = useState<string | null>(null);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(5);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(staffKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StaffSession;
        // A stale token is worse than no token. Sessions written before the
        // access model carry a role but no grants, so every screen would be
        // refused; drop them and let the PIN pad mint a fresh session.
        if (
          parsed?.token &&
          parsed.expires_at &&
          new Date(parsed.expires_at) > new Date() &&
          Array.isArray(parsed.permissions)
        ) {
          setStaff({ ...parsed, permissions: toPermissions(parsed.permissions) });
        } else {
          localStorage.removeItem(staffKey);
        }
      }
      setStoreIdState(localStorage.getItem(storeKey));
      const al = Number(localStorage.getItem(autoLockKey));
      if (Number.isFinite(al) && al >= 0) setAutoLockMinutesState(al);
    } catch {
      // Unreadable storage just means a fresh lock — no user-facing failure.
    }
  }, [staffKey, storeKey, autoLockKey]);

  const businessQ = useQuery({
    queryKey: ["business", userId],
    // Businesses and stores are near-static during a trading session; they
    // change only through the settings screens, which invalidate explicitly.
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id,name,currency,tax_rate,tax_inclusive")
        .maybeSingle();
      if (error) throw error;
      return data as Business | null;
    },
  });
  // Keyed on the login, not the business id, so it loads in parallel with the
  // business row instead of waiting for it (RLS already scopes to the tenant).
  const storesQ = useQuery({
    queryKey: ["stores", userId],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id,name,store_type,phone,email,address,tax_number,tax_rate,tax_inclusive")
        .order("created_at");
      if (error) throw error;
      return data as Store[];
    },
  });
  const stores = storesQ.data ?? [];

  // Each location keeps its own methods. One small read covers the tenant so
  // invoice/refund dialogs can ask for the store they belong to; it is cached
  // like the rest of the reference data so an offline till still knows its list.
  const methodsQ = useQuery({
    queryKey: ["store-payment-methods", userId],
    staleTime: 300_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("store_payment_methods")
        .select("store_id,code")
        .order("code");
      if (error) throw error;
      return (data ?? []) as { store_id: string; code: string }[];
    },
  });
  const methodsByStore = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of methodsQ.data ?? []) (map[row.store_id] ??= []).push(row.code);
    for (const key of Object.keys(map)) map[key] = sortPaymentMethods(["cash", ...map[key]!]);
    return map;
  }, [methodsQ.data]);
  const paymentMethodsFor = (id: string | null | undefined) =>
    (id ? methodsByStore[id] : undefined) ?? ["cash"];

  // An assigned location binds whoever holds it, not only the old cashier tier.
  const effectiveStoreId = staff?.store_id ?? storeId;
  const store = stores.find((s) => s.id === effectiveStoreId) ?? stores[0] ?? null;
  const paymentMethods = paymentMethodsFor(store?.id);

  const setStoreId = (id: string) => {
    setStoreIdState(id);
    localStorage.setItem(storeKey, id);
  };

  // Locking, expiry and role changes must never leave the previous user's
  // cached rows readable by the next person on this device.
  // Shared reference data (catalog, stores, subscription) stays warm.
  const clearStaff = useCallback(() => {
    localStorage.removeItem(staffKey);
    setStaff(null);
    qc.removeQueries({ predicate: (q) => isRoleScoped(q.queryKey) });
  }, [staffKey, qc]);

  const unlock = async (pin: string): Promise<UnlockResult> => {
    const pinErr = validatePin(pin);
    if (pinErr) throw new Error(pinErr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("unlock_with_pin", {
      p_pin: pin,
      p_device_id: getDeviceId(),
    });
    if (error) throw new Error(maskRpcError(error.message));
    const res = (data ?? {}) as Record<string, unknown>;
    // `ok:false` is a counted miss (or the server's lock) rather than an error:
    // raising here would roll the attempt counter back, which is why the old
    // throttle never held. An older server has no `ok` and only returns sessions.
    if (res["ok"] === false) {
      if (res["code"] === "throttled")
        return { ok: false, code: "throttled", retryAfter: Number(res["retry_after"] ?? 900) };
      return { ok: false, code: "wrong_pin", attemptsLeft: Number(res["attempts_left"] ?? 0) };
    }
    const session: StaffSession = {
      token: String(res["token"]),
      id: String(res["id"]),
      name: String(res["name"]),
      owner: res["owner"] === true,
      permissions: toPermissions(res["permissions"]),
      store_id: (res["store_id"] as string | null | undefined) ?? null,
    };
    if (typeof res["expires_at"] === "string") session.expires_at = res["expires_at"];
    localStorage.setItem(staffKey, JSON.stringify(session));
    setStaff(session);
    void qc.invalidateQueries({ predicate: (q) => isRoleScoped(q.queryKey) });
    return { ok: true };
  };

  const lock = async () => {
    if (staff) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.rpc as any)("lock_session", { p_token: staff.token });
      } catch {
        // The session still gets cleared locally; the server token expires by itself.
      }
    }
    clearStaff();
  };

  const lockRef = useRef(lock);
  lockRef.current = lock;

  // An expired PIN session is not a readable one: the pad's token is what RLS
  // resolves the reader from, so once it lapses every read is refused. Drop back
  // to the PIN pad at that moment instead of leaving a screen that cannot load.
  useEffect(() => {
    if (!staff?.expires_at) return;
    const ms = new Date(staff.expires_at).getTime() - Date.now();
    if (ms <= 0) {
      clearStaff();
      return;
    }
    // setTimeout cannot hold a delay longer than a signed 32-bit int.
    const id = setTimeout(() => void lockRef.current(), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [staff?.expires_at, clearStaff]);

  const rpc = async <T,>(fn: string, args: Record<string, unknown> = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(fn, { p_token: staff?.token, ...args });
    if (error) {
      if (/Locked/i.test(error.message)) clearStaff();
      throw new Error(maskRpcError(error.message));
    }
    return data as T;
  };

  const currency = businessQ.data?.currency ?? "MWK";
  // Single shared money format (spec §1): comma thousands, decimals only when
  // fractional, real minus before the symbol for negatives (e.g. "−MK41,400").
  const money = useMemo(
    () => (n: number | string | null | undefined) => formatMoney(currency, n),
    [currency],
  );
  const compactMoney = useMemo(
    () => (n: number | string | null | undefined) => formatCompactMoney(n),
    [],
  );

  // ---- instant start: show last known catalog/stock immediately, refresh behind ----
  useState(() => {
    if (typeof window !== "undefined") hydrateCache(qc, userId);
    return 0;
  });
  useEffect(() => persistCache(qc, userId), [qc, userId]);

  // ---- offline sales queue ----
  const [online, setOnline] = useState(true);
  const [queue, setQueueState] = useState<QueuedSale[]>([]);
  useEffect(() => {
    setOnline(navigator.onLine);
    setQueueState(loadQueue(userId));
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [userId]);
  const setQueue = useCallback(
    (f: (q: QueuedSale[]) => QueuedSale[]) => {
      setQueueState((prev) => {
        const n = f(prev);
        saveQueue(userId, n);
        return n;
      });
    },
    [userId],
  );

  const checkout = async (
    args: Record<string, unknown>,
    opts: { offlineOk: boolean; estTotal: number },
  ): Promise<CheckoutResult> => {
    const ref = newRef();
    // The queue is the record of money already taken, so it is persisted before
    // the sale is reported back. Read the stored list rather than React state:
    // this must not depend on a pending render, and a full disk has to surface
    // as a refusal instead of a sale that silently vanishes on reload.
    const enqueue = () => {
      const entry: QueuedSale = {
        ref,
        at: new Date().toISOString(),
        total: opts.estTotal,
        storeId: String(args["p_store"]),
        args,
      };
      const next = [...loadQueue(userId), entry];
      if (!saveQueue(userId, next)) throw new Error(t("offline.storageFull"));
      setQueueState(next);
      return {
        id: ref,
        number: 0,
        status: "completed",
        total: opts.estTotal,
        tax: 0,
        offline: true,
      };
    };
    if (opts.offlineOk && typeof navigator !== "undefined" && !navigator.onLine) return enqueue();
    try {
      return await rpc<CheckoutResult>("checkout_ref", { p_client_ref: ref, ...args });
    } catch (e) {
      if (opts.offlineOk && isNetworkError((e as Error).message)) return enqueue();
      throw e;
    }
  };

  const syncing = useRef(false);
  const syncQueue = useCallback(async () => {
    if (syncing.current || !staff || !navigator.onLine) return;
    const pending = loadQueue(userId).filter((x) => !x.error);
    if (!pending.length) return;
    syncing.current = true;
    let synced = 0;
    try {
      for (const item of pending) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)("checkout_ref", {
          p_token: staff.token,
          p_client_ref: item.ref,
          // The moment the sale was rung up, so it lands in that day's takings
          // and in the drawer that was open then, not at sync time.
          p_occurred_at: item.at,
          ...item.args,
        });
        if (error) {
          if (isNetworkError(error.message) || /Locked/i.test(error.message)) break;
          setQueue((q) =>
            q.map((x) => (x.ref === item.ref ? { ...x, error: maskRpcError(error.message) } : x)),
          );
        } else {
          synced++;
          setQueue((q) => q.filter((x) => x.ref !== item.ref));
        }
      }
    } finally {
      syncing.current = false;
      if (synced) invalidateKeys(qc, SALE_TOUCHED);
    }
  }, [staff, userId, qc, setQueue]);

  useEffect(() => {
    if (!online || !staff || queue.every((x) => x.error)) return;
    void syncQueue();
    const t = setInterval(() => void syncQueue(), 30_000);
    return () => clearInterval(t);
  }, [online, staff, queue, syncQueue]);

  // ---- till hygiene: inactivity auto-lock ----
  const setAutoLockMinutes = useCallback(
    (n: number) => {
      const v = Math.max(0, Math.min(240, Math.round(n)));
      setAutoLockMinutesState(v);
      try {
        localStorage.setItem(autoLockKey, String(v));
      } catch {
        // Storage unavailable: the in-memory value still governs this session.
      }
    },
    [autoLockKey],
  );
  useIdleLock(() => void lockRef.current(), {
    enabled: !!staff,
    minutes: autoLockMinutes,
    paused: syncing.current,
  });

  const value: PosCtx = {
    checkout,
    online,
    queue,
    syncQueue,
    dropQueued: (ref) => setQueue((q) => q.filter((x) => x.ref !== ref)),
    autoLockMinutes,
    setAutoLockMinutes,
    userId,
    business: businessQ.isLoading ? undefined : (businessQ.data ?? null),
    stores,
    store,
    setStoreId,
    staff,
    unlock,
    lock,
    rpc,
    money,
    compactMoney,
    currency,
    paymentMethods,
    paymentMethodsFor,
    can: (...perms) => !!staff && permits(staff, perms),
    refresh: () => qc.invalidateQueries(),
  };
  const failed = queue.filter((x) => x.error);
  const banner =
    !online || queue.length ? (
      <div
        role="status"
        className="fixed bottom-3 left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border bg-card px-4 py-2 text-xs font-medium"
      >
        <span className={online ? "text-foreground" : "text-destructive"}>
          {online ? t("offline.online") : t("offline.offlineSaved")}
        </span>
        {queue.length - failed.length > 0 && (
          <span className="text-muted-foreground">
            · {t("offline.waitingToSync", { count: queue.length - failed.length })}
            {!staff ? t("offline.unlockToSync") : ""}
          </span>
        )}
        {online && staff && queue.length - failed.length > 0 && (
          <button className="underline" onClick={() => void syncQueue()}>
            {t("offline.syncNow")}
          </button>
        )}
        {failed.map((f) => (
          <span key={f.ref} className="text-destructive">
            · {t("offline.notRecorded", { amount: money(f.total) })} {f.error}{" "}
            <button
              className="underline"
              onClick={() =>
                setQueue((q) => q.map((x) => (x.ref === f.ref ? { ...x, error: undefined } : x)))
              }
            >
              {t("offline.retry")}
            </button>{" "}
            <button
              className="underline"
              onClick={() => {
                if (confirm(t("offline.discardConfirm")))
                  setQueue((q) => q.filter((x) => x.ref !== f.ref));
              }}
            >
              {t("offline.discard")}
            </button>
          </span>
        ))}
      </div>
    ) : null;
  return (
    <Ctx.Provider value={value}>
      {children}
      {banner}
    </Ctx.Provider>
  );
}
