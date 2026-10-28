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
  ["refunds"],
  ["stock"],
  ["movements"],
  // A sale can open the drawer server-side (app.attach_drawer) and always
  // changes its expected cash, so both drawer views have to re-read.
  ["drawer"],
  ["shifts"],
  ["shift-summary"],
  ["dash-alerts"],
  // The shell's live approvals badge, a sent invoice or a review updates it
  // immediately on this device instead of waiting for the next poll.
  ["pending-approvals"],
];

/** Invalidate each key prefix as its own query, TanStack batches them. */
export function invalidateKeys(qc: QueryClient, keys: readonly QueryKey[]) {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
}
