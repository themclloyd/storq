import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { validatePin } from "@/lib/validate";

export type Role = "admin" | "manager" | "cashier";
export type StaffSession = {
  token: string;
  id: string;
  name: string;
  role: Role;
  store_id: string | null;
  expires_at?: string;
};
export type Store = { id: string; name: string; store_type: "direct" | "approval" };
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
  unlock: (pin: string) => Promise<void>;
  lock: () => Promise<void>;
  rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  money: (n: number | string | null | undefined) => string;
  can: (...roles: Role[]) => boolean;
  refresh: () => void;
};

const Ctx = createContext<PosCtx | null>(null);

/**
 * The server throws controlled business messages ("Only 4 left in stock", etc.).
 * Anything carrying SQL internals — relation names, columns, policy text — is
 * replaced by a generic message so a raw Postgres error never reaches the UI.
 */
function maskRpcError(raw: string): string {
  if (/new row violates row-level security policy/i.test(raw))
    return "You do not have access to this data";
  if (
    /permission denied|duplicate key|constraint|does not exist|syntax error|violates check|function .* does not exist|null value in column/i.test(
      raw,
    )
  )
    return "Something went wrong. Please try again.";
  if (/\b(?:public|extensions|pg_.+)\.[a-z_]+|relation "|column "|table "/i.test(raw))
    return "Something went wrong. Please try again.";
  return raw.length > 240 ? "Something went wrong. Please try again." : raw;
}

export function usePos() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePos outside provider");
  return c;
}

export function PosProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const staffKey = `pos-staff-${userId}`;
  const storeKey = `pos-store-${userId}`;
  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [storeId, setStoreIdState] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(staffKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StaffSession;
        // A stale token is worse than no token: drop it once the server expiry passes.
        if (parsed?.token && (!parsed.expires_at || new Date(parsed.expires_at) > new Date())) {
          setStaff(parsed);
        } else {
          localStorage.removeItem(staffKey);
        }
      }
      setStoreIdState(localStorage.getItem(storeKey));
    } catch {
      // Unreadable storage just means a fresh lock — no user-facing failure.
    }
  }, [staffKey, storeKey]);

  const businessQ = useQuery({
    queryKey: ["business", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("id,name,currency,tax_rate,tax_inclusive")
        .maybeSingle();
      if (error) throw error;
      return data as Business | null;
    },
  });
  const storesQ = useQuery({
    queryKey: ["stores", businessQ.data?.id],
    enabled: !!businessQ.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id,name,store_type")
        .order("created_at");
      if (error) throw error;
      return data as Store[];
    },
  });
  const stores = storesQ.data ?? [];

  const effectiveStoreId = staff?.role === "cashier" && staff.store_id ? staff.store_id : storeId;
  const store = stores.find((s) => s.id === effectiveStoreId) ?? stores[0] ?? null;

  const setStoreId = (id: string) => {
    setStoreIdState(id);
    localStorage.setItem(storeKey, id);
  };

  // Locking, expiry and role changes must never leave the previous user's
  // cached rows readable by the next person on this device.
  const clearStaff = useCallback(() => {
    localStorage.removeItem(staffKey);
    setStaff(null);
    void qc.invalidateQueries();
  }, [staffKey, qc]);

  const unlock = async (pin: string) => {
    const pinErr = validatePin(pin);
    if (pinErr) throw new Error(pinErr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("unlock_with_pin", { p_pin: pin });
    if (error) throw new Error(maskRpcError(error.message));
    localStorage.setItem(staffKey, JSON.stringify(data));
    setStaff(data as StaffSession);
    void qc.invalidateQueries();
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

  const rpc = async <T,>(fn: string, args: Record<string, unknown> = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(fn, { p_token: staff?.token, ...args });
    if (error) {
      if (/Locked/i.test(error.message)) clearStaff();
      throw new Error(maskRpcError(error.message));
    }
    return data as T;
  };

  const currency = businessQ.data?.currency ?? "R";
  const money = useMemo(
    () => (n: number | string | null | undefined) =>
      `${currency} ${Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency],
  );

  const value: PosCtx = {
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
    can: (...roles) => !!staff && roles.includes(staff.role),
    refresh: () => qc.invalidateQueries(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const roleLabel: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager / Approver",
  cashier: "Cashier",
};
