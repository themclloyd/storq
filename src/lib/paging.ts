/** One page of a list screen. Kept small so tills and phones scroll less. */
export const LIST_PAGE_SIZE = 10;

/**
 * Slice `rows` for `page` and clamp the page index when filters shrink the
 * list, so a stale page never renders an empty table.
 */
export function pageSlice<T>(rows: T[], page: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  return {
    pageCount,
    page: current,
    rows: rows.slice(current * LIST_PAGE_SIZE, current * LIST_PAGE_SIZE + LIST_PAGE_SIZE),
  };
}
