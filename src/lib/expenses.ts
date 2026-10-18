import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "@/lib/trend";

export type Expense = {
  id: string;
  store_id: string;
  amount: number;
  category: string;
  source: "till" | "bank" | "mobile";
  note: string | null;
  spent_on: string;
  created_by: string | null;
  created_at: string;
};

export const expenseCategories = [
  "Stock / Supplier",
  "Rent",
  "Power & Fuel",
  "Transport",
  "Wages",
  "Airtime & Data",
  "Maintenance",
  "Cleaning",
  "Food & Refreshments",
  "Other",
];
export const sourceLabel: Record<Expense["source"], string> = {
  till: "Cash from till",
  bank: "Bank / Card",
  mobile: "Mobile money",
};

export function useExpenses(filter: { storeId?: string | undefined; since?: string }) {
  return useQuery({
    queryKey: ["expenses", filter],
    // Expense create/delete invalidate the ["expenses"] prefix from this
    // screen; a short floor keeps the list resident across remounts instead of
    // re-pulling up to 1000 rows every time the user navigates back.
    staleTime: 60_000,
    queryFn: async () => {
      // expenses reads via any-cast (source column predates type regeneration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from as any)("expenses")
        .select("*")
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (filter.storeId) q = q.eq("store_id", filter.storeId);
      // `spent_on` is a bare date column, so the period start has to be compared as a local
      // calendar day — slicing the UTC ISO string shifts the day for offsets ahead of GMT.
      if (filter.since) q = q.gte("spent_on", localDateKey(filter.since));
      const { data, error } = await q;
      if (error) throw error;
      return data as Expense[];
    },
  });
}

/** Start-of-period ISO date for a range key. */
export const rangeDays = { today: 0, "7 days": 7, "30 days": 30, "90 days": 90 } as const;
export function sinceFor(r: keyof typeof rangeDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - rangeDays[r]);
  return d.toISOString();
}

// ---- export helper (lazy — called only on button click) ----
export async function fetchExpensesForExport(filter: {
  storeId?: string | undefined;
  since: string;
}): Promise<Expense[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from as any)("expenses")
    .select("*")
    .gte("spent_on", localDateKey(filter.since))
    .order("spent_on", { ascending: false })
    .limit(50_000);
  if (filter.storeId) q = q.eq("store_id", filter.storeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Expense[];
}
