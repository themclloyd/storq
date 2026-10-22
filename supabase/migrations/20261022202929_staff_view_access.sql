-- ============================================================================
-- Seeing is its own grant.
--
-- The owner can open a screen for someone without letting them change it:
-- every area now carries a `view_*` grant beside the action grant it had.
--
--   view_sales      sales history, receipts and laybys, read only
--   view_stock      items, stock levels, transfers, collections, stock takes
--   view_approvals  the invoice queue, read only
--   view_money      reports, costs, profit and the subscription
--   view_staff      the roster, read only
--   view_locations  locations and their VAT details, read only
--
-- An action grant always implies its view grant, so the stored list keeps the
-- view key only where the person cannot act. `app.expand_perms` makes that
-- implication explicit for the escalation check and `app.compact_perms` drops
-- a view key an action grant already covers.
--
-- The write path is unchanged: `app.require_perm` still asks for action grants,
-- so a view-only session cannot call a mutating RPC. What changes is the read
-- tier: a view grant over the back office reaches manager-level reads (refunds,
-- stock movements), which is exactly the data those screens show.
-- ============================================================================

-- ---------- 1. The twelve keys ----------------------------------------------
CREATE OR REPLACE FUNCTION app.all_permissions() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['sell','stock','approvals','money','staff','locations',
               'view_sales','view_stock','view_approvals','view_money',
               'view_staff','view_locations']::text[]
$$;

-- One row per area: the read key and the key that may change it.
CREATE OR REPLACE FUNCTION app.perm_pairs()
RETURNS TABLE(area text, view_perm text, manage_perm text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('sales',     'view_sales',     'sell'),
    ('stock',     'view_stock',     'stock'),
    ('approvals', 'view_approvals', 'approvals'),
    ('money',     'view_money',     'money'),
    ('staff',     'view_staff',     'staff'),
    ('locations', 'view_locations', 'locations')
  ) AS t(area, view_perm, manage_perm)
$$;

-- What a list really means: every action grant brings its view grant with it.
CREATE OR REPLACE FUNCTION app.expand_perms(p_perms text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), ARRAY[]::text[])
    FROM (
      SELECT unnest(coalesce(p_perms, ARRAY[]::text[])) AS x
      UNION
      SELECT pp.view_perm FROM app.perm_pairs() pp
       WHERE pp.manage_perm = ANY (coalesce(p_perms, ARRAY[]::text[]))
    ) s
$$;

-- The same list with the redundant view keys removed, so a row stores only
-- what the owner actually chose.
CREATE OR REPLACE FUNCTION app.compact_perms(p_perms text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[])
    FROM unnest(coalesce(p_perms, ARRAY[]::text[])) x
   WHERE NOT EXISTS (
     SELECT 1 FROM app.perm_pairs() pp
      WHERE pp.view_perm = x
        AND pp.manage_perm = ANY (coalesce(p_perms, ARRAY[]::text[]))
   )
$$;

