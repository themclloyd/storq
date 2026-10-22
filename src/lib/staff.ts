import { supabase } from "@/integrations/supabase/client";

/**
 * One person on the roster, as the screens read them.
 *
 * `permissions` is the raw list the database stores: a change key for each area
 * the person may act in, and a `view_*` key only where they may not.
 */
export type StaffRow = {
  id: string;
  name: string;
  store_id: string | null;
  active: boolean;
  is_owner: boolean;
  permissions: string[];
};

/** A person being edited; a new one has no id yet. */
export type StaffDraft = Omit<StaffRow, "id" | "is_owner" | "store_id" | "active"> & {
  id?: string;
  store_id?: string | null;
  active?: boolean;
  is_owner?: boolean;
};

/** The roster is one small read shared by the list and the person screens. */
export const staffQuery = {
  queryKey: ["staff"],
  // Roster changes only through these screens, which wipe the cache on save;
  // a long staleTime keeps it resident instead of re-pulling on every mount.
  staleTime: 300_000,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("staff")
      .select("id,name,store_id,active,is_owner,permissions")
      .order("is_owner", { ascending: false })
      .order("created_at");
    if (error) throw error;
    return data as StaffRow[];
  },
};
