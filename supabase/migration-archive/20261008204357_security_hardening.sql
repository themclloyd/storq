-- ============================================================================
-- Security hardening: anonymous RPC lockdown, PIN brute-force throttle,
-- device-bound short-lived staff sessions, server-side role separation for
-- reads, cost/margin segregation, input validation bounds, plan limits.
-- ============================================================================

-- ---------- 1. No unauthenticated (anon) RPC calls except the public share page ----------
DO $$
DECLARE r record; allow text[] := array['get_shared_collection'];
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS idargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','app') AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'execute')
      AND NOT (p.proname = ANY (allow))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM anon', r.sch, r.fn, r.idargs);
  END LOOP;
END $$;

-- Legacy reason-less stock adjustment (superseded by adjust_stock_reason) — drop both overloads.
DROP FUNCTION IF EXISTS public.adjust_stock(uuid, uuid, uuid, numeric);
DROP FUNCTION IF EXISTS app.adjust_stock(uuid, uuid, uuid, numeric);

-- ---------- 2. PIN attempt throttle (per business + per signed-in device) ----------
CREATE TABLE IF NOT EXISTS public.pin_throttle (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  auth_uid uuid NOT NULL,
  fails integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, auth_uid)
);
ALTER TABLE public.pin_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access" ON public.pin_throttle;
CREATE POLICY "no direct access" ON public.pin_throttle FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.pin_throttle FROM public, anon, authenticated;
GRANT ALL ON public.pin_throttle TO service_role;
COMMENT ON TABLE public.pin_throttle IS 'Server-side counter that locks PIN entry after repeated wrong attempts on one device login.';

-- ---------- 3. Staff sessions: bind to the device login, shorten lifetime ----------
ALTER TABLE public.staff_sessions ADD COLUMN IF NOT EXISTS auth_uid uuid;
ALTER TABLE public.staff_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.staff_sessions ALTER COLUMN expires_at SET DEFAULT (now() + interval '8 hours');
CREATE INDEX IF NOT EXISTS staff_sessions_auth_uid_idx ON public.staff_sessions (auth_uid);
CREATE INDEX IF NOT EXISTS staff_sessions_expires_at_idx ON public.staff_sessions (expires_at);

-- ---------- 4. Cost / margin moved out of broadly readable tables ----------
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost numeric(12,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.sale_item_costs (
  sale_item_id uuid PRIMARY KEY REFERENCES public.sale_items(id) ON DELETE CASCADE,
  cost numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_costs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.product_costs (product_id, cost) SELECT id, cost FROM public.products ON CONFLICT (product_id) DO NOTHING;
INSERT INTO public.sale_item_costs (sale_item_id, cost) SELECT id, cost FROM public.sale_items ON CONFLICT (sale_item_id) DO NOTHING;

ALTER TABLE public.products DROP COLUMN IF EXISTS cost;
ALTER TABLE public.sale_items DROP COLUMN IF EXISTS cost;

-- ---------- 5. Role resolution from the verified PIN session ----------
CREATE OR REPLACE FUNCTION app.session_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.role
  FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
  WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active
  ORDER BY ss.expires_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.session_role() FROM public, anon;
GRANT EXECUTE ON FUNCTION app.session_role() TO authenticated, service_role;
COMMENT ON FUNCTION app.session_role() IS 'Role of the one live PIN session for this device login; NULL when nobody has unlocked.';

-- ---------- 6. RLS: business data requires a PIN session; money data requires a role ----------
DROP POLICY IF EXISTS "own products" ON public.products;
CREATE POLICY "own products" ON public.products FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stores" ON public.stores;
CREATE POLICY "own stores" ON public.stores FOR SELECT TO authenticated
  USING (business_id = app.my_business_id());

DROP POLICY IF EXISTS "own staff" ON public.staff;
CREATE POLICY "own staff" ON public.staff FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own sales" ON public.sales;
CREATE POLICY "own sales" ON public.sales FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own sale items" ON public.sale_items;
CREATE POLICY "own sale items" ON public.sale_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own payments" ON public.payments;
CREATE POLICY "own payments" ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stock" ON public.store_stock;
CREATE POLICY "own stock" ON public.store_stock FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own collections" ON public.collections;
CREATE POLICY "own collections" ON public.collections FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own product collections" ON public.product_collections;
CREATE POLICY "own product collections" ON public.product_collections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND c.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stock takes" ON public.stock_takes;
CREATE POLICY "own stock takes" ON public.stock_takes FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own stock take lines" ON public.stock_take_lines;
CREATE POLICY "own stock take lines" ON public.stock_take_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_takes t WHERE t.id = stock_take_id AND t.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own shifts" ON public.cash_shifts;
CREATE POLICY "own shifts" ON public.cash_shifts FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own cash movements" ON public.cash_movements;
CREATE POLICY "own cash movements" ON public.cash_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.id = shift_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

DROP POLICY IF EXISTS "own expenses" ON public.expenses;
CREATE POLICY "own expenses" ON public.expenses FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager','cashier']));

-- Managers and admins only: buying costs, refunds, stock ledger, billing.
DROP POLICY IF EXISTS "managers read product costs" ON public.product_costs;
CREATE POLICY "managers read product costs" ON public.product_costs FOR SELECT TO authenticated
  USING (app.session_role() = ANY (ARRAY['admin','manager'])
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.business_id = app.my_business_id()));
DROP POLICY IF EXISTS "managers read sale item costs" ON public.sale_item_costs;
CREATE POLICY "managers read sale item costs" ON public.sale_item_costs FOR SELECT TO authenticated
  USING (app.session_role() = ANY (ARRAY['admin','manager'])
    AND EXISTS (SELECT 1 FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id
                 WHERE i.id = sale_item_id AND s.business_id = app.my_business_id()));

DROP POLICY IF EXISTS "own refunds" ON public.refunds;
CREATE POLICY "own refunds" ON public.refunds FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager']));
DROP POLICY IF EXISTS "own refund items" ON public.refund_items;
CREATE POLICY "own refund items" ON public.refund_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.refunds r WHERE r.id = refund_id AND r.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager']));

DROP POLICY IF EXISTS "own stock movements" ON public.stock_movements;
CREATE POLICY "own stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.business_id = app.my_business_id())
    AND app.session_role() = ANY (ARRAY['admin','manager']));

