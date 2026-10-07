# Project rules
- Scope workspace theme tokens under `.storq-workspace`, leaving public storefront and landing-page tokens independent. Why: retail operations can evolve visually without changing public marketing or shared collections.
- All writes go through Postgres SECURITY DEFINER RPCs that take a staff session token (`p_token`) and check role via `require_staff`; tables are read-only via RLS. Why: one shared business login per device, so staff role must be verified server-side from the PIN session, not the client.
- Business logic for store types (direct vs approval), layby and stock movement lives in SQL functions (`checkout`, `review_invoice`, `layby_pay`, etc.). Why: keeps stock and payments consistent across devices.
- Shared data hooks live in `src/lib/` (pos.tsx context, products.ts, sales.ts), never exported from route files. Why: route modules are code-split.
- Stock quantity changes must go through SQL paths that set a reason (`app.set_ctx`); a trigger on `store_stock` writes the immutable `stock_movements` ledger. Why: every unit of stock must be traceable.
- Refunds live in `refunds`/`refund_items` (never negative payments) and reports subtract them; cash drawer expected cash is computed server-side by `app.shift_summary`. Why: one consistent source for revenue and till variance.
