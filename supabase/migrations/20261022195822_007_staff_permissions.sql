-- ============================================================================
-- 007 - Staff permissions: view/change grants and PIN hash secrecy
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261022195822  staff_permissions
--   20261022202929  staff_view_access
--   20261022211326  staff_pin_hash_column_secret
-- ============================================================================

-- --- from 20261022195822_staff_permissions.sql ----------------------------------
-- ============================================================================
-- Staff access is a checklist, not a job title.
--
-- A business has exactly one privileged person: the one `setup_business`
-- creates with the shop. Everyone added afterwards is a team member whose
-- access is a set of independent grants the owner ticks:
--
--   sell       the till, its drawer, sales history, laybys
--   stock      items, collections, transfers, stock takes, stock adjustments
--   approvals  invoice approvals and refunds
--   money      reports, expenses and the subscription
--   staff      the staff roster and each person's access
--   locations  locations and their VAT details
--
-- `staff.role` survives only as the derived read tier the existing RLS policies
-- and `session_role()` were written against; it is no longer chosen by anyone.
-- Every write gate now asks for the capability it actually needs through
-- `app.require_perm`, so a till-only person cannot reach the catalogue by
-- calling the RPC directly.
--
-- Design notes:
-- * One capability per area of the product, not one per screen: the till and
--   its drawer travel together, as do the catalogue, stock takes and transfers.
-- * `is_owner` is a fact, not a grant. It cannot be handed out, removed or
--   deactivated, so a business can never end up with nobody able to manage it.
-- * Existing rows are migrated to exactly the access their old role implied, so
--   nobody gains or loses a screen on the day this ships.
-- * The retired `require_staff(roles)` guard now raises instead of quietly
--   accepting a role name, so a stale copied function body fails loudly.
-- * Changing someone's access drops their live PIN sessions, so a till cannot
--   keep showing screens the owner just took away. The database would refuse
--   the writes either way; this keeps the screen honest too.
-- ============================================================================

-- ---------- 1. The grant set on a staff row --------------------------------
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.all_permissions() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['sell','stock','approvals','money','staff','locations']::text[]
$$;

-- The old role name is now only a read tier (RLS + session_role); any
-- back-office grant keeps the manager-level reads it always had.
CREATE OR REPLACE FUNCTION app.tier_for(p_perms text[]) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_perms && ARRAY['stock','approvals','money']::text[] THEN 'manager' ELSE 'cashier' END
$$;

CREATE OR REPLACE FUNCTION app.has_perm(p_staff public.staff, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_staff.is_owner OR p_perm = ANY(p_staff.permissions)
$$;

-- Backfill before the constraint is added: the old tiers become the grants
-- they already implied (admin = everything, manager = back office + till,
-- cashier = till only).
UPDATE public.staff SET permissions = CASE role
    WHEN 'admin' THEN app.all_permissions()
    WHEN 'manager' THEN ARRAY['sell','stock','approvals','money']::text[]
    ELSE ARRAY['sell']::text[]
  END
 WHERE cardinality(permissions) = 0;

-- The owner is the person created with the business: `setup_business` inserts
-- them before any other staff row exists.
WITH first_staff AS (
  SELECT DISTINCT ON (business_id) id FROM public.staff
   ORDER BY business_id, created_at, id
)
UPDATE public.staff s SET is_owner = true
  FROM first_staff f WHERE s.id = f.id AND NOT s.is_owner;

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_permissions_known;
ALTER TABLE public.staff ADD CONSTRAINT staff_permissions_known
  CHECK (permissions <@ app.all_permissions());

CREATE UNIQUE INDEX IF NOT EXISTS staff_one_owner_per_business
  ON public.staff(business_id) WHERE is_owner;

-- ---------- 2. The guard every write RPC now uses --------------------------
CREATE OR REPLACE FUNCTION app.require_perm_nosub(p_token uuid, p_perms text[])
RETURNS public.staff LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND ss.auth_uid = auth.uid()
     AND s.active AND s.business_id = app.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.is_owner OR st.permissions && p_perms) THEN
    RAISE EXCEPTION 'Your access does not include this action';
  END IF;
  PERFORM set_config('storq.staff', st.id::text, true);
  RETURN st;