DROP POLICY IF EXISTS "own sub payments" ON public.subscription_payments;
CREATE POLICY "own sub payments" ON public.subscription_payments FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager']));

-- ---------- 7. Data bounds (defence in depth below the RPC validation) ----------
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_name_len;
ALTER TABLE public.businesses ADD CONSTRAINT businesses_name_len CHECK (name IS NOT NULL AND char_length(btrim(name)) BETWEEN 1 AND 200 AND char_length(currency) BETWEEN 1 AND 4);
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_name_len;
ALTER TABLE public.stores ADD CONSTRAINT stores_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_name_len;
ALTER TABLE public.staff ADD CONSTRAINT staff_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 100);
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_set;
ALTER TABLE public.staff ADD CONSTRAINT staff_role_set CHECK (role IN ('admin','manager','cashier'));
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_pin_shape;
ALTER TABLE public.staff ADD CONSTRAINT staff_pin_shape CHECK (pin_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$');
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_name_len;
ALTER TABLE public.products ADD CONSTRAINT products_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_shape;
ALTER TABLE public.products ADD CONSTRAINT products_sku_shape CHECK (sku IS NULL OR btrim(sku) = '' OR (char_length(sku) <= 64 AND sku ~ '^[A-Za-z0-9._\- ]+$'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_bounds;
ALTER TABLE public.products ADD CONSTRAINT products_price_bounds CHECK (price >= 0 AND price <= 1000000000);
ALTER TABLE public.product_costs DROP CONSTRAINT IF EXISTS product_costs_bounds;
ALTER TABLE public.product_costs ADD CONSTRAINT product_costs_bounds CHECK (cost >= 0 AND cost <= 1000000000);
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_bounds;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_bounds CHECK (qty > 0 AND qty <= 1000000 AND price >= 0 AND price <= 1000000000 AND refunded_qty >= 0 AND refunded_qty <= qty);
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_name_len;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE public.sale_item_costs DROP CONSTRAINT IF EXISTS sale_item_costs_bounds;
ALTER TABLE public.sale_item_costs ADD CONSTRAINT sale_item_costs_bounds CHECK (cost >= 0 AND cost <= 1000000000);
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_bounds;
ALTER TABLE public.payments ADD CONSTRAINT payments_bounds CHECK (amount > 0 AND amount <= 10000000000);
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_money_bounds;
ALTER TABLE public.sales ADD CONSTRAINT sales_money_bounds CHECK (total >= 0 AND total <= 10000000000 AND paid >= 0 AND refunded >= 0 AND refunded <= total + 0.01);
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_text_len;
ALTER TABLE public.sales ADD CONSTRAINT sales_text_len CHECK (coalesce(char_length(customer_name),0) <= 120 AND coalesce(char_length(customer_phone),0) <= 32 AND coalesce(char_length(note),0) <= 500);
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_phone_shape;
ALTER TABLE public.sales ADD CONSTRAINT sales_phone_shape CHECK (customer_phone IS NULL OR btrim(customer_phone) = '' OR customer_phone ~ '^[+0-9()\- ]{6,32}$');
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_bounds;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_bounds CHECK (amount > 0 AND amount <= 1000000000 AND char_length(btrim(category)) BETWEEN 1 AND 60 AND coalesce(char_length(note),0) <= 500);
ALTER TABLE public.collections DROP CONSTRAINT IF EXISTS collections_bounds;
ALTER TABLE public.collections ADD CONSTRAINT collections_bounds CHECK (char_length(btrim(name)) BETWEEN 1 AND 120 AND discount_pct BETWEEN 0 AND 100);
ALTER TABLE public.store_stock DROP CONSTRAINT IF EXISTS store_stock_bounds;
ALTER TABLE public.store_stock ADD CONSTRAINT store_stock_bounds CHECK (qty >= 0 AND qty <= 100000000);
ALTER TABLE public.stock_take_lines DROP CONSTRAINT IF EXISTS stock_take_lines_bounds;
ALTER TABLE public.stock_take_lines ADD CONSTRAINT stock_take_lines_bounds CHECK (expected >= 0 AND (counted IS NULL OR (counted >= 0 AND counted <= 100000000)));
ALTER TABLE public.subscription_payments DROP CONSTRAINT IF EXISTS sub_payments_bounds;
ALTER TABLE public.subscription_payments ADD CONSTRAINT sub_payments_bounds CHECK (stores BETWEEN 1 AND 1000 AND amount > 0 AND amount <= 100000000000 AND status IN ('pending','paid','failed','cancelled'));
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_bounds;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_bounds CHECK (amount >= 0 AND amount <= 10000000000 AND coalesce(char_length(reason),0) <= 500);
ALTER TABLE public.pin_throttle DROP CONSTRAINT IF EXISTS pin_throttle_fails;
ALTER TABLE public.pin_throttle ADD CONSTRAINT pin_throttle_fails CHECK (fails >= 0);

-- ---------- 8. PIN unlock with throttling, device binding and single active session ----------
CREATE OR REPLACE FUNCTION app.unlock_with_pin(p_pin text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE b uuid; uid uuid := auth.uid(); st public.staff; t uuid; thr public.pin_throttle; v_exp timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  b := app.my_business_id();
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'Wrong PIN'; END IF;

  SELECT * INTO thr FROM public.pin_throttle WHERE business_id = b AND auth_uid = uid FOR UPDATE;
  IF thr.business_id IS NOT NULL AND thr.locked_until IS NOT NULL AND thr.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong PIN attempts. Try again in % minute(s)',
      greatest(1, ceil(extract(epoch FROM (thr.locked_until - now())) / 60)::int);
  END IF;

  SELECT * INTO st FROM public.staff
   WHERE business_id = b AND active AND pin_hash = extensions.crypt(p_pin, pin_hash) LIMIT 1;

  IF st.id IS NULL THEN
    INSERT INTO public.pin_throttle (business_id, auth_uid, fails, locked_until, updated_at)
    VALUES (b, uid, 1, NULL, now())
    ON CONFLICT (business_id, auth_uid) DO UPDATE
      SET fails = pin_throttle.fails + 1,
          locked_until = CASE WHEN pin_throttle.fails + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
          updated_at = now();
    RAISE EXCEPTION 'Wrong PIN';
  END IF;

  DELETE FROM public.pin_throttle WHERE business_id = b AND auth_uid = uid;
  -- one live PIN session per signed-in device: a second unlock replaces the first
  DELETE FROM public.staff_sessions WHERE auth_uid = uid;
  DELETE FROM public.staff_sessions WHERE expires_at < now();

  v_exp := now() + interval '8 hours';
  INSERT INTO public.staff_sessions (staff_id, auth_uid, expires_at) VALUES (st.id, uid, v_exp) RETURNING token INTO t;
  RETURN json_build_object('token', t, 'id', st.id, 'name', st.name, 'role', st.role,
    'store_id', st.store_id, 'expires_at', v_exp);
END $$;

-- Sessions are now only usable from the device login that created them.
CREATE OR REPLACE FUNCTION public.require_staff_nosub(p_token uuid, p_roles text[]) RETURNS public.staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND ss.auth_uid = auth.uid()
     AND s.active AND s.business_id = app.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.role = ANY(p_roles)) THEN RAISE EXCEPTION 'Your role (%) is not allowed to do this', st.role; END IF;
  PERFORM set_config('storq.staff', st.id::text, true);
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION app.lock_session(p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  DELETE FROM public.staff_sessions ss
   WHERE ss.token = p_token AND (ss.auth_uid = uid OR ss.auth_uid IS NULL
     OR ss.staff_id IN (SELECT id FROM public.staff WHERE business_id = app.my_business_id()));
  DELETE FROM public.pin_throttle WHERE auth_uid = uid;
END $$;

-- Sign-out helper: drop every session and throttle row for this device login.
CREATE OR REPLACE FUNCTION app.lock_all_sessions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id();
BEGIN
  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
      OR (b IS NOT NULL AND auth_uid IS NULL AND staff_id IN (SELECT id FROM public.staff WHERE business_id = b));
  DELETE FROM public.pin_throttle WHERE auth_uid = uid;
END $$;

-- ---------- 9. Subscription: trial is one store, and expiry is honest ----------
CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.business_id = p_business
    AND ((s.paid_until > now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id = p_business))
      OR (s.trial_ends_at > now() AND coalesce(s.paid_until,'-infinity') <= now()
          AND (SELECT count(*) FROM public.stores WHERE business_id = p_business) <= 1)))
$$;

CREATE OR REPLACE FUNCTION app.save_store(p_token uuid, p_id uuid, p_name text, p_type text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.subscriptions; n integer; r uuid;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a store name'; END IF;
  IF char_length(btrim(p_name)) > 120 THEN RAISE EXCEPTION 'Store name is too long (max 120 characters)'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Choose a store type'; END IF;
  SELECT * INTO s FROM public.subscriptions WHERE business_id = me.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;
  IF p_id IS NULL THEN
    SELECT count(*) INTO n FROM public.stores WHERE business_id = me.business_id;
    IF s.paid_until > now() THEN
      IF n >= s.paid_store_limit THEN RAISE EXCEPTION 'All paid store slots are in use. Pay for additional capacity on Billing before adding a store'; END IF;
    ELSIF s.trial_ends_at <= now() THEN
      RAISE EXCEPTION 'Subscription expired: open Billing';
    ELSIF n >= 1 THEN
      RAISE EXCEPTION 'The free trial covers one store. Pay on Billing to add more stores';
    END IF;
    INSERT INTO public.stores(business_id, name, store_type) VALUES(me.business_id, btrim(p_name), p_type) RETURNING id INTO r;
  ELSE
    UPDATE public.stores SET name = btrim(p_name), store_type = p_type WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  END IF;
  RETURN r;
END $$;

-- ---------- 10. Staff: plan limit for staff PINs, validated input, PIN policy ----------
CREATE OR REPLACE FUNCTION app.save_staff(p_token uuid, p_id uuid, p_name text, p_role text, p_pin text, p_store uuid, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; r uuid; n integer; sub public.subscriptions; was_admin boolean;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a name'; END IF;
  IF char_length(btrim(p_name)) > 100 THEN RAISE EXCEPTION 'Name is too long (max 100 characters)'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin','manager','cashier') THEN RAISE EXCEPTION 'Choose a valid role'; END IF;
  IF p_store IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN
    RAISE EXCEPTION 'Unknown store';
  END IF;
  IF p_pin IS NOT NULL AND p_pin <> '' THEN
    IF p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'PIN must be 4 to 8 digits'; END IF;
    IF public.pin_taken(me.business_id, p_pin, p_id) THEN RAISE EXCEPTION 'That PIN is already used by someone else'; END IF;
  END IF;

  IF p_id IS NULL THEN
    IF p_pin IS NULL OR p_pin = '' THEN RAISE EXCEPTION 'PIN required'; END IF;
    SELECT * INTO sub FROM public.subscriptions WHERE business_id = me.business_id;
    IF sub.business_id IS NULL OR coalesce(sub.paid_until, '-infinity') <= now() THEN
      SELECT count(*) INTO n FROM public.staff WHERE business_id = me.business_id AND active;
      IF n >= 3 THEN RAISE EXCEPTION 'The free plan covers 3 staff PINs. Pay on Billing to add more'; END IF;
    END IF;
    INSERT INTO public.staff(business_id, name, role, pin_hash, store_id, active)
      VALUES (me.business_id, btrim(p_name), p_role, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), p_store, coalesce(p_active, true))
      RETURNING id INTO r;
  ELSE
    IF p_id = me.id AND (p_role <> 'admin' OR NOT coalesce(p_active, true)) THEN RAISE EXCEPTION 'You cannot demote or deactivate yourself'; END IF;
    SELECT role = 'admin' AND active INTO was_admin FROM public.staff WHERE id = p_id AND business_id = me.business_id;
    IF was_admin IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;
    IF was_admin AND (p_role <> 'admin' OR NOT coalesce(p_active, true))
       AND (SELECT count(*) FROM public.staff WHERE business_id = me.business_id AND active AND role = 'admin' AND id <> p_id) = 0 THEN
      RAISE EXCEPTION 'Keep at least one active admin';
    END IF;
    UPDATE public.staff SET name = btrim(p_name), role = p_role, store_id = p_store, active = coalesce(p_active, true),
      pin_hash = CASE WHEN p_pin IS NOT NULL AND p_pin <> '' THEN extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) ELSE pin_hash END
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Staff not found'; END IF;
    IF NOT coalesce(p_active, true) THEN DELETE FROM public.staff_sessions WHERE staff_id = p_id; END IF;
  END IF;
  RETURN r;
END $$;

-- ---------- 11. Setup: validated business creation ----------
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
  INSERT INTO public.staff(business_id, name, role, pin_hash) VALUES (b, btrim(p_owner_name), 'admin', extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  RETURN b;
END $$;

-- ---------- 12. Products: validated input, cost written to the gated table ----------
-- numeric NaN compares greater than every finite value, so an upper bound also rejects it.
CREATE OR REPLACE FUNCTION app.save_product(p_token uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin','manager']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter an item name'; END IF;
  IF char_length(btrim(p_name)) > 200 THEN RAISE EXCEPTION 'Item name is too long (max 200 characters)'; END IF;
  IF p_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Item name contains unsupported characters'; END IF;
  IF p_sku IS NOT NULL AND btrim(p_sku) <> '' AND (char_length(p_sku) > 64 OR p_sku !~ '^[A-Za-z0-9._\- ]+$') THEN
    RAISE EXCEPTION 'Barcode/SKU may only contain letters, numbers, spaces and . _ - (max 64)';
  END IF;
  IF p_category IS NOT NULL AND char_length(p_category) > 120 THEN RAISE EXCEPTION 'Category is too long (max 120 characters)'; END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Selling price must be between 0 and 1,000,000,000'; END IF;
  IF p_cost IS NOT NULL AND p_cost NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Buying cost must be between 0 and 1,000,000,000'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.products(business_id, name, sku, category, price, active)
      VALUES (me.business_id, btrim(p_name), nullif(btrim(p_sku),''), nullif(btrim(p_category),''), p_price, coalesce(p_active, true))
      RETURNING id INTO r;
  ELSE
    UPDATE public.products SET name = btrim(p_name), sku = nullif(btrim(p_sku),''), category = nullif(btrim(p_category),''),
      price = p_price, active = coalesce(p_active, true)
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  END IF;
  INSERT INTO public.product_costs(product_id, cost) VALUES (r, coalesce(p_cost, 0))
    ON CONFLICT (product_id) DO UPDATE SET cost = coalesce(p_cost, 0);
  RETURN r;
END $$;

-- ---------- 13. Checkout: validated cart, stock floor, cost to gated table ----------
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; st public.stores; b public.businesses; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; x jsonb;
  v_pid uuid; v_name text; v_price numeric; v_cost numeric; v_qty numeric; v_item uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cart must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one sale (max 500)'; END IF;
  -- every line must carry a well-formed product id and a plain positive quantity
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$';
  IF v_lines > 0 THEN RAISE EXCEPTION 'Cart contains an item with a bad id or quantity'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x WHERE (x->>'qty')::numeric <= 0;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;

  SELECT * INTO st FROM public.stores WHERE id = p_store AND business_id = me.business_id;
  IF st.id IS NULL THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('sale','layby') THEN RAISE EXCEPTION 'Unknown sale type'; END IF;
  IF p_kind = 'layby' AND coalesce(btrim(p_customer_name),'') = '' THEN RAISE EXCEPTION 'Layby needs a customer name'; END IF;
  IF char_length(coalesce(p_customer_name,'')) > 120 THEN RAISE EXCEPTION 'Customer name is too long (max 120 characters)'; END IF;
  IF p_customer_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Customer name contains unsupported characters'; END IF;
  IF p_customer_phone IS NOT NULL AND btrim(p_customer_phone) <> '' AND btrim(p_customer_phone) !~ '^[+0-9()\- ]{6,32}$' THEN
    RAISE EXCEPTION 'Customer phone must be 6-32 characters of digits, + ( ) - and spaces';
  END IF;
  IF coalesce(p_note,'') <> '' AND char_length(p_note) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF p_payment IS NOT NULL AND p_payment NOT BETWEEN 0 AND 10000000000 THEN RAISE EXCEPTION 'Payment amount must be between 0 and 10,000,000,000'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id = me.business_id;

  SELECT count(*) INTO v_matched FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id AND p.active;
  IF v_matched <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One or more items are not in your catalogue'; END IF;

  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_sub
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_sub IS NULL OR v_sub NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  IF b.tax_rate > 0 AND b.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + b.tax_rate/100), 2);
  ELSIF b.tax_rate > 0 THEN v_tax := round(v_sub * b.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;

  v_status := CASE WHEN st.store_type = 'approval' THEN 'pending_approval' WHEN p_kind = 'layby' THEN 'layby_open' ELSE 'completed' END;

  -- stock may not go negative on a sale that moves stock right now
  IF v_status <> 'pending_approval' THEN
    WITH need AS (
      SELECT (x->>'product_id')::uuid AS pid, sum((x->>'qty')::numeric) AS q
      FROM jsonb_array_elements(p_items) x GROUP BY 1)
    SELECT string_agg(p.name, ', ') INTO v_short FROM need
      JOIN public.products p ON p.id = need.pid
      LEFT JOIN public.store_stock ss ON ss.product_id = need.pid AND ss.store_id = p_store
      WHERE coalesce(ss.qty, 0) < need.q;
    IF v_short IS NOT NULL THEN RAISE EXCEPTION 'Not enough stock for: %', v_short; END IF;
  END IF;

  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  v_pay := least(greatest(coalesce(p_payment, 0), 0), v_total);
  IF v_status = 'completed' THEN v_pay := v_total; END IF;

  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, p_method,
      nullif(btrim(coalesce(p_customer_name,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
      nullif(btrim(coalesce(p_note,'')),''), me.id, v_shift)
    RETURNING id, number INTO v_sale, v_num;

  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT p.id, p.name, public.effective_price(p.id), coalesce(pc.cost, 0)
      INTO v_pid, v_name, v_price, v_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
    v_qty := (x->>'qty')::numeric;
    INSERT INTO public.sale_items(sale_id, product_id, name, qty, price)
      VALUES (v_sale, v_pid, v_name, v_qty, v_price) RETURNING id INTO v_item;
    INSERT INTO public.sale_item_costs(sale_item_id, cost) VALUES (v_item, v_cost);
  END LOOP;

  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_pay > 0 THEN INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (v_sale, v_pay, coalesce(p_method,'cash'), me.id); END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax);
END $$;

-- ---------- 14. Approval: same stock floor when stock actually moves ----------
CREATE OR REPLACE FUNCTION app.review_invoice(p_token uuid, p_sale uuid, p_approve boolean, p_payment numeric, p_method text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.sales; v_pay numeric; v_status text; v_short text;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'pending_approval' THEN RAISE EXCEPTION 'Invoice is not awaiting approval'; END IF;
  IF s.created_by = me.id AND me.role <> 'admin' THEN RAISE EXCEPTION 'Another person must approve your invoice'; END IF;
  IF NOT p_approve THEN
    UPDATE public.sales SET status = 'rejected', approved_by = me.id, approved_at = now() WHERE id = p_sale;
    RETURN 'rejected';
  END IF;
  WITH need AS (SELECT product_id, sum(qty) AS q FROM public.sale_items WHERE sale_id = p_sale AND product_id IS NOT NULL GROUP BY 1)
  SELECT string_agg(p.name, ', ') INTO v_short FROM need
    JOIN public.products p ON p.id = need.product_id
    LEFT JOIN public.store_stock ss ON ss.product_id = need.product_id AND ss.store_id = s.store_id
    WHERE coalesce(ss.qty, 0) < need.q;
  IF v_short IS NOT NULL THEN RAISE EXCEPTION 'Not enough stock for: %', v_short; END IF;
  IF s.kind = 'layby' THEN
    v_pay := least(greatest(coalesce(p_payment, 0), 0), s.total);
    v_status := CASE WHEN v_pay >= s.total THEN 'layby_completed' ELSE 'layby_open' END;
  ELSE v_pay := s.total; v_status := 'completed'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  UPDATE public.sales SET status = v_status, paid = v_pay, payment_method = coalesce(p_method,'cash'), approved_by = me.id, approved_at = now() WHERE id = p_sale;
  PERFORM public._move_stock(p_sale, -1);
  IF v_pay > 0 THEN INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (p_sale, v_pay, coalesce(p_method,'cash'), me.id); END IF;
  RETURN v_status;
END $$;

-- ---------- 15. Refunds: read buying cost from the gated table ----------
CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me public.staff; s public.sales; r uuid; rn int; x jsonb; it public.sale_items;
  q numeric; amt numeric := 0; cst numeric := 0; line numeric; v_shift uuid; v_tax numeric; v_sub numeric; v_left numeric; v_unit numeric; v_bad int;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Refund must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Pick items to return'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one refund (max 500)'; END IF;
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'sale_item_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$'
      OR (jsonb_exists(x,'restock') AND coalesce(x->>'restock','') NOT IN ('true','false'));
  IF v_bad > 0 THEN RAISE EXCEPTION 'Refund contains an item with a bad id or quantity'; END IF;
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  IF s.status NOT IN ('completed','layby_completed','partially_refunded') THEN RAISE EXCEPTION 'Only completed sales can be refunded'; END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'Give a reason for the refund'; END IF;
  IF char_length(p_reason) > 500 THEN RAISE EXCEPTION 'Reason is too long (max 500 characters)'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  SELECT coalesce(sum(price*qty),0) INTO v_sub FROM public.sale_items WHERE sale_id = s.id;
  IF v_sub <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = s.store_id AND status = 'open';
  INSERT INTO public.refunds(business_id, store_id, sale_id, amount, method, reason, staff_id, shift_id)
    VALUES (s.business_id, s.store_id, s.id, 0, coalesce(p_method,'cash'), btrim(p_reason), me.id, v_shift) RETURNING id, number INTO r, rn;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (x->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (x->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    SELECT coalesce(cost, 0) INTO v_unit FROM public.sale_item_costs WHERE sale_item_id = it.id;
    line := round(s.total * (it.price * q) / v_sub, 2);
    amt := amt + line;
    UPDATE public.sale_items SET refunded_qty = refunded_qty + q WHERE id = it.id;
    INSERT INTO public.refund_items(refund_id, sale_item_id, product_id, name, qty, amount, cost, restock)
      VALUES (r, it.id, it.product_id, it.name, q, line,
        CASE WHEN coalesce((x->>'restock')::boolean, true) THEN v_unit * q ELSE 0 END,
        coalesce((x->>'restock')::boolean, true));
    IF coalesce((x->>'restock')::boolean, true) AND it.product_id IS NOT NULL THEN
      cst := cst + v_unit * q;
      PERFORM app.set_ctx('refund_restock', r, p_reason);
      INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (s.store_id, it.product_id, q)
        ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
      PERFORM app.set_ctx(NULL, NULL, NULL);
    END IF;
  END LOOP;
  IF amt <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT coalesce(sum(qty - refunded_qty),0) INTO v_left FROM public.sale_items WHERE sale_id = s.id;
  IF v_left <= 0 OR s.refunded + amt > s.total THEN amt := s.total - s.refunded; END IF;
  IF amt <= 0 THEN RAISE EXCEPTION 'This sale is already fully refunded'; END IF;
  v_tax := CASE WHEN s.total > 0 THEN round(s.tax * amt / s.total, 2) ELSE 0 END;
  UPDATE public.refunds SET amount = amt, cost = cst, tax = v_tax WHERE id = r;
  UPDATE public.sales SET refunded = refunded + amt,
    status = CASE WHEN v_left <= 0 OR refunded + amt >= total - 0.01 THEN 'refunded' ELSE 'partially_refunded' END WHERE id = s.id;
  RETURN json_build_object('id', r, 'number', rn, 'amount', amt);
END $$;

-- ---------- 16. Adjustments, layby, expenses, collections, stock takes: input bounds ----------
CREATE OR REPLACE FUNCTION app.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_qty numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR p_delta NOT BETWEEN -1000000 AND 1000000 THEN
    RAISE EXCEPTION 'Enter an adjustment amount between 1 and 1,000,000'; END IF;
  IF coalesce(char_length(p_note),0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  SELECT coalesce(qty, 0) INTO v_qty FROM public.store_stock WHERE store_id = p_store AND product_id = p_product;
  IF v_qty + p_delta < 0 THEN RAISE EXCEPTION 'Only % in stock — cannot remove %', v_qty, abs(p_delta); END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, p_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;

CREATE OR REPLACE FUNCTION app.layby_pay(p_token uuid, p_sale uuid, p_amount numeric, p_method text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.sales; v_pay numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL OR s.status <> 'layby_open' THEN RAISE EXCEPTION 'Layby is not open'; END IF;
  IF p_amount IS NOT NULL AND p_amount NOT BETWEEN 0 AND 10000000000 THEN RAISE EXCEPTION 'Amount must be between 0 and 10,000,000,000'; END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  v_pay := least(greatest(coalesce(p_amount, 0), 0), s.total - s.paid);
  IF v_pay <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (p_sale, v_pay, coalesce(p_method,'cash'), me.id);
  UPDATE public.sales SET paid = paid + v_pay, status = CASE WHEN paid + v_pay >= total THEN 'layby_completed' ELSE status END WHERE id = p_sale;
  RETURN (SELECT status FROM public.sales WHERE id = p_sale);
END $$;

CREATE OR REPLACE FUNCTION app.record_expense(p_token uuid, p_store uuid, p_amount numeric, p_category text, p_source text, p_note text, p_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF p_amount IS NULL OR p_amount NOT BETWEEN 0.01 AND 1000000000 THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('till','bank','mobile') THEN RAISE EXCEPTION 'Invalid source'; END IF;
  IF coalesce(char_length(p_note), 0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  IF coalesce(char_length(p_category), 0) > 60 THEN RAISE EXCEPTION 'Category is too long (max 60 characters)'; END IF;
  IF coalesce(p_category, p_note, '') ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Text contains unsupported characters'; END IF;
  INSERT INTO public.expenses(business_id, store_id, amount, category, source, note, spent_on, created_by)
    VALUES (me.business_id, p_store, p_amount, coalesce(nullif(btrim(p_category),''),'Other'), p_source,
      nullif(btrim(coalesce(p_note,'')),''), coalesce(p_date, current_date), me.id)
    RETURNING id INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.save_collection(p_token uuid, p_id uuid, p_name text, p_discount numeric, p_shared boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF coalesce(btrim(p_name),'') = '' THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF char_length(btrim(p_name)) > 120 THEN RAISE EXCEPTION 'Name is too long (max 120 characters)'; END IF;
  IF p_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Name contains unsupported characters'; END IF;
  IF p_discount IS NOT NULL AND p_discount NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Discount must be between 0 and 100 percent'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.collections(business_id, name, discount_pct, is_shared)
      VALUES (me.business_id, btrim(p_name), coalesce(p_discount, 0), coalesce(p_shared, true)) RETURNING id INTO r;
  ELSE
    UPDATE public.collections SET name = btrim(p_name), discount_pct = coalesce(p_discount, 0), is_shared = coalesce(p_shared, true)
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Unknown collection'; END IF;
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.count_stock(p_token uuid, p_take uuid, p_product uuid, p_counted numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_counted IS NULL OR p_counted NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Enter a counted quantity between 0 and 100,000,000'; END IF;
  UPDATE public.stock_take_lines l SET counted = p_counted, counted_by = me.id
   FROM public.stock_takes t WHERE t.id = l.stock_take_id AND t.id = p_take AND t.status = 'open'
     AND t.business_id = me.business_id AND l.product_id = p_product;
END $$;

CREATE OR REPLACE FUNCTION app.get_shared_collection(p_slug text) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'name', c.name, 'discount_pct', c.discount_pct, 'business', b.name, 'currency', b.currency,
    'items', coalesce((select json_agg(json_build_object('name', p.name, 'price', p.price, 'sale_price', public.effective_price(p.id)) order by p.name)
       from public.product_collections pc join public.products p on p.id = pc.product_id and p.active
       where pc.collection_id = c.id), '[]'::json))
  from public.collections c join public.businesses b on b.id = c.business_id
  where c.share_slug = btrim(coalesce(p_slug,'')) and c.is_shared
$$;

-- ---------- 17. Effective price (unchanged contract, cost-free products) ----------
CREATE OR REPLACE FUNCTION public.effective_price(p_product uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(p.price * (1 - least(100, greatest(0, coalesce((
    SELECT max(c.discount_pct) FROM public.product_collections pc JOIN public.collections c ON c.id = pc.collection_id
    WHERE pc.product_id = p.id), 0))) / 100), 2)
  FROM public.products p WHERE p.id = p_product
$$;

-- ---------- 18. Re-affirm the RPC surface: public wrappers plus app bodies ----------
-- The one new RPC the client calls needs its public wrapper.
CREATE OR REPLACE FUNCTION public.lock_all_sessions() RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.lock_all_sessions() $$;

-- Grants: the share page is the only anon callable; staff checks stay internal.
DO $$
DECLARE f record;
  anon_allow text[] := array['get_shared_collection'];
  internal_only text[] := array['require_staff','require_staff_nosub','pin_taken','subscription_active','effective_price','_move_stock'];
BEGIN
  FOR f IN
    SELECT n.nspname AS sch, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS idargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','app') AND p.prokind = 'f'
      AND p.proname <> ALL (array['my_business_id','session_role','set_ctx','shift_summary','rls_auto_enable','on_business_created','log_stock_movement','complete_subscription_payment'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM public, anon, authenticated', f.sch, f.fn, f.idargs);
    IF f.fn = ANY (anon_allow) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO anon, authenticated, service_role', f.sch, f.fn, f.idargs);
    ELSIF NOT (f.fn = ANY (internal_only)) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role', f.sch, f.fn, f.idargs);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role', f.sch, f.fn, f.idargs);
    END IF;
  END LOOP;
END $$;

-- ---------- 19. Tables stay read-only for clients: every write goes through an RPC ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated, anon, public', r.relname);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.relname);
  END LOOP;
  REVOKE ALL ON public.pin_throttle, public.product_costs, public.sale_item_costs FROM anon, public;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;

NOTIFY pgrst, 'reload schema';
