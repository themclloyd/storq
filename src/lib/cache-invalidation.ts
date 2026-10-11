import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Cache keys that any money-or-stock movement changes: sales lists and
 * detail, the gated cost maps, store stock, the immutable stock ledger, the
 * live till summary and the dashboard alert feed. Route writes invalidate
 * these instead of nuking the whole cache, so completing a sale never re-pulls
 * the catalog, expenses or subscription. (The keyless invalidateQueries stays
 * only in lock/unlock and auth events, where wiping everything is the point.)
 */
export const SALE_TOUCHED: readonly QueryKey[] = [
  ["sales"],
  ["sales-page"],
  ["sales-summary"],
  ["sale"],
  ["sale-item-costs"],
  ["stock"],
  ["movements"],
  ["shift-summary"],
  ["dash-alerts"],
];

/** Invalidate each key prefix as its own query — TanStack batches them. */
export function invalidateKeys(qc: QueryClient, keys: readonly QueryKey[]) {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}
