# Project rules
- All writes go through Postgres SECURITY DEFINER RPCs that take a staff session token (`p_token`) and check role via `require_staff`; tables are read-only via RLS. Why: one shared business login per device, so staff role must be verified server-side from the PIN session, not the client.
- Business logic for store types (direct vs approval), layby and stock movement lives in SQL functions (`checkout`, `review_invoice`, `layby_pay`, etc.). Why: keeps stock and payments consistent across devices.
- Shared data hooks live in `src/lib/` (pos.tsx context, products.ts, sales.ts), never exported from route files. Why: route modules are code-split.
