-- ============================================================================
-- Platform operator console — v1: cross-tenant roster (read-only)
--
-- Every read policy here is `business_id = my_business_id()` and every write RPC
-- demands a staff PIN session, so Storq cannot see its own tenants: there is no
-- way to list businesses, tell how much trial runway one has left, or find the
-- store a customer is locked out of. This adds that surface.
--
-- Operators are deliberately NOT staff. An operator signs in as their own
-- Supabase user, holds no business row and no store access, and is checked by
-- require_platform_admin(), which mirrors require_staff's shape exactly:
-- identity resolved server-side from the JWT subject, the allowed roles supplied
-- by the caller, and a RAISE instead of a NULL on failure so a caller can never
-- forget the check and receive an empty-but-successful result. The rule that the
-- database decides what a session may see still holds; only the principal differs.
--
-- v1 is a roster and nothing else. No subscription mutation lives here — capacity
-- and expiry stay inside the existing payment flow. Granting an operator is a
-- hand-run service-role insert (see the bootstrap note at the bottom) so a
-- compromised console can never mint its own access.
-- ============================================================================

-- ---------- 1. Operator registry -------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  role text NOT NULL DEFAULT 'support' CHECK (role IN ('support', 'billing', 'owner')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_admins IS 'Cross-tenant platform operators. Separate namespace from staff: an operator is never a business member.';

GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- An operator may read only their own row. Cross-tenant visibility is granted
-- inside the definer roster function below, never by opening this table up.
CREATE POLICY "own operator row" ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- ---------- 2. Operator identity -------------------------------------------
-- Client-safe: NULL for an ordinary customer, which is all the sign-in page
-- needs to decide where to send a session. `active` is part of the match, so a
-- revoked operator stops resolving immediately rather than at token expiry.
CREATE OR REPLACE FUNCTION public.my_platform_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.platform_admins
   WHERE user_id = (select auth.uid()) AND active
$$;

-- Guard. Internal only (revoked below), exactly like require_staff.
CREATE OR REPLACE FUNCTION public.require_platform_admin(p_roles text[]) RETURNS public.platform_admins
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pa public.platform_admins;
BEGIN
  SELECT * INTO pa FROM public.platform_admins
   WHERE user_id = (select auth.uid()) AND active;
  IF pa.id IS NULL THEN RAISE EXCEPTION 'Not a platform operator'; END IF;
  IF NOT (pa.role = any(p_roles)) THEN
    RAISE EXCEPTION 'Your operator role (%) is not allowed to do this', pa.role;
  END IF;
  RETURN pa;
END $$;

-- ---------- 3. Cross-tenant roster -----------------------------------------
-- One call returns the page plus the filtered total, so the console never pulls
-- every tenant just to render "of N". The per-tenant aggregates are correlated
-- subqueries over existing FK indexes (stores/staff/sales by business_id, and
-- sales_business_created_idx serves the last-sale lookup), and the work is
-- bounded by p_limit. Owner email comes from auth.users, which only a definer
-- function running as the schema owner can read — that is why this is an RPC and
-- not a view granted to `authenticated`.
--
-- `state` is derived once and then filtered, so the badge a row shows and the
-- filter that selected it can never disagree.
CREATE OR REPLACE FUNCTION public.ops_business_roster(
  p_q text,
  p_state text,
  p_limit integer,
  p_offset integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE term text; page_rows jsonb; page_total bigint;
BEGIN
  PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);

  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Page size must be between 1 and 100';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid roster page offset';
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('all', 'trial', 'active', 'expired', 'over_capacity') THEN
    RAISE EXCEPTION 'Unknown roster filter';
  END IF;
  IF p_q IS NOT NULL AND char_length(btrim(p_q)) > 120 THEN
    RAISE EXCEPTION 'Search is too long (max 120 characters)';
  END IF;
  -- Substring match, case-folded. `%`/`_` stay LIKE wildcards on purpose: this is
  -- an internal console, and a typed `MWK%` is a useful search, not an injection.
  term := nullif(lower(btrim(coalesce(p_q, ''))), '');

  SELECT coalesce(jsonb_agg(obj ORDER BY rn), '[]'::jsonb), coalesce(max(tt), 0)
    INTO page_rows, page_total
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY CASE scoped.state
                   WHEN 'over_capacity' THEN 0
                   WHEN 'expired' THEN 1
                   WHEN 'trial' THEN 2
                   ELSE 3
                 END,
                 scoped.name
      ) AS rn,
      -- Window count runs before LIMIT, so this is the filtered total.
      count(*) OVER () AS tt,
      jsonb_build_object(
        'id', scoped.id,
        'name', scoped.name,
        'currency', scoped.currency,
        'owner_email', scoped.owner_email,
        'store_count', scoped.store_count,
        'staff_count', scoped.staff_count,
        'plan', scoped.plan,
        'paid_store_limit', scoped.paid_store_limit,
        'paid_until', scoped.paid_until,
        'trial_ends_at', scoped.trial_ends_at,
        'state', scoped.state,
        'last_sale_at', scoped.last_sale_at,
        'created_at', scoped.created_at
      ) AS obj
    FROM (
      SELECT base.*,
             CASE
               WHEN base.paid_until > now() AND base.paid_store_limit >= base.store_count THEN 'active'
               -- Covered by a payment but holding more stores than paid for:
               -- exactly the condition subscription_active() refuses writes on.
               WHEN base.paid_until > now() THEN 'over_capacity'
               WHEN base.trial_ends_at > now() THEN 'trial'
               ELSE 'expired'
             END AS state
      FROM (
        SELECT b.id, b.name, b.currency, b.created_at,
               u.email AS owner_email,
               s.trial_ends_at, s.paid_until, s.plan, s.paid_store_limit,
               (SELECT count(*) FROM public.stores x WHERE x.business_id = b.id) AS store_count,
               (SELECT count(*) FROM public.staff x WHERE x.business_id = b.id AND x.active) AS staff_count,
               (SELECT max(y.created_at) FROM public.sales y WHERE y.business_id = b.id) AS last_sale_at
        FROM public.businesses b
        JOIN public.subscriptions s ON s.business_id = b.id
        LEFT JOIN auth.users u ON u.id = b.owner_id
      ) base
      WHERE term IS NULL
         OR lower(base.name) LIKE '%' || term || '%'
         OR lower(coalesce(base.owner_email, '')) LIKE '%' || term || '%'
         OR EXISTS (
           SELECT 1 FROM public.stores z
            WHERE z.business_id = base.id AND lower(z.name) LIKE '%' || term || '%'
         )
    ) scoped
    WHERE p_state = 'all' OR scoped.state = p_state
    ORDER BY rn
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('rows', page_rows, 'total', page_total);
END $$;

