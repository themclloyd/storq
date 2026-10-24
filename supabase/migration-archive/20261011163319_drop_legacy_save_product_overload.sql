-- ============================================================================
-- Drop the stale 8-argument app.save_product that the security hardening pass
-- left behind. retail_operations replaced it with a 9-argument version (adds
-- p_reorder_point) and swapped the public forwarder, but never removed the old
-- app body, so two overloads stayed live.
--
-- Why that is a bug, not just clutter: PostgREST resolves /rpc/save_product by
-- the keys the client sends. A call that omits p_reorder_point (CSV import, till
-- quick-add) matches both overloads — the 8-argument one exactly and the
-- 9-argument one through its DEFAULT — so the request cannot be resolved to a
-- single function. The stale path would also have written the row without ever
-- touching reorder_point.
--
-- The 9-argument function covers every call on its own: p_reorder_point defaults
-- to NULL, which is exactly "no reorder point set". Grants do not change here —
-- the survivor was already granted to authenticated (via the public forwarder)
-- and service_role by the function-privilege sweep.
-- ============================================================================

DROP FUNCTION IF EXISTS app.save_product(uuid, uuid, text, text, text, numeric, numeric, boolean);