END $$;

-- Same contract as the old `require_staff`: identity first, then the paywall.
CREATE OR REPLACE FUNCTION app.require_perm(p_token uuid, p_perms text[])
RETURNS public.staff LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  st := app.require_perm_nosub(p_token, p_perms);
  IF NOT public.subscription_active(st.business_id) THEN
    RAISE EXCEPTION 'Subscription inactive or store limit exceeded: open Billing to continue';
  END IF;
  RETURN st;
END $$;

REVOKE ALL ON FUNCTION app.all_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.tier_for(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.has_perm(public.staff, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.require_perm(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.require_perm_nosub(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- Retired on purpose: a body still asking for a role name must fail in review
-- rather than hand out access nobody meant to grant.
CREATE OR REPLACE FUNCTION public.require_staff(p_token uuid, p_roles text[])
RETURNS public.staff LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'require_staff(roles) is retired - call app.require_perm(p_token, permissions)';
END $$;
REVOKE ALL ON FUNCTION public.require_staff(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- ---------- 3. Every RPC asks for the capability it really needs ------------
-- The guard line is rewritten in place; each body is otherwise byte-identical,
-- taken from the catalogue so no validation or ordering is retyped by hand.
DO $$
DECLARE m record; def text; patched text; hits integer;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('adjust_stock_reason', ARRAY['stock']::text[]),
    ('cancel_layby',        ARRAY['approvals']::text[]),
    ('cash_move',           ARRAY['sell']::text[]),
    ('checkout',            ARRAY['sell']::text[]),
    ('checkout_ref',        ARRAY['sell']::text[]),
    ('close_shift',         ARRAY['sell']::text[]),
    ('close_stock_take',    ARRAY['stock']::text[]),
    ('count_stock',         ARRAY['sell','stock']::text[]),
    ('create_transfer',     ARRAY['stock']::text[]),
    ('delete_collection',   ARRAY['stock']::text[]),
    ('delete_expense',      ARRAY['money']::text[]),
    ('get_shift_summary',   ARRAY['sell']::text[]),
    ('layby_pay',           ARRAY['sell']::text[]),
    ('low_stock',           ARRAY['stock']::text[]),
    ('open_shift',          ARRAY['sell']::text[]),
    ('process_refund',      ARRAY['approvals']::text[]),
    ('record_expense',      ARRAY['sell','money']::text[]),
    ('review_invoice',      ARRAY['approvals']::text[]),
    ('sales_summary',       ARRAY['sell','money']::text[]),
    ('save_collection',     ARRAY['stock']::text[]),
    ('save_product',        ARRAY['stock']::text[]),
    ('save_staff',          ARRAY['staff']::text[]),
    ('save_store',          ARRAY['locations']::text[]),
    ('save_tax_settings',   ARRAY['locations']::text[]),
    ('set_collection_products', ARRAY['stock']::text[]),
    ('set_product_collections', ARRAY['stock']::text[]),
    ('set_shift_float',     ARRAY['sell']::text[]),
    ('set_stock_qty',       ARRAY['stock']::text[]),
    ('start_stock_take',    ARRAY['stock']::text[]),
    ('sync_pull',           ARRAY['sell']::text[])
  ) AS t(fn, perms)
  LOOP
    hits := 0;
    FOR def IN
      SELECT pg_get_functiondef(p.oid) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.proname = m.fn
    LOOP
      -- Re-running the file must not report a false failure.
      IF position('require_perm(' IN def) > 0 THEN hits := hits + 1; CONTINUE; END IF;
      patched := regexp_replace(
        def,
        '(?:public\.)?require_staff\s*\(\s*p_token\s*,\s*(?:ARRAY|array)\s*\[[^\]]*\]\s*\)',
        format('app.require_perm(p_token, %L::text[])', m.perms),
        'gi'
      );
      IF patched = def THEN RAISE EXCEPTION 'No role guard found in app.%', m.fn; END IF;
      EXECUTE patched;
      hits := hits + 1;
    END LOOP;
    IF hits = 0 THEN RAISE EXCEPTION 'Function app.% not found', m.fn; END IF;
  END LOOP;

  -- Billing is the one path a lapsed shop must still be able to call.
  FOR def IN
    SELECT pg_get_functiondef(p.oid) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname IN ('start_store_subscription_payment','start_subscription_payment')
  LOOP
    patched := regexp_replace(
      def,
      '(?:public\.)?require_staff_nosub\s*\(\s*p_token\s*,\s*(?:ARRAY|array)\s*\[[^\]]*\]\s*\)',
      'app.require_perm_nosub(p_token, ARRAY[''money'']::text[])',
      'gi'
    );
    IF patched <> def THEN EXECUTE patched; END IF;
  END LOOP;
END $$;

-- ---------- 4. The three places a role was compared, not just checked ------
DO $$
DECLARE r record; def text; patched text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- An assigned store binds whoever holds it, not only the old cashier tier.
    ('checkout',   'me.role = ''cashier'' AND me.store_id IS NOT NULL AND me.store_id <> p_store', 'me.store_id IS NOT NULL AND me.store_id <> p_store'),
    ('open_shift', 'me.role = ''cashier'' AND me.store_id IS NOT NULL AND me.store_id <> p_store', 'me.store_id IS NOT NULL AND me.store_id <> p_store'),
    ('record_expense', 'me.role = ''cashier'' AND me.store_id IS NOT NULL AND me.store_id <> p_store', 'me.store_id IS NOT NULL AND me.store_id <> p_store'),
    ('set_shift_float', 'me.role = ''cashier'' AND me.store_id IS NOT NULL AND me.store_id <> sh.store_id', 'me.store_id IS NOT NULL AND me.store_id <> sh.store_id'),
    ('create_transfer', 'me.role = ''manager'' AND me.store_id IS NOT NULL AND me.store_id NOT IN (p_from, p_to)', 'me.store_id IS NOT NULL AND me.store_id NOT IN (p_from, p_to)'),
    -- A discount beyond the cap needs someone who holds approvals, and their
    -- PIN is looked up by that grant rather than by a job title.
    ('checkout', 'IF v_disc > 0 AND me.role = ''cashier'' THEN', 'IF v_disc > 0 AND NOT app.has_perm(me, ''approvals'') THEN'),
    ('checkout', 'WHERE business_id = me.business_id AND active AND role IN (''admin'',''manager'')', 'WHERE business_id = me.business_id AND active AND (is_owner OR ''approvals'' = ANY (permissions))'),
    -- Nobody signs off their own invoice except the owner, who has no one else.
    ('review_invoice', 'IF s.created_by = me.id AND me.role <> ''admin'' THEN', 'IF s.created_by = me.id AND NOT me.is_owner THEN')
  ) AS t(fn, find, repl)
  LOOP
    FOR def IN
      SELECT pg_get_functiondef(p.oid) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.proname = r.fn
    LOOP
      patched := replace(def, r.find, r.repl);
      IF patched <> def THEN EXECUTE patched; END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---------- 5. save_staff hands out access instead of a title ---------------
DROP FUNCTION IF EXISTS public.save_staff(uuid, uuid, text, text, text, uuid, boolean);
DROP FUNCTION IF EXISTS app.save_staff(uuid, uuid, text, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION app.save_staff(
  p_token uuid, p_id uuid, p_name text, p_permissions text[],
  p_pin text, p_store uuid, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  me public.staff; r uuid; n integer; sub public.subscriptions;
  target public.staff; v_perms text[];
BEGIN
  me := app.require_perm(p_token, ARRAY['staff']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a name'; END IF;
  IF char_length(btrim(p_name)) > 100 THEN RAISE EXCEPTION 'Name is too long (max 100 characters)'; END IF;

  v_perms := ARRAY(SELECT DISTINCT unnest(coalesce(p_permissions, ARRAY[]::text[])) ORDER BY 1);
  IF EXISTS (SELECT 1 FROM unnest(v_perms) x WHERE x IS NULL)
     OR NOT (v_perms <@ app.all_permissions()) THEN
    RAISE EXCEPTION 'Unknown access option';
  END IF;
  -- Nobody hands out more than they hold: a manager trusted with the roster
  -- cannot mint themselves a grant the owner never gave them.
  IF NOT me.is_owner AND NOT (v_perms <@ me.permissions) THEN
    RAISE EXCEPTION 'You can only grant access you already hold';
  END IF;
  IF p_store IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN
    RAISE EXCEPTION 'Unknown store';
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' THEN
    IF p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'PIN must be 4 to 8 digits'; END IF;
    IF public.pin_taken(me.business_id, p_pin, p_id) THEN RAISE EXCEPTION 'That PIN is already used by someone else'; END IF;
  END IF;

  IF p_id IS NULL THEN
    IF cardinality(v_perms) = 0 THEN RAISE EXCEPTION 'Tick at least one kind of access'; END IF;
    IF p_pin IS NULL OR p_pin = '' THEN RAISE EXCEPTION 'PIN required'; END IF;
    SELECT * INTO sub FROM public.subscriptions WHERE business_id = me.business_id;
    IF sub.business_id IS NULL OR coalesce(sub.paid_until, '-infinity') <= now() THEN
      SELECT count(*) INTO n FROM public.staff WHERE business_id = me.business_id AND active;
      IF n >= 3 THEN RAISE EXCEPTION 'The free plan covers 3 staff PINs. Pay on Billing to add more'; END IF;
    END IF;
    INSERT INTO public.staff(business_id, name, role, pin_hash, store_id, active, permissions, is_owner)
      VALUES (me.business_id, btrim(p_name), app.tier_for(v_perms),
              extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), p_store,
              coalesce(p_active, true), v_perms, false)
      RETURNING id INTO r;
  ELSE
    SELECT * INTO target FROM public.staff WHERE id = p_id AND business_id = me.business_id;
    IF target.id IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;

    -- The owner is the shop: their access and their active flag are not edits.
    IF target.is_owner THEN
      IF NOT me.is_owner THEN RAISE EXCEPTION 'Only the owner can change the owner account'; END IF;
      IF NOT coalesce(p_active, true) THEN RAISE EXCEPTION 'The owner account cannot be deactivated'; END IF;
      v_perms := app.all_permissions();
    END IF;
    IF p_id = me.id AND NOT coalesce(p_active, true) THEN
      RAISE EXCEPTION 'You cannot deactivate yourself';
    END IF;
    IF p_id = me.id AND NOT ('staff' = ANY (v_perms)) THEN
      RAISE EXCEPTION 'You cannot remove your own staff access';
    END IF;

    UPDATE public.staff
       SET name = btrim(p_name),
           role = CASE WHEN target.is_owner THEN 'admin' ELSE app.tier_for(v_perms) END,
           permissions = v_perms,
           store_id = p_store,
           active = CASE WHEN target.is_owner THEN true ELSE coalesce(p_active, true) END,
           pin_hash = CASE WHEN p_pin IS NOT NULL AND p_pin <> ''
                           THEN extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
                           ELSE pin_hash END
     WHERE id = p_id AND business_id = me.business_id
     RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;

    -- A taken-away grant must not linger on a till that is already unlocked.
    IF p_id <> me.id AND (
         NOT coalesce(p_active, true)
         OR target.permissions IS DISTINCT FROM v_perms
       ) THEN
      DELETE FROM public.staff_sessions WHERE staff_id = p_id;
    END IF;
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.save_staff(
  p_token uuid, p_id uuid, p_name text, p_permissions text[],
  p_pin text, p_store uuid, p_active boolean)
RETURNS uuid LANGUAGE sql SET search_path = public
AS $$ SELECT app.save_staff($1, $2, $3, $4, $5, $6, $7) $$;

REVOKE ALL ON FUNCTION app.save_staff(uuid, uuid, text, text[], text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.save_staff(uuid, uuid, text, text[], text, uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_staff(uuid, uuid, text, text[], text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_staff(uuid, uuid, text, text[], text, uuid, boolean) TO authenticated, service_role;

-- ---------- 6. Onboarding creates the one owner, and the PIN returns grants -
CREATE OR REPLACE FUNCTION app.setup_business(p_name text, p_currency text, p_store_name text, p_store_type text, p_owner_name text, p_pin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE b uuid; s uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF EXISTS (SELECT 1 FROM public.businesses WHERE owner_id = auth.uid()) THEN RAISE EXCEPTION 'Business already set up'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a business name'; END IF;
  IF char_length(btrim(p_name)) > 200 THEN RAISE EXCEPTION 'Business name is too long (max 200 characters)'; END IF;
  IF p_store_name IS NULL OR btrim(p_store_name) = '' THEN RAISE EXCEPTION 'Enter a store name'; END IF;
  IF char_length(btrim(p_store_name)) > 120 THEN RAISE EXCEPTION 'Store name is too long (max 120 characters)'; END IF;
  IF p_owner_name IS NULL OR btrim(p_owner_name) = '' THEN RAISE EXCEPTION 'Enter your name'; END IF;
  IF char_length(btrim(p_owner_name)) > 100 THEN RAISE EXCEPTION 'Name is too long (max 100 characters)'; END IF;
  IF p_store_type IS NULL OR p_store_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Choose a store type'; END IF;
  IF p_currency IS NOT NULL AND btrim(p_currency) <> '' AND char_length(btrim(p_currency)) > 4 THEN RAISE EXCEPTION 'Currency symbol is too long'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'PIN must be 4 to 8 digits'; END IF;
  INSERT INTO public.businesses(owner_id, name, currency) VALUES (auth.uid(), btrim(p_name), coalesce(nullif(btrim(p_currency),''),'R')) RETURNING id INTO b;
  INSERT INTO public.stores(business_id, name, store_type) VALUES (b, btrim(p_store_name), p_store_type) RETURNING id INTO s;
  INSERT INTO public.staff(business_id, name, role, pin_hash, permissions, is_owner)
    VALUES (b, btrim(p_owner_name), 'admin',
            extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
            app.all_permissions(), true);
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION app.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL::text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid;
  v_now timestamptz := now();
  dev text := lower(btrim(coalesce(p_device_id, '')));
  v_window constant interval := interval '15 minutes';
  v_device_max constant integer := 5;
  v_login_max constant integer := 20;
  st public.staff;
  t uuid;
  v_exp timestamptz;
  v_dfails integer;
  v_dwin timestamptz;
  v_dlock timestamptz;
  v_lfails integer;
  v_lwin timestamptz;
  v_llock timestamptz;
  v_left integer;
  v_wait integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  b := app.my_business_id();
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;

  IF dev <> '' AND dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN dev := ''; END IF;

  INSERT INTO public.pin_login_throttle (business_id, auth_uid)
  VALUES (b, uid)
  ON CONFLICT (business_id, auth_uid) DO NOTHING;

  SELECT fails, window_start, locked_until
    INTO v_lfails, v_lwin, v_llock
    FROM public.pin_login_throttle
   WHERE business_id = b AND auth_uid = uid
   FOR UPDATE;

  SELECT fails, window_start, locked_until
    INTO v_dfails, v_dwin, v_dlock
    FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev
   FOR UPDATE;

  v_dfails := coalesce(v_dfails, 0);
  v_dwin := coalesce(v_dwin, v_now);
  v_lfails := coalesce(v_lfails, 0);
  v_lwin := coalesce(v_lwin, v_now);

  IF (v_dlock IS NOT NULL AND v_dlock > v_now)
     OR (v_llock IS NOT NULL AND v_llock > v_now) THEN
    v_wait := greatest(1, ceil(extract(epoch FROM (
      greatest(coalesce(v_dlock, '-infinity'::timestamptz),
               coalesce(v_llock, '-infinity'::timestamptz)) - v_now)) / 60)::int);
    RETURN json_build_object('ok', false, 'code', 'throttled',
      'retry_after', v_wait * 60, 'attempts_left', 0);
  END IF;

  IF v_now >= v_dwin + v_window THEN v_dfails := 0; v_dwin := v_now; END IF;
  IF v_now >= v_lwin + v_window THEN v_lfails := 0; v_lwin := v_now; END IF;

  IF p_pin IS NOT NULL AND p_pin ~ '^[0-9]{4,8}$' THEN
    SELECT * INTO st FROM public.staff
     WHERE business_id = b AND active
       AND pin_hash = extensions.crypt(p_pin, pin_hash)
     LIMIT 1;
  END IF;

  IF st.id IS NULL THEN
    v_dfails := v_dfails + 1;
    v_lfails := v_lfails + 1;

    INSERT INTO public.pin_throttle
      (business_id, auth_uid, device_id, fails, window_start, locked_until, updated_at)
    VALUES
      (b, uid, dev, v_dfails, v_dwin,
       CASE WHEN v_dfails >= v_device_max THEN v_now + v_window END, v_now)
    ON CONFLICT (business_id, auth_uid, device_id) DO UPDATE
      SET fails = excluded.fails,
          window_start = excluded.window_start,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at;

    INSERT INTO public.pin_login_throttle
      (business_id, auth_uid, fails, window_start, locked_until, updated_at)
    VALUES
      (b, uid, v_lfails, v_lwin,
       CASE WHEN v_lfails >= v_login_max THEN v_now + v_window END, v_now)
    ON CONFLICT (business_id, auth_uid) DO UPDATE
      SET fails = excluded.fails,
          window_start = excluded.window_start,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at;

    DELETE FROM public.pin_throttle
     WHERE business_id = b AND auth_uid = uid AND device_id <> dev
       AND updated_at < v_now - interval '1 day'
       AND (locked_until IS NULL OR locked_until < v_now);

    IF v_dfails >= v_device_max OR v_lfails >= v_login_max THEN
      RETURN json_build_object('ok', false, 'code', 'throttled',
        'retry_after', extract(epoch FROM v_window)::int, 'attempts_left', 0);
    END IF;

    v_left := greatest(0, v_device_max - v_dfails);
    RETURN json_build_object('ok', false, 'code', 'wrong_pin', 'attempts_left', v_left);
  END IF;

  DELETE FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev;
  DELETE FROM public.pin_login_throttle
   WHERE business_id = b AND auth_uid = uid;
  DELETE FROM public.staff_sessions WHERE expires_at < v_now;
  DELETE FROM public.staff_sessions WHERE auth_uid = uid AND device_id = dev;

  v_exp := v_now + interval '8 hours';
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, expires_at)
  VALUES (st.id, uid, dev, v_exp)
  RETURNING token INTO t;

  RETURN json_build_object('ok', true, 'token', t, 'id', st.id, 'name', st.name,
    'role', st.role, 'store_id', st.store_id, 'expires_at', v_exp,
    'permissions', st.permissions, 'owner', st.is_owner);
END $$;

-- ---------- 7. Rollback-only guard checks ----------------------------------
-- Every fixture lives in a subtransaction that is deliberately aborted, so the
-- checks prove real behaviour and leave the database untouched.
DO $$
DECLARE
  b public.businesses; st_store uuid; st_sell uuid; st_stock uuid;
  tok_sell uuid; tok_stock uuid; blocked boolean;
BEGIN
  SELECT * INTO b FROM public.businesses x
   WHERE public.subscription_active(x.id)
   ORDER BY created_at LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No active tenant for permission guard checks'; END IF;
  SELECT id INTO st_store FROM public.stores WHERE business_id = b.id ORDER BY created_at LIMIT 1;
  IF st_store IS NULL THEN RAISE EXCEPTION 'No store for permission guard checks'; END IF;

  BEGIN
    INSERT INTO public.staff(business_id, name, role, pin_hash, permissions)
      VALUES (b.id, '__guard_sell', 'cashier',
              extensions.crypt('0000', extensions.gen_salt('bf', 4)), ARRAY['sell'])
      RETURNING id INTO st_sell;
    INSERT INTO public.staff(business_id, name, role, pin_hash, permissions)
      VALUES (b.id, '__guard_stock', 'manager',
              extensions.crypt('1111', extensions.gen_salt('bf', 4)), ARRAY['stock'])
      RETURNING id INTO st_stock;

    INSERT INTO public.staff_sessions(token, staff_id, auth_uid, expires_at)
      VALUES (gen_random_uuid(), st_sell, b.owner_id, now() + interval '5 minutes')
      RETURNING token INTO tok_sell;

    PERFORM set_config('request.jwt.claim.sub', b.owner_id::text, true);
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', b.owner_id, 'role', 'authenticated')::text, true);

    -- A till-only person cannot reach the catalogue through the RPC.
    blocked := false;
    BEGIN
      PERFORM public.save_product(tok_sell, st_store, NULL, '__permission probe',
                                  NULL, NULL, 10, 0, true, NULL);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%access does not include%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'A sell-only staff member edited the catalogue'; END IF;

    -- The same call succeeds once the grant is there: the guard is the grant,
    -- not a leftover role check somewhere else in the body.
    INSERT INTO public.staff_sessions(token, staff_id, auth_uid, expires_at)
      VALUES (gen_random_uuid(), st_stock, b.owner_id, now() + interval '5 minutes')
      RETURNING token INTO tok_stock;
    PERFORM public.save_product(tok_stock, st_store, NULL, '__permission probe',
                                NULL, NULL, 10, 0, true, NULL);

    RAISE EXCEPTION 'permission guard rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'permission guard rollback' THEN RAISE; END IF;
  END;
END $$;

-- --- from 20261022202929_staff_view_access.sql ----------------------------------
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

-- --- from 20261022211326_staff_pin_hash_column_secret.sql -----------------------
-- ============================================================================
-- PIN hashes are for verification, never for reading.
--
-- `staff` is readable by every unlocked tier so the roster, the person picker
-- and the "created by" labels work. The bcrypt PIN hash used to travel with
-- that read: any member could pull every colleague's hash and crack a short
-- PIN offline, then unlock as the owner. The hash now sits outside the
-- client's column grant; the PIN pad and the override checks keep reading it
-- because they run inside SECURITY DEFINER functions as the table owner.
--
-- RLS still scopes rows; this adds the column privilege underneath it. A
-- table-level SELECT grant would reopen the hole, so the guard at the end
-- fails the migration if `pin_hash` becomes readable again.
-- ============================================================================

REVOKE SELECT ON public.staff FROM authenticated, anon;

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO cols
    FROM pg_attribute
   WHERE attrelid = 'public.staff'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname <> 'pin_hash';
  IF cols IS NULL THEN RAISE EXCEPTION 'public.staff has no readable columns'; END IF;
  EXECUTE format('GRANT SELECT (%s) ON public.staff TO authenticated', cols);
END $$;

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.staff', 'pin_hash', 'SELECT') THEN
    RAISE EXCEPTION 'pin_hash is still readable by authenticated';
  END IF;
  IF NOT (has_column_privilege('authenticated', 'public.staff', 'name', 'SELECT')
      AND has_column_privilege('authenticated', 'public.staff', 'permissions', 'SELECT')
      AND has_column_privilege('authenticated', 'public.staff', 'is_owner', 'SELECT')) THEN
    RAISE EXCEPTION 'the readable column grant on public.staff is incomplete';
  END IF;
  IF has_table_privilege('authenticated', 'public.staff', 'INSERT')
     OR has_table_privilege('authenticated', 'public.staff', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.staff', 'DELETE') THEN
    RAISE EXCEPTION 'public.staff gained a write privilege';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

