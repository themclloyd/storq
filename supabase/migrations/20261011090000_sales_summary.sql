-- Sales reporting aggregate.
--
-- The Sales list used to pull up to 1000 sale rows (with their nested items)
-- into the browser and compute the KPI cards there. That both over-loaded the
-- database on every visit and silently truncated the totals once a period had
-- more than 1000 sales. This RPC returns the same headline numbers from a single
-- aggregate pass over the full date range, so the list can page its rows on the
-- server and still show exact totals.
--
-- Mirrors the read-RPC convention: app.* is SECURITY DEFINER and resolves the
-- staff session via require_staff; public.* is a thin wrapper. Tenancy is
-- enforced from the verified staff business_id, never from a client argument.

CREATE OR REPLACE FUNCTION app.sales_summary(p_token uuid, p_store uuid, p_from timestamptz, p_to timestamptz)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  me public.staff;
  r json;
BEGIN
  me := public.require_staff(p_token, array['admin', 'manager', 'cashier']);
  IF p_store IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id
  ) THEN
    RAISE EXCEPTION 'Unknown store';
  END IF;

  SELECT json_build_object(
    -- Net revenue counts completed/layby/refunded sales, net of what was refunded.
    'revenue', coalesce(sum(s.total - s.refunded) FILTER (
        WHERE s.status = ANY (ARRAY['completed', 'layby_completed', 'partially_refunded', 'refunded'])), 0),
    -- Collected is what the till actually took in: everything except awaiting approval / rejected.
    'collected', coalesce(sum(s.paid) FILTER (
        WHERE s.status <> ALL (ARRAY['pending_approval', 'rejected'])), 0),
    'transactions', count(*) FILTER (
        WHERE s.status = ANY (ARRAY['completed', 'layby_completed', 'partially_refunded', 'refunded'])),
    'pending', count(*) FILTER (WHERE s.status = 'pending_approval'),
    -- Refunds live in their own ledger; sum the matching period in one subquery.
    'refunds', coalesce((
      SELECT sum(x.amount) FROM public.refunds x
      WHERE x.business_id = me.business_id
        AND (p_store IS NULL OR x.store_id = p_store)
        AND x.created_at >= p_from AND x.created_at < p_to), 0)
  ) INTO r
  FROM public.sales s
  WHERE s.business_id = me.business_id
    AND (p_store IS NULL OR s.store_id = p_store)
    AND s.created_at >= p_from AND s.created_at < p_to;

  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.sales_summary(p_token uuid, p_store uuid, p_from timestamptz, p_to timestamptz)
RETURNS json
LANGUAGE sql STABLE SET search_path = public
AS $$ SELECT app.sales_summary($1, $2, $3, $4) $$;

-- Lock the RPC surface: only authenticated staff (and service role) may execute.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.sales_summary(uuid,uuid,timestamptz,timestamptz)',
    'public.sales_summary(uuid,uuid,timestamptz,timestamptz)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
