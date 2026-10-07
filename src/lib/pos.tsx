import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "manager" | "cashier";
export type StaffSession = { token: string; id: string; name: string; role: Role; store_id: string | null };
export type Store = { id: string; name: string; store_type: "direct" | "approval" };
export type Business = { id: string; name: string; currency: string; tax_rate: number; tax_inclusive: boolean };

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
      if (raw) setStaff(JSON.parse(raw));
      setStoreIdState(localStorage.getItem(storeKey));
    } catch {}
  }, [staffKey, storeKey]);

  const businessQ = useQuery({
    queryKey: ["business", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("businesses").select("id,name,currency,tax_rate,tax_inclusive").maybeSingle();
      if (error) throw error;
      return data as Business | null;
    },
  });
  const storesQ = useQuery({
    queryKey: ["stores", businessQ.data?.id],
    enabled: !!businessQ.data,
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("id,name,store_type").order("created_at");
      if (error) throw error;
      return data as Store[];
    },
  });
  const stores = storesQ.data ?? [];

  const effectiveStoreId =
    staff?.role === "cashier" && staff.store_id ? staff.store_id : storeId;
  const store = stores.find((s) => s.id === effectiveStoreId) ?? stores[0] ?? null;

  const setStoreId = (id: string) => {
    setStoreIdState(id);
    localStorage.setItem(storeKey, id);
  };

  const clearStaff = useCallback(() => {
    localStorage.removeItem(staffKey);
    setStaff(null);
  }, [staffKey]);

  const unlock = async (pin: string) => {
    const { data, error } = await (supabase.rpc as any)("unlock_with_pin", { p_pin: pin });
    if (error) throw new Error(error.message);
    localStorage.setItem(staffKey, JSON.stringify(data));
    setStaff(data as StaffSession);
  };

  const lock = async () => {
    if (staff) await (supabase.rpc as any)("lock_session", { p_token: staff.token });
    clearStaff();
  };

  const rpc = async <T,>(fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await (supabase.rpc as any)(fn, { p_token: staff?.token, ...args });
    if (error) {
      if (/Locked/i.test(error.message)) clearStaff();
      throw new Error(error.message);
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

export const roleLabel: Record<Role, string> = { admin: "Admin", manager: "Manager / Approver", cashier: "Cashier" };
