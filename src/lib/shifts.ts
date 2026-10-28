import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** The store's open drawer, created server-side by the first sale of a session. */
export type OpenDrawer = {
  id: string;
  store_id: string;
  opened_by: string | null;
  opened_at: string;
  opening_float: number;
};

/**
 * Drawer state for the shell chip and the drawer screen. The server opens the
 * drawer with the first money movement of a PIN session (app.attach_drawer), so
 * this is a plain read, nothing here has to remember to start it.
 */
export function useOpenDrawer(storeId?: string | null) {
  return useQuery({
    queryKey: ["drawer", storeId],
    enabled: !!storeId,
    staleTime: 60_000,
    queryFn: async () => {
      // cash_shifts predates type regeneration, read via any-cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("cash_shifts")
        .select("id,store_id,opened_by,opened_at,opening_float")
        .eq("store_id", storeId!)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as OpenDrawer | null;
    },
  });
}