-- Reading the back office means reading refunds and stock movements, which the
-- RLS read tier keeps at manager. `view_staff`/`view_locations` read tables
-- every tier may already see, so they do not lift the tier.
CREATE OR REPLACE FUNCTION app.tier_for(p_perms text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_perms && ARRAY['stock','approvals','money',
                          'view_stock','view_approvals','view_money']::text[]
    THEN 'manager' ELSE 'cashier' END
$$;

REVOKE ALL ON FUNCTION app.all_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.perm_pairs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.expand_perms(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.compact_perms(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.tier_for(text[]) FROM PUBLIC, anon, authenticated;

-- ---------- 2. save_staff learns the distinction ----------------------------
-- Three lines change in an otherwise identical body: the list is compacted,
-- the escalation check compares expanded lists, and the owner's own row keeps
-- the six action grants instead of listing every read key beside them.
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app' AND p.proname = 'save_staff';
  IF def IS NULL THEN RAISE EXCEPTION 'app.save_staff not found'; END IF;

  patched := replace(
    def,
    'v_perms := ARRAY(SELECT DISTINCT unnest(coalesce(p_permissions, ARRAY[]::text[])) ORDER BY 1);',
    'v_perms := app.compact_perms(ARRAY(SELECT DISTINCT unnest(coalesce(p_permissions, ARRAY[]::text[]))));'
  );
  IF patched = def THEN RAISE EXCEPTION 'save_staff: permission list line not found'; END IF;
  def := patched;

  patched := replace(
    def,
    'IF NOT me.is_owner AND NOT (v_perms <@ me.permissions) THEN',
    'IF NOT me.is_owner AND NOT (app.expand_perms(v_perms) <@ app.expand_perms(me.permissions)) THEN'
  );
  IF patched = def THEN RAISE EXCEPTION 'save_staff: escalation check not found'; END IF;
  def := patched;

  patched := replace(
    def,
    'v_perms := app.all_permissions();',
    'v_perms := app.compact_perms(app.all_permissions());'
  );
  IF patched = def THEN RAISE EXCEPTION 'save_staff: owner grant line not found'; END IF;

  EXECUTE patched;
END $$;

-- ---------- 3. Rollback-only guard checks -----------------------------------
DO $$
DECLARE
  b public.businesses; v_store uuid; mgr uuid; tok uuid; probe uuid; ptok uuid;
  v_pin text; blocked boolean; stored text[];
BEGIN
  SELECT * INTO b FROM public.businesses x
   WHERE public.subscription_active(x.id)
   ORDER BY created_at LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No active tenant for view-access checks'; END IF;
  SELECT id INTO v_store FROM public.stores WHERE business_id = b.id ORDER BY created_at LIMIT 1;
  IF v_store IS NULL THEN RAISE EXCEPTION 'No store for view-access checks'; END IF;

  -- The two helpers are the whole model; prove them first.
  IF NOT ('view_stock' = ANY (app.expand_perms(ARRAY['stock']))) THEN
    RAISE EXCEPTION 'expand_perms did not imply view_stock from stock';
  END IF;
  IF app.compact_perms(ARRAY['view_stock','stock']) <> ARRAY['stock']::text[] THEN
    RAISE EXCEPTION 'compact_perms kept a redundant view_stock';
  END IF;
  IF app.tier_for(ARRAY['view_stock']) <> 'manager' THEN
    RAISE EXCEPTION 'view_stock did not reach the manager read tier';
  END IF;
  IF app.tier_for(ARRAY['view_staff']) <> 'cashier' THEN
    RAISE EXCEPTION 'view_staff should not lift the read tier';
  END IF;

  BEGIN
    INSERT INTO public.staff(business_id, name, role, pin_hash, permissions, is_owner)
      VALUES (b.id, '__view_mgr', 'manager',
              extensions.crypt('2222', extensions.gen_salt('bf', 4)),
              ARRAY['staff','stock'], false)
      RETURNING id INTO mgr;
    INSERT INTO public.staff_sessions(token, staff_id, auth_uid, expires_at)
      VALUES (gen_random_uuid(), mgr, b.owner_id, now() + interval '5 minutes')
      RETURNING token INTO tok;

    PERFORM set_config('request.jwt.claim.sub', b.owner_id::text, true);
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', b.owner_id, 'role', 'authenticated')::text, true);

    v_pin := (10000000 + (random() * 89999999)::int)::text;

    -- A stock manager may hand out the read-only view of stock: it is already
    -- part of the access they hold, even though the key is not listed.
    probe := app.save_staff(tok, NULL, '__view_probe', ARRAY['view_stock'], v_pin, v_store, true);
    SELECT permissions INTO stored FROM public.staff WHERE id = probe;
    IF stored <> ARRAY['view_stock']::text[] THEN
      RAISE EXCEPTION 'view_stock was not stored as chosen: %', stored;
    END IF;
    IF (SELECT role FROM public.staff WHERE id = probe) <> 'manager' THEN
      RAISE EXCEPTION 'view_stock was not given the manager read tier';
    END IF;

    -- The same manager cannot open money: they do not hold it.
    blocked := false;
    v_pin := (10000000 + (random() * 89999999)::int)::text;
    BEGIN
      PERFORM app.save_staff(tok, NULL, '__view_probe2', ARRAY['view_money'], v_pin, v_store, true);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%only grant access you already hold%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'A stock manager granted money access'; END IF;

    -- Handing someone the manage grant and a view key together stays compact.
    v_pin := (10000000 + (random() * 89999999)::int)::text;
    probe := app.save_staff(tok, NULL, '__view_probe3', ARRAY['stock','view_stock'], v_pin, v_store, true);
    SELECT permissions INTO stored FROM public.staff WHERE id = probe;
    IF stored <> ARRAY['stock']::text[] THEN
      RAISE EXCEPTION 'manage + view was stored as %', stored;
    END IF;

    -- Read-only really is read-only: the till cannot write the catalogue.
    INSERT INTO public.staff_sessions(token, staff_id, auth_uid, expires_at)
      SELECT gen_random_uuid(), id, b.owner_id, now() + interval '5 minutes'
        FROM public.staff WHERE business_id = b.id AND name = '__view_probe'
      RETURNING token INTO ptok;
    blocked := false;
    BEGIN
      PERFORM public.save_product(ptok, v_store, NULL, '__view probe', NULL, NULL, 10, 0, true, NULL);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%access does not include%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'A view-only member edited the catalogue'; END IF;

    -- The owner's own row keeps one grant per area, not one per check.
    IF cardinality(app.compact_perms(app.all_permissions())) <> 6
       OR EXISTS (
         SELECT 1 FROM unnest(app.compact_perms(app.all_permissions())) x
          WHERE position('view_' in x) = 1
       ) THEN
      RAISE EXCEPTION 'owner grants were not compacted';
    END IF;

    RAISE EXCEPTION 'view access rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'view access rollback' THEN RAISE; END IF;
  END;
END $$;