-- ---------- 4. Execute grants ----------------------------------------------
-- my_platform_role is public-to-authenticated because the sign-in flow must be
-- able to ask it. The guard stays internal (same treatment as require_staff),
-- so a client cannot probe which roles a function would accept. The roster is
-- callable by any signed-in principal but raises for non-operators.
REVOKE ALL ON FUNCTION public.my_platform_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_platform_role() TO authenticated;
REVOKE ALL ON FUNCTION public.require_platform_admin(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_business_roster(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_business_roster(text, text, integer, integer) TO authenticated;

-- ---------- 5. Rollback-only guard checks ----------------------------------
-- Same technique as the subscription guard migration: every fixture (the JWT
-- subject, the operator row, the mutated subscription) lives inside one
-- subtransaction that is deliberately aborted at the end, so the checks prove
-- real behaviour and still leave the database untouched.
DO $$
DECLARE b public.businesses; page jsonb; blocked boolean; st text;
BEGIN
  SELECT * INTO b FROM public.businesses LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No tenant available for operator guard checks'; END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', b.owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b.owner_id, 'role', 'authenticated')::text, true);

    -- (a) A customer who is not an operator is refused, and resolves as nobody.
    IF public.my_platform_role() IS NOT NULL THEN
      RAISE EXCEPTION 'A non-operator resolved a platform role';
    END IF;
    blocked := false;
    BEGIN
      PERFORM public.ops_business_roster(NULL, 'all', 10, 0);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Not a platform operator%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Cross-tenant roster was not blocked for a customer'; END IF;

    -- (b) A granted operator reads the roster, including the owner email that
    -- plain `authenticated` can never reach.
    INSERT INTO public.platform_admins(user_id, name) VALUES (b.owner_id, 'Guard check operator');
    IF public.my_platform_role() IS DISTINCT FROM 'support' THEN
      RAISE EXCEPTION 'Operator identity did not resolve';
    END IF;
    page := public.ops_business_roster(NULL, 'all', 10, 0);
    IF (page->>'total')::int < 1 THEN RAISE EXCEPTION 'Roster returned no tenants for an operator'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(page->'rows') r
       WHERE r->>'id' = b.id::text
         AND coalesce(r->>'owner_email', '') <> ''
         AND r->>'state' IN ('trial', 'active', 'expired', 'over_capacity')
    ) THEN RAISE EXCEPTION 'Roster is missing the tenant or its owner email'; END IF;

    -- (c) Over-capacity is derived, not stored: a paid subscription holding more
    -- stores than it paid for must surface as its own state.
    UPDATE public.subscriptions
       SET paid_until = now() + interval '1 month',
           paid_store_limit = greatest(
             (SELECT count(*) FROM public.stores WHERE business_id = b.id) - 1, 0)
     WHERE business_id = b.id;
    SELECT s->>'state' INTO st FROM jsonb_array_elements(public.ops_business_roster(NULL, 'over_capacity', 10, 0)->'rows') s
     WHERE s->>'id' = b.id::text;
    IF st IS DISTINCT FROM 'over_capacity' THEN RAISE EXCEPTION 'Over-capacity tenant was not classified'; END IF;

    -- (d) The state filter and the row badge agree, and bad input is refused.
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.ops_business_roster(b.name, 'all', 10, 0)->'rows') s
       WHERE s->>'id' = b.id::text
    ) THEN RAISE EXCEPTION 'Search by business name did not match its own tenant'; END IF;
    blocked := false;
    BEGIN PERFORM public.ops_business_roster(NULL, 'nonsense', 10, 0);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Unknown roster filter%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Unknown roster filter was accepted'; END IF;
    blocked := false;
    BEGIN PERFORM public.ops_business_roster(NULL, 'all', 5000, 0);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Page size%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Unbounded page size was accepted'; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'operator_guard_checks_passed_rollback';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'operator_guard_checks_passed_rollback' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: customer refused cross-tenant roster; operator reads tenants with owner email; over-capacity derived; filters and page bounds enforced; all fixtures rolled back';
  END;
END $$;

-- ---------- 6. Bootstrap (intentionally manual) ----------------------------
-- The first operator is granted by a human with dashboard/service-role access,
-- never by an RPC, so the console cannot escalate itself:
--
--   insert into public.platform_admins(user_id, name, role)
--   select id, 'Your Name', 'owner' from auth.users where email = 'you@example.com';
--
-- `active = false` revokes access instantly and keeps the audit trail.
