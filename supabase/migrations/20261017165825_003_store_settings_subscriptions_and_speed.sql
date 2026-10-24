-- ============================================================================
-- 003 - Store settings, subscription billing shape and read-path speed
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261017165825  auto_drawer_session
--   20261017174810  cost_below_price_validation
--   20261017200047  per_store_vat_and_contacts
--   20261017224539  subscription_flexible_months
--   20261018162758  subscription_delta_pricing
--   20261018175643  per_store_catalogs
--   20261018204540  perf_fk_indexes_and_rls_initplan
-- ============================================================================

-- --- from 20261017165825_auto_drawer_session.sql --------------------------------
-- ============================================================================
-- The drawer follows the PIN session, not the staff member's memory.
--
-- Until now a shift existed only if someone opened it by hand on the Cash
-- drawer screen, and checkout attached a shift_id only when one happened to be
-- open. In practice the drawer stayed closed, the Z-report stayed empty, and
-- nothing on the till said so — the feature was forgotten because the software
-- never mentioned it.
--
-- Now the first money movement at a store opens the drawer for the staff
-- member whose PIN session recorded it (`sales.created_by` /
-- `payments.staff_id`), and every sale, layby instalment and approval
-- settlement after it attaches to that drawer. Closing stays manual: it needs
-- a real count of the notes and coins.
-- ============================================================================

-- ---------- 1. The open drawer for a store, created on first money movement ---
-- Race-safe: two tills selling at the same instant both try to open. The
-- partial unique index (one_open_shift_per_store) lets exactly one win, and the
-- loser picks up the winner's row instead of failing the sale.
CREATE OR REPLACE FUNCTION app.ensure_drawer(p_business uuid, p_store uuid, p_staff uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r uuid;
BEGIN
  SELECT id INTO r FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  IF r IS NOT NULL THEN RETURN r; END IF;
  INSERT INTO public.cash_shifts(business_id, store_id, opened_by, opening_float)
    VALUES (p_business, p_store, p_staff, 0)
    ON CONFLICT (store_id) WHERE status = 'open' DO NOTHING
    RETURNING id INTO r;
  IF r IS NULL THEN
    SELECT id INTO r FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION app.ensure_drawer(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 2. Sales: the seller's session opens the drawer -------------------
CREATE OR REPLACE FUNCTION app.attach_drawer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- An approval invoice takes no money yet; its drawer opens when it is paid.
  -- A layby with no deposit is a promise, not cash in the drawer.
  IF NEW.shift_id IS NOT NULL
     OR NEW.status = 'pending_approval'
     OR (NEW.status = 'layby_open' AND coalesce(NEW.paid, 0) <= 0) THEN
    RETURN NEW;
  END IF;
  NEW.shift_id := app.ensure_drawer(NEW.business_id, NEW.store_id, NEW.created_by);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.attach_drawer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_attach_drawer ON public.sales;
CREATE TRIGGER sales_attach_drawer BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION app.attach_drawer();

-- ---------- 3. Payments: approvals and layby instalments do too --------------
-- A checkout already carries a shift (the sale insert above opened it). These
-- two paths take money against an existing sale, so the drawer has to follow
-- the person holding the cash now.
CREATE OR REPLACE FUNCTION app.attach_drawer_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.sales; r uuid;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = NEW.sale_id;
  IF s.id IS NULL OR s.shift_id IS NOT NULL THEN RETURN NEW; END IF;
  r := app.ensure_drawer(s.business_id, s.store_id, coalesce(NEW.staff_id, s.created_by));
  IF r IS NOT NULL THEN
    UPDATE public.sales SET shift_id = r WHERE id = s.id AND shift_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.attach_drawer_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_attach_drawer ON public.payments;
CREATE TRIGGER payments_attach_drawer AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app.attach_drawer_payment();

-- ---------- 4. Starting cash stays correctable while the drawer is open ------
-- The drawer opens itself with a zero float, so the notes that were already in
-- the till at the start have to be recordable afterwards; otherwise every
-- Z-report reads "over" by the float.
CREATE OR REPLACE FUNCTION app.set_shift_float(p_token uuid, p_shift uuid, p_float numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; sh public.cash_shifts;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_float IS NULL OR p_float < 0 OR p_float > 100000000 THEN RAISE EXCEPTION 'Enter a valid starting amount'; END IF;
  SELECT * INTO sh FROM public.cash_shifts
    WHERE id = p_shift AND business_id = me.business_id AND status = 'open' FOR UPDATE;
  IF sh.id IS NULL THEN RAISE EXCEPTION 'Drawer is not open'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> sh.store_id THEN
    RAISE EXCEPTION 'You are not assigned to this store';
  END IF;
  UPDATE public.cash_shifts SET opening_float = p_float WHERE id = sh.id;
END $$;
REVOKE ALL ON FUNCTION app.set_shift_float(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_shift_float(p_token uuid, p_shift uuid, p_float numeric)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT app.set_shift_float($1,$2,$3)
$$;
REVOKE ALL ON FUNCTION public.set_shift_float(uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shift_float(uuid,uuid,numeric) TO authenticated;

-- --- from 20261017174810_cost_below_price_validation.sql ------------------------
-- Guard the source of the Dresses-class bug: an item whose buying cost meets
-- or beats its selling price poisons every report downstream (product profit
-- goes negative per unit sold) and was accepted by every entry path. Cost is
-- optional (0 = unknown), so the rule only bites when a cost is actually set.
CREATE OR REPLACE FUNCTION app.save_product(p_token uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean, p_reorder_point numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; r uuid; v_code text;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin','manager']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter an item name'; END IF;
  IF char_length(btrim(p_name)) > 200 THEN RAISE EXCEPTION 'Item name is too long (max 200 characters)'; END IF;
  IF p_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Item name contains unsupported characters'; END IF;
  v_code := nullif(btrim(coalesce(p_sku, '')), '');
  IF v_code IS NOT NULL AND (char_length(v_code) > 64 OR v_code !~ '^[A-Za-z0-9._\- ]+$') THEN
    RAISE EXCEPTION 'Item code may only contain letters, numbers, spaces and . _ - (max 64)';
  END IF;
  IF p_category IS NOT NULL AND char_length(p_category) > 120 THEN RAISE EXCEPTION 'Category is too long (max 120 characters)'; END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Selling price must be between 0 and 1,000,000,000'; END IF;
  IF p_cost IS NOT NULL AND p_cost NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Buying cost must be between 0 and 1,000,000,000'; END IF;
  IF coalesce(p_cost, 0) > 0 AND coalesce(p_cost, 0) >= p_price THEN
    RAISE EXCEPTION 'Buying cost must be below the selling price';
  END IF;
  IF p_reorder_point IS NOT NULL AND p_reorder_point NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'Reorder point must be between 0 and 1,000,000';
  END IF;

  IF p_id IS NULL THEN
    -- New item with no code: Storq assigns one, so every item is labelable and
    -- scannable from the moment it exists.
    IF v_code IS NULL THEN v_code := app.gen_item_code(me.business_id); END IF;
    BEGIN
      INSERT INTO public.products(business_id, name, sku, category, price, active, reorder_point)
        VALUES (me.business_id, btrim(p_name), v_code, nullif(btrim(p_category),''), p_price, coalesce(p_active, true), p_reorder_point)
        RETURNING id INTO r;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Another item already uses the code %', v_code;
    END;
  ELSE
    -- An edit that clears the code keeps the current one: printed labels and
    -- scanned history must stay pointing at the same item.
    BEGIN
      UPDATE public.products SET name = btrim(p_name), sku = coalesce(v_code, sku),
        category = nullif(btrim(p_category),''),
        price = p_price, active = coalesce(p_active, true), reorder_point = p_reorder_point
        WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Another item already uses the code %', v_code;
    END;
    IF r IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  END IF;
  INSERT INTO public.product_costs(product_id, cost) VALUES (r, coalesce(p_cost, 0))
    ON CONFLICT (product_id) DO UPDATE SET cost = coalesce(p_cost, 0);
  RETURN r;
END $$;

-- --- from 20261017200047_per_store_vat_and_contacts.sql -------------------------
-- ============================================================================
-- VAT belongs to the location, not the business.
--
-- A business can trade from several locations, and each till receipt must
-- carry the details of the location that issued it: phone, optional email,
-- address and optional VAT number, printed in small type. The business row
-- keeps tax_rate/tax_inclusive only as the default copied into a new location,
-- so existing locations keep charging the tax they were already charging.
-- ============================================================================

-- ---------- 1. Location columns ----------
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS tax_number text;

-- Every location starts on the rate the business was already charging.
UPDATE public.stores s
   SET tax_rate = b.tax_rate, tax_inclusive = b.tax_inclusive
  FROM public.businesses b
 WHERE b.id = s.business_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_tax_rate_range' AND conrelid = 'public.stores'::regclass
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_tax_rate_range CHECK (tax_rate BETWEEN 0 AND 50);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_contact_bounds' AND conrelid = 'public.stores'::regclass
  ) THEN
    ALTER TABLE public.stores ADD CONSTRAINT stores_contact_bounds CHECK (
      (phone IS NULL OR (char_length(phone) BETWEEN 6 AND 32 AND phone ~ '^[+0-9()\- ]+$'))
      AND (email IS NULL OR (char_length(email) <= 254 AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
      AND (address IS NULL OR char_length(address) <= 240)
      AND (tax_number IS NULL OR char_length(tax_number) <= 40)
    );
  END IF;
END $$;

-- ---------- 2. Save a location with its VAT and receipt details ----------
-- The 4-argument overload called app.save_store without validating contact
-- details, so it is replaced rather than left beside the new signature.
DROP FUNCTION IF EXISTS public.save_store(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS app.save_store(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION app.save_store(
  p_token uuid, p_id uuid, p_name text, p_type text,
  p_phone text DEFAULT NULL, p_email text DEFAULT NULL, p_address text DEFAULT NULL,
  p_tax_number text DEFAULT NULL, p_tax_rate numeric DEFAULT NULL, p_tax_inclusive boolean DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.staff; s public.subscriptions; n integer; r uuid;
  v_phone text; v_email text; v_address text; v_taxno text; v_rate numeric; v_incl boolean;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a store name'; END IF;
  IF char_length(btrim(p_name)) > 120 THEN RAISE EXCEPTION 'Store name is too long (max 120 characters)'; END IF;
  IF btrim(p_name) ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Store name contains unsupported characters'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Choose a store type'; END IF;

  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 32 OR v_phone !~ '^[+0-9()\- ]{6,32}$') THEN
    RAISE EXCEPTION 'Phone number must be 6-32 characters of digits, + ( ) - and spaces';
  END IF;
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  IF v_email IS NOT NULL AND (char_length(v_email) > 254 OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  v_address := nullif(btrim(coalesce(p_address, '')), '');
  IF v_address IS NOT NULL AND char_length(v_address) > 240 THEN
    RAISE EXCEPTION 'Location is too long (max 240 characters)';
  END IF;
  v_taxno := nullif(btrim(coalesce(p_tax_number, '')), '');
  IF v_taxno IS NOT NULL AND char_length(v_taxno) > 40 THEN
    RAISE EXCEPTION 'VAT number is too long (max 40 characters)';
  END IF;
  IF (v_email IS NOT NULL AND v_email ~ '[[:cntrl:]<>]')
     OR (v_address IS NOT NULL AND v_address ~ '[[:cntrl:]<>]')
     OR (v_taxno IS NOT NULL AND v_taxno ~ '[[:cntrl:]<>]') THEN
    RAISE EXCEPTION 'Location details contain unsupported characters';
  END IF;

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
    -- A new location inherits the business VAT default until it is changed.
    SELECT tax_rate, tax_inclusive INTO v_rate, v_incl FROM public.businesses WHERE id = me.business_id;
    IF p_tax_rate IS NOT NULL THEN v_rate := p_tax_rate; END IF;
    v_incl := coalesce(p_tax_inclusive, v_incl, true);
    IF v_rate IS NULL OR v_rate NOT BETWEEN 0 AND 50 THEN
      RAISE EXCEPTION 'Tax rate must be between 0 and 50 percent';
    END IF;
    INSERT INTO public.stores(business_id, name, store_type, phone, email, address, tax_number, tax_rate, tax_inclusive)
      VALUES (me.business_id, btrim(p_name), p_type, v_phone, v_email, v_address, v_taxno, v_rate, v_incl)
      RETURNING id INTO r;
  ELSE
    IF p_tax_rate IS NOT NULL AND (p_tax_rate < 0 OR p_tax_rate > 50) THEN
      RAISE EXCEPTION 'Tax rate must be between 0 and 50 percent';
    END IF;
    UPDATE public.stores
       SET name = btrim(p_name), store_type = p_type, phone = v_phone, email = v_email,
           address = v_address, tax_number = v_taxno,
           tax_rate = coalesce(p_tax_rate, tax_rate),
           tax_inclusive = coalesce(p_tax_inclusive, tax_inclusive)
     WHERE id = p_id AND business_id = me.business_id
     RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.save_store(
  p_token uuid, p_id uuid, p_name text, p_type text,
  p_phone text DEFAULT NULL, p_email text DEFAULT NULL, p_address text DEFAULT NULL,
  p_tax_number text DEFAULT NULL, p_tax_rate numeric DEFAULT NULL, p_tax_inclusive boolean DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT app.save_store($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) $$;

REVOKE ALL ON FUNCTION app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean) TO authenticated, service_role;

-- ---------- 3. Checkout charges the selling location's VAT ----------
-- Body copied from the working function in 20261011120000; only the tax
-- source changed from the business row to the store row.
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; st public.stores; v_gross numeric; v_disc numeric; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; v_n int; ln jsonb;
  v_pid uuid; v_name text; v_unit numeric; v_cost numeric; v_qty numeric; v_ld numeric; v_item uuid; v_dc int;
  v_nm int; v_cash numeric; v_tsum numeric; v_pm text; v_ovr numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cart must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one sale (max 500)'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$';
  IF v_lines > 0 THEN RAISE EXCEPTION 'Cart contains an item with a bad id or quantity'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x WHERE (x->>'qty')::numeric <= 0;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;

  IF p_discounts IS NOT NULL THEN
    IF jsonb_typeof(p_discounts) <> 'array' THEN RAISE EXCEPTION 'Discounts must be a list'; END IF;
    SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_discounts) d
     WHERE coalesce(jsonb_typeof(d),'') <> 'object'
        OR coalesce(d->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        OR coalesce(d->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
    IF v_lines > 0 THEN RAISE EXCEPTION 'Discounts contain a bad product or amount'; END IF;
  END IF;

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

  SELECT count(*) INTO v_matched FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id AND p.active;
  IF v_matched <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One or more items are not in your catalogue'; END IF;
  -- one cart line per product: discounts and ledger lines key on product id
  SELECT count(*) INTO v_lines FROM (
    SELECT (x->>'product_id')::uuid pid FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Merge duplicate cart lines before discounting'; END IF;

  -- gross first, then join discounts so a bad product id in p_discounts fails loudly
  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_gross
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_gross IS NULL OR v_gross NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_disc
    FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
    JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_disc < 0 OR v_disc > v_gross THEN RAISE EXCEPTION 'Discounts are larger than this sale'; END IF;
  v_sub := round(v_gross - v_disc, 2);
  IF v_sub < 0 THEN v_sub := 0; END IF;

  -- cashier discount cap: 10% of a line, or 10% of the cart — else a manager PIN must verify
  IF v_disc > 0 AND me.role = 'cashier' THEN
    IF (v_gross > 0 AND v_disc > round(v_gross * 0.10, 2)) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
      JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.business_id = me.business_id
      JOIN jsonb_array_elements(p_items) x ON (x->>'product_id')::uuid = p.id
      WHERE (d->>'amount')::numeric > round(public.effective_price(p.id) * (x->>'qty')::numeric * 0.10, 2)) THEN
      IF p_override_pin IS NULL OR p_override_pin !~ '^[0-9]{4,8}$' THEN
        RAISE EXCEPTION 'That discount needs a manager PIN';
      END IF;
      SELECT count(*) INTO v_dc FROM public.staff
       WHERE business_id = me.business_id AND active AND role IN ('admin','manager')
         AND pin_hash = extensions.crypt(p_override_pin, pin_hash);
      IF v_dc = 0 THEN RAISE EXCEPTION 'Wrong manager PIN for this discount'; END IF;
    END IF;
  END IF;

  IF st.tax_rate > 0 AND st.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + st.tax_rate/100), 2);
  ELSIF st.tax_rate > 0 THEN v_tax := round(v_sub * st.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;

  v_status := CASE WHEN st.store_type = 'approval' THEN 'pending_approval' WHEN p_kind = 'layby' THEN 'layby_open' ELSE 'completed' END;

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

  -- tenders: one or more cash/card/mobile lines; a completed sale may overpay
  -- in cash for change but never beyond twice the bill
  v_nm := 0; v_cash := 0; v_tsum := 0;
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) = 'array' THEN
    v_n := jsonb_array_length(p_tenders);
    IF v_n > 10 THEN RAISE EXCEPTION 'Too many tenders on one sale (max 10)'; END IF;
    IF v_n > 0 THEN
      SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_tenders) t
       WHERE coalesce(jsonb_typeof(t),'') <> 'object'
          OR coalesce(t->>'method','') NOT IN ('cash','card','mobile')
          OR coalesce(t->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
          OR (t->>'amount')::numeric <= 0;
      IF v_lines > 0 THEN RAISE EXCEPTION 'A tender has an unknown method or a bad amount'; END IF;
    END IF;
    SELECT count(DISTINCT t->>'method'), coalesce(sum((t->>'amount')::numeric), 0),
           coalesce(sum((t->>'amount')::numeric) FILTER (WHERE t->>'method' = 'cash'), 0)
      INTO v_nm, v_tsum, v_cash FROM jsonb_array_elements(p_tenders) t;
    IF v_n > 0 THEN
      IF v_status = 'completed' THEN
        IF v_tsum < v_total THEN RAISE EXCEPTION 'Tenders do not cover the total'; END IF;
        IF v_tsum > v_total * 2 THEN RAISE EXCEPTION 'Cash tender is far above the total'; END IF;
      ELSIF v_tsum > v_total THEN
        RAISE EXCEPTION 'Tenders exceed the invoice total';
      END IF;
    END IF;
  END IF;
  IF v_nm = 0 THEN v_tsum := least(greatest(coalesce(p_payment, 0), 0), v_total); v_cash := v_tsum; END IF;

  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  IF v_status = 'completed' THEN
    v_pay := v_total;
    IF v_cash < v_total THEN v_cash := v_total; END IF;
  ELSE
    v_pay := v_tsum;
  END IF;

  v_pm := CASE WHEN v_nm > 1 THEN 'split'
    WHEN v_nm = 1 THEN (SELECT min(t->>'method') FROM jsonb_array_elements(p_tenders) t)
    ELSE coalesce(p_method,'cash') END;

  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, discount, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax, v_disc,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, v_pm,
      nullif(btrim(coalesce(p_customer_name,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
      nullif(btrim(coalesce(p_note,'')),''), me.id, v_shift)
    RETURNING id, number INTO v_sale, v_num;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT p.id, p.name, public.effective_price(p.id), coalesce(pc.cost, 0)
      INTO v_pid, v_name, v_unit, v_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = (ln->>'product_id')::uuid AND p.business_id = me.business_id;
    v_qty := (ln->>'qty')::numeric;
    SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_ld
      FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d WHERE (d->>'product_id')::uuid = v_pid;
    IF v_ld > v_unit * v_qty THEN v_ld := v_unit * v_qty; END IF;
    INSERT INTO public.sale_items(sale_id, product_id, name, qty, price, discount)
      VALUES (v_sale, v_pid, v_name, v_qty,
        CASE WHEN v_qty > 0 THEN round((v_unit * v_qty - v_ld) / v_qty, 2) ELSE 0 END, v_ld)
      RETURNING id INTO v_item;
    INSERT INTO public.sale_item_costs(sale_item_id, cost) VALUES (v_item, v_cost);
  END LOOP;

  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_nm > 0 AND v_tsum > 0 THEN
      IF v_status = 'completed' AND v_cash > 0 AND v_tsum > v_total AND v_cash > v_total - (v_tsum - v_cash) THEN
        v_ovr := v_tsum - v_total;
        INSERT INTO public.payments(sale_id, amount, method, staff_id)
          SELECT v_sale, greatest(GREATEST((t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END, 0), 0), t->>'method', me.id
          FROM jsonb_array_elements(p_tenders) t
          WHERE (t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END > 0;
      ELSE
        INSERT INTO public.payments(sale_id, amount, method, staff_id)
          SELECT v_sale, (t->>'amount')::numeric, t->>'method', me.id FROM jsonb_array_elements(p_tenders) t WHERE (t->>'amount')::numeric > 0;
      END IF;
    ELSIF v_pay > 0 THEN
      INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (v_sale, v_pay, coalesce(v_pm,'cash'), me.id);
    END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax, 'discount', v_disc);
END $$;

-- CREATE OR REPLACE keeps the existing ACL row; re-affirm it so the grant is
-- explicit in case an earlier apply missed.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.save_store(uuid,uuid,text,text,text,text,text,text,numeric,boolean)',
    'public.save_store(uuid,uuid,text,text,text,text,text,text,numeric,boolean)',
    'app.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- --- from 20261017224539_subscription_flexible_months.sql -----------------------
-- Allow any whole number of months (1–24) for subscription payments.
-- The old p_period text ('monthly'/'yearly') is replaced by p_months integer.
-- Yearly discount (15%) kicks in at 12+ months so existing behaviour is preserved.
-- Old function signatures are kept as wrappers for any cached clients.

CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token    uuid,
  p_months   integer,  -- 1–24
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  st  public.staff;
  s   public.subscriptions;
  n   integer;
  amt numeric;
  ref text;
  monthly_rate numeric;
  discount numeric;
BEGIN
  st := public.require_staff_nosub(p_token, ARRAY['admin','manager']);
  SELECT * INTO s FROM public.subscriptions WHERE business_id = st.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Months must be between 1 and 24';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid currency';
  END IF;

  SELECT greatest(count(*), 1) INTO n FROM public.stores WHERE business_id = st.business_id;
  IF p_stores IS NULL OR p_stores < n OR p_stores > 1000
     OR (s.paid_until > now() AND p_stores < s.paid_store_limit) THEN
    RAISE EXCEPTION 'Store capacity must cover existing stores and active paid slots (maximum 1000)';
  END IF;

  monthly_rate := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END;
  -- 15% discount for 12 or more months
  discount := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  amt := round(monthly_rate * p_stores * p_months * discount, 2);

  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_payments
    (tx_ref, business_id, period, currency, amount, stores, created_by)
  VALUES
    (ref, st.business_id, p_months::text, p_currency, amt, p_stores, st.id);

  RETURN json_build_object(
    'tx_ref',    ref,
    'amount',    amt,
    'currency',  p_currency,
    'stores',    p_stores,
    'months',    p_months
  );
END $$;

REVOKE ALL ON FUNCTION app.start_store_subscription_payment(uuid,integer,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app.start_store_subscription_payment(uuid,integer,text,integer) TO authenticated,service_role;

-- Public wrapper
CREATE OR REPLACE FUNCTION public.start_store_subscription_payment(
  p_token    uuid,
  p_months   integer,
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE sql SET search_path=public AS $$
  SELECT app.start_store_subscription_payment($1,$2,$3,$4);
$$;
REVOKE ALL ON FUNCTION public.start_store_subscription_payment(uuid,integer,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_store_subscription_payment(uuid,integer,text,integer) TO authenticated,service_role;

-- complete_subscription_payment: period column now stores the month count as text
-- e.g. '1', '3', '6', '12'. Old rows have 'monthly'/'yearly' — handle both.
CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p           public.subscription_payments;
  s           public.subscriptions;
  target      integer;
  old_slots   integer;
  remaining   double precision;
  duration    double precision;
  p_months    integer;
  monthly_rate numeric;
  discount    numeric;
  expected_amt numeric;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;
  IF p.status <> 'pending' OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid subscription payment';
  END IF;

  -- Resolve months from the period column (new integer-as-text, or legacy strings)
  p_months := CASE
    WHEN p.period = 'monthly' THEN 1
    WHEN p.period = 'yearly'  THEN 12
    ELSE p.period::integer
  END;

  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  -- Re-derive expected amount server-side to prevent tampering
  monthly_rate := CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END;
  discount     := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  expected_amt := round(monthly_rate * p.stores * p_months * discount, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  old_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  target    := greatest(p.stores, old_slots);

  -- Credit remaining prepaid time proportionally across new slot count
  remaining := greatest(0,
    extract(epoch FROM (coalesce(s.paid_until, now()) - now()))
  ) * old_slots / NULLIF(target, 0);

  -- New duration: p_months × ~30.44 days, scaled by store ratio
  duration := extract(epoch FROM (
    now() + make_interval(months => p_months) - now()
  )) * p.stores / NULLIF(target, 0);

  UPDATE public.subscriptions
     SET paid_until       = now() + make_interval(secs => remaining + duration),
         paid_store_limit = target,
         plan             = CASE WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;

REVOKE ALL ON FUNCTION public.complete_subscription_payment(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_payment(text) TO service_role;

-- --- from 20261018162758_subscription_delta_pricing.sql -------------------------
-- Delta pricing: a payment is charged only for the slots it actually buys.
--
-- Before, `start_store_subscription_payment` priced `rate × p_stores × months` on the
-- TOTAL capacity, so raising 1 paid slot to 2 slots re-charged the slot that was
-- already paid for. `complete_subscription_payment` then divided the remaining
-- prepaid time by the new slot count, so the customer also lost runway.
--
-- Now the charged slot count is snapshotted on the payment row as `billed_stores`:
--   * capacity increase on an active subscription → p_stores − paid_store_limit
--   * renewal, first payment or reactivation      → p_stores
-- Completing a capacity purchase leaves the existing expiry alone and only extends
-- it if the new slots paid for a longer term — prepaid time is never clawed back.
-- A renewal still adds its months on top of the current expiry. "Renew and add" is
-- not one purchase: each flow makes its own payment with its own snapshot.

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS billed_stores integer NOT NULL DEFAULT 1;

-- Every historical row was priced on its full slot count, so keep it equal there.
UPDATE public.subscription_payments SET billed_stores = stores WHERE billed_stores <> stores;

ALTER TABLE public.subscription_payments DROP CONSTRAINT IF EXISTS sub_payments_billed_bounds;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT sub_payments_billed_bounds
  CHECK (billed_stores BETWEEN 1 AND 1000 AND billed_stores <= stores);

CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token    uuid,
  p_months   integer,  -- 1–24
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  st  public.staff;
  s   public.subscriptions;
  n   integer;
  amt numeric;
  ref text;
  monthly_rate numeric;
  discount numeric;
  paid_slots integer;
  billed     integer;
BEGIN
  st := public.require_staff_nosub(p_token, ARRAY['admin','manager']);
  SELECT * INTO s FROM public.subscriptions WHERE business_id = st.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Months must be between 1 and 24';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid currency';
  END IF;

  SELECT greatest(count(*), 1) INTO n FROM public.stores WHERE business_id = st.business_id;
  IF p_stores IS NULL OR p_stores < n OR p_stores > 1000
     OR (s.paid_until > now() AND p_stores < s.paid_store_limit) THEN
    RAISE EXCEPTION 'Store capacity must cover existing stores and active paid slots (maximum 1000)';
  END IF;

  -- Slots already covered by a payment. An expired subscription owes nothing, so a
  -- reactivation is again priced on the full capacity.
  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  billed := CASE WHEN paid_slots > 0 AND p_stores > paid_slots
                 THEN p_stores - paid_slots
                 ELSE p_stores END;

  monthly_rate := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END;
  -- 15% discount for 12 or more months
  discount := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  amt := round(monthly_rate * billed * p_months * discount, 2);

  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_payments
    (tx_ref, business_id, period, currency, amount, stores, billed_stores, created_by)
  VALUES
    (ref, st.business_id, p_months::text, p_currency, amt, p_stores, billed, st.id);

  RETURN json_build_object(
    'tx_ref',        ref,
    'amount',        amt,
    'currency',      p_currency,
    'stores',        p_stores,
    'billed_stores', billed,
    'months',        p_months
  );
END $$;

-- Legacy period-based overload: keep the signature for cached clients, but route it
-- through the pricing above so it can never charge the full capacity again.
CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token    uuid,
  p_period   text,
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT app.start_store_subscription_payment(
    $1,
    CASE WHEN $2 = 'yearly' THEN 12 WHEN $2 = 'monthly' THEN 1 ELSE NULL END::integer,
    $3,
    $4
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p           public.subscription_payments;
  s           public.subscriptions;
  target      integer;
  paid_slots  integer;
  billed      integer;
  p_months    integer;
  monthly_rate numeric;
  discount    numeric;
  expected_amt numeric;
  new_until   timestamptz;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;
  IF p.status <> 'pending' OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid subscription payment';
  END IF;

  -- Resolve months from the period column (new integer-as-text, or legacy strings)
  p_months := CASE
    WHEN p.period = 'monthly' THEN 1
    WHEN p.period = 'yearly'  THEN 12
    ELSE p.period::integer
  END;

  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  -- Re-derive expected amount server-side from the snapshot to prevent tampering.
  -- Rows written before billed_stores existed are validated on their full count.
  billed := coalesce(p.billed_stores, p.stores);
  IF billed < 1 OR billed > p.stores THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;

  monthly_rate := CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END;
  discount     := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  expected_amt := round(monthly_rate * billed * p_months * discount, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  target     := greatest(p.stores, paid_slots);

  new_until := CASE
    -- Capacity purchase: the slots already paid for keep their full runway, and the
    -- new ones are active for the term they bought. Never moves the expiry earlier.
    WHEN billed < p.stores AND s.paid_until > now()
      THEN greatest(s.paid_until, now() + make_interval(months => p_months))
    -- Renewal / first payment / reactivation: add the term to the current expiry.
    ELSE greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => p_months)
  END;

  UPDATE public.subscriptions
     SET paid_until       = new_until,
         paid_store_limit = target,
         plan             = CASE WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;

-- --- from 20261018175643_per_store_catalogs.sql ---------------------------------
-- ============================================================================
-- Per-store catalogs: stop inventory/items from leaking across locations.
--
-- Today `products` has only `business_id` (one shared catalog per business), so
-- the Inventory/Stocktake/Till screens list every store's items regardless of
-- the selected store. This migration makes each product row belong to exactly
-- one store (`products.store_id`), copies every existing business-wide item
-- into EVERY store of its business (so nothing disappears and each store owns
-- an independent copy with its own price/cost/stock), and scopes every read and
-- write path to the current store. Transfers are reworked so receiving a
-- transfer creates/uses a matching item in the destination store's own catalog.
--
-- All writes stay in SECURITY DEFINER RPCs behind require_staff; tables remain
-- read-only via RLS. Item codes become unique per store (copies share a code).
-- ============================================================================

-- ---------- 1. Add the ownership column, then relax code uniqueness --------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS store_id uuid;

-- Codes are shared across a business's stores once items are copied per store,
-- so the per-business unique code index must go before copies are inserted.
DROP INDEX IF EXISTS public.products_business_code_key;

-- ---------- 2. Copy every product into every store of its business ----------
-- The store_stock ledger trigger would fire on the balance repoint below, so it
-- is suspended for the data migration and restored at the end of the section.
ALTER TABLE public.store_stock DISABLE TRIGGER store_stock_ledger;

-- Home store = oldest store of the business. The original row is reused as the
-- home store's copy; every other store gets a fresh copy row.
CREATE TEMP TABLE prod_home ON COMMIT DROP AS
SELECT p.id AS product_id,
  (SELECT s.id FROM public.stores s
    WHERE s.business_id = p.business_id ORDER BY s.created_at, s.id LIMIT 1) AS home_store
FROM public.products p;

-- Full (product, store) -> owning product id map. Home maps to the original id.
CREATE TEMP TABLE prod_map (old_id uuid, store_id uuid, new_id uuid) ON COMMIT DROP;
INSERT INTO prod_map (old_id, store_id, new_id)
SELECT p.id, s.id, CASE WHEN s.id = ph.home_store THEN p.id ELSE NULL::uuid END
FROM public.products p
JOIN public.stores s ON s.business_id = p.business_id
JOIN prod_home ph ON ph.product_id = p.id;
UPDATE prod_map SET new_id = gen_random_uuid() WHERE new_id IS NULL;

-- Insert the non-home copies (same attributes; created_at preserved for order).
INSERT INTO public.products(id, business_id, store_id, name, sku, category, price, active, created_at, reorder_point)
SELECT m.new_id, p.business_id, m.store_id, p.name, p.sku, p.category, p.price, p.active, p.created_at, p.reorder_point
FROM prod_map m JOIN public.products p ON p.id = m.old_id
WHERE m.new_id <> m.old_id;

-- Buying cost follows each copy.
INSERT INTO public.product_costs(product_id, cost)
SELECT m.new_id, pc.cost
FROM prod_map m JOIN public.product_costs pc ON pc.product_id = m.old_id
WHERE m.new_id <> m.old_id
ON CONFLICT (product_id) DO NOTHING;

-- Collection membership follows each copy.
INSERT INTO public.product_collections(collection_id, product_id)
SELECT pc.collection_id, m.new_id
FROM prod_map m JOIN public.product_collections pc ON pc.product_id = m.old_id
WHERE m.new_id <> m.old_id
  AND NOT EXISTS (SELECT 1 FROM public.product_collections x
    WHERE x.collection_id = pc.collection_id AND x.product_id = m.new_id);

-- Originals take their home store id (copies were inserted with theirs).
UPDATE public.products p SET store_id = ph.home_store FROM prod_home ph
WHERE p.id = ph.product_id;

-- Repoint every reference to the copy that owns its store: current balances,
-- sale/refund lines, stocktake lines, and in-transit transfer lines.
UPDATE public.store_stock ss SET product_id = m.new_id
FROM prod_map m WHERE m.old_id = ss.product_id AND m.store_id = ss.store_id;

-- A target row of an UPDATE may not be referenced from a JOIN's ON clause, so
-- the joined table is a comma FROM item and its link rides in the WHERE list.
UPDATE public.sale_items si SET product_id = m.new_id
FROM prod_map m, public.sales s
WHERE s.id = si.sale_id AND m.old_id = si.product_id AND m.store_id = s.store_id;

UPDATE public.refund_items ri SET product_id = m.new_id
FROM prod_map m, public.refunds r
WHERE r.id = ri.refund_id AND m.old_id = ri.product_id AND m.store_id = r.store_id;

UPDATE public.stock_take_lines l SET product_id = m.new_id
FROM prod_map m, public.stock_takes t
WHERE t.id = l.stock_take_id AND m.old_id = l.product_id AND m.store_id = t.store_id;

UPDATE public.stock_transfer_lines l SET product_id = m.new_id
FROM prod_map m, public.stock_transfers t
WHERE t.id = l.transfer_id AND m.old_id = l.product_id AND m.store_id = t.from_store;

ALTER TABLE public.store_stock ENABLE TRIGGER store_stock_ledger;

-- ---------- 3. Enforce ownership + per-store indexes ------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_store_id_fkey') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE public.products ALTER COLUMN store_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_store_code_key
  ON public.products (store_id, lower(btrim(sku)))
  WHERE sku IS NOT NULL AND btrim(sku) <> '';
CREATE INDEX IF NOT EXISTS products_store_name_idx ON public.products (store_id, name);

COMMENT ON COLUMN public.products.store_id IS 'The single store that owns this item copy. Every catalog read/write is scoped to it.';
COMMENT ON COLUMN public.products.sku IS 'The one item code: SKU, barcode and QR payload. Unique per store (case-insensitive), auto-generated when left blank on create.';

-- ---------- 4. Cashier read scoping helper + products RLS -------------------
CREATE OR REPLACE FUNCTION app.session_store() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.store_id
  FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
  WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active
  ORDER BY ss.expires_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.session_store() FROM public, anon;
GRANT EXECUTE ON FUNCTION app.session_store() TO authenticated, service_role;

DROP POLICY IF EXISTS "own products" ON public.products;
CREATE POLICY "own products" ON public.products FOR SELECT TO authenticated
  USING (business_id = app.my_business_id()
    AND app.session_role() = ANY (ARRAY['admin','manager','cashier'])
    AND (app.session_role() <> 'cashier' OR app.session_store() IS NULL
      OR store_id = app.session_store()));

-- ---------- 5. gen_item_code: now unique within a store ---------------------
-- The parameter is renamed from p_business to p_store, which CREATE OR REPLACE
-- cannot do in place, so the existing overload is dropped first.
DROP FUNCTION IF EXISTS app.gen_item_code(uuid);
CREATE OR REPLACE FUNCTION app.gen_item_code(p_store uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_try text; v_i int;
BEGIN
  FOR v_i IN 1..20 LOOP
    v_try := 'S' || translate(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
      '0123456789abcdef',
      '23456789ABCDEFGH'
    );
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE store_id = p_store AND lower(btrim(sku)) = lower(v_try)
    ) THEN
      RETURN v_try;
    END IF;
  END LOOP;
  RETURN 'S' || translate(replace(gen_random_uuid()::text, '-', ''), '0123456789abcdef', '23456789ABCDEFGH');
END $$;

-- ---------- 6. save_product: takes a store, owns the item to that store ------
DROP FUNCTION IF EXISTS app.save_product(uuid, uuid, text, text, text, numeric, numeric, boolean, numeric);
DROP FUNCTION IF EXISTS public.save_product(uuid, uuid, text, text, text, numeric, numeric, boolean, numeric);

CREATE OR REPLACE FUNCTION app.save_product(p_token uuid, p_store uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean, p_reorder_point numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; r uuid; v_code text;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin','manager']);
  IF p_store IS NULL OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN
    RAISE EXCEPTION 'Unknown store';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter an item name'; END IF;
  IF char_length(btrim(p_name)) > 200 THEN RAISE EXCEPTION 'Item name is too long (max 200 characters)'; END IF;
  IF p_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Item name contains unsupported characters'; END IF;
  v_code := nullif(btrim(coalesce(p_sku, '')), '');
  IF v_code IS NOT NULL AND (char_length(v_code) > 64 OR v_code !~ '^[A-Za-z0-9._\- ]+$') THEN
    RAISE EXCEPTION 'Item code may only contain letters, numbers, spaces and . _ - (max 64)';
  END IF;
  IF p_category IS NOT NULL AND char_length(p_category) > 120 THEN RAISE EXCEPTION 'Category is too long (max 120 characters)'; END IF;
  IF p_price IS NULL OR p_price NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Selling price must be between 0 and 1,000,000,000'; END IF;
  IF p_cost IS NOT NULL AND p_cost NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Buying cost must be between 0 and 1,000,000,000'; END IF;
  IF coalesce(p_cost, 0) > 0 AND coalesce(p_cost, 0) >= p_price THEN
    RAISE EXCEPTION 'Buying cost must be below the selling price';
  END IF;
  IF p_reorder_point IS NOT NULL AND p_reorder_point NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'Reorder point must be between 0 and 1,000,000';
  END IF;

  IF p_id IS NULL THEN
    -- New item with no code: Storq assigns one unique inside this store.
    IF v_code IS NULL THEN v_code := app.gen_item_code(p_store); END IF;
    BEGIN
      INSERT INTO public.products(business_id, store_id, name, sku, category, price, active, reorder_point)
        VALUES (me.business_id, p_store, btrim(p_name), v_code, nullif(btrim(p_category),''), p_price, coalesce(p_active, true), p_reorder_point)
        RETURNING id INTO r;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Another item in this store already uses the code %', v_code;
    END;
  ELSE
    -- The edit may only touch this store's own item copy.
    BEGIN
      UPDATE public.products SET name = btrim(p_name), sku = coalesce(v_code, sku),
        category = nullif(btrim(p_category),''),
        price = p_price, active = coalesce(p_active, true), reorder_point = p_reorder_point
        WHERE id = p_id AND store_id = p_store RETURNING id INTO r;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Another item in this store already uses the code %', v_code;
    END;
    IF r IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  END IF;
  INSERT INTO public.product_costs(product_id, cost) VALUES (r, coalesce(p_cost, 0))
    ON CONFLICT (product_id) DO UPDATE SET cost = coalesce(p_cost, 0);
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.save_product(p_token uuid, p_store uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean, p_reorder_point numeric DEFAULT NULL)
RETURNS uuid LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.save_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) $$;

-- ---------- 7. Checkout: items must belong to the selling store -------------
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; st public.stores; v_gross numeric; v_disc numeric; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; v_n int; ln jsonb;
  v_pid uuid; v_name text; v_unit numeric; v_cost numeric; v_qty numeric; v_ld numeric; v_item uuid; v_dc int;
  v_nm int; v_cash numeric; v_tsum numeric; v_pm text; v_ovr numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cart must be a list of items'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines on one sale (max 500)'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$';
  IF v_lines > 0 THEN RAISE EXCEPTION 'Cart contains an item with a bad id or quantity'; END IF;
  SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_items) x WHERE (x->>'qty')::numeric <= 0;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;

  IF p_discounts IS NOT NULL THEN
    IF jsonb_typeof(p_discounts) <> 'array' THEN RAISE EXCEPTION 'Discounts must be a list'; END IF;
    SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_discounts) d
     WHERE coalesce(jsonb_typeof(d),'') <> 'object'
        OR coalesce(d->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        OR coalesce(d->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
    IF v_lines > 0 THEN RAISE EXCEPTION 'Discounts contain a bad product or amount'; END IF;
  END IF;

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

  SELECT count(*) INTO v_matched FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.store_id = p_store AND p.active;
  IF v_matched <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One or more items are not in your catalogue'; END IF;
  -- one cart line per product: discounts and ledger lines key on product id
  SELECT count(*) INTO v_lines FROM (
    SELECT (x->>'product_id')::uuid pid FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Merge duplicate cart lines before discounting'; END IF;

  -- gross first, then join discounts so a bad product id in p_discounts fails loudly
  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_gross
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.store_id = p_store;
  IF v_gross IS NULL OR v_gross NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_disc
    FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
    JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.store_id = p_store;
  IF v_disc < 0 OR v_disc > v_gross THEN RAISE EXCEPTION 'Discounts are larger than this sale'; END IF;
  v_sub := round(v_gross - v_disc, 2);
  IF v_sub < 0 THEN v_sub := 0; END IF;

  -- cashier discount cap: 10% of a line, or 10% of the cart — else a manager PIN must verify
  IF v_disc > 0 AND me.role = 'cashier' THEN
    IF (v_gross > 0 AND v_disc > round(v_gross * 0.10, 2)) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
      JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.store_id = p_store
      JOIN jsonb_array_elements(p_items) x ON (x->>'product_id')::uuid = p.id
      WHERE (d->>'amount')::numeric > round(public.effective_price(p.id) * (x->>'qty')::numeric * 0.10, 2)) THEN
      IF p_override_pin IS NULL OR p_override_pin !~ '^[0-9]{4,8}$' THEN
        RAISE EXCEPTION 'That discount needs a manager PIN';
      END IF;
      SELECT count(*) INTO v_dc FROM public.staff
       WHERE business_id = me.business_id AND active AND role IN ('admin','manager')
         AND pin_hash = extensions.crypt(p_override_pin, pin_hash);
      IF v_dc = 0 THEN RAISE EXCEPTION 'Wrong manager PIN for this discount'; END IF;
    END IF;
  END IF;

  IF st.tax_rate > 0 AND st.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + st.tax_rate/100), 2);
  ELSIF st.tax_rate > 0 THEN v_tax := round(v_sub * st.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;

  v_status := CASE WHEN st.store_type = 'approval' THEN 'pending_approval' WHEN p_kind = 'layby' THEN 'layby_open' ELSE 'completed' END;

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

  -- tenders: one or more cash/card/mobile lines; a completed sale may overpay
  -- in cash for change but never beyond twice the bill
  v_nm := 0; v_cash := 0; v_tsum := 0;
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) = 'array' THEN
    v_n := jsonb_array_length(p_tenders);
    IF v_n > 10 THEN RAISE EXCEPTION 'Too many tenders on one sale (max 10)'; END IF;
    IF v_n > 0 THEN
      SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_tenders) t
       WHERE coalesce(jsonb_typeof(t),'') <> 'object'
          OR coalesce(t->>'method','') NOT IN ('cash','card','mobile')
          OR coalesce(t->>'amount','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
          OR (t->>'amount')::numeric <= 0;
      IF v_lines > 0 THEN RAISE EXCEPTION 'A tender has an unknown method or a bad amount'; END IF;
    END IF;
    SELECT count(DISTINCT t->>'method'), coalesce(sum((t->>'amount')::numeric), 0),
           coalesce(sum((t->>'amount')::numeric) FILTER (WHERE t->>'method' = 'cash'), 0)
      INTO v_nm, v_tsum, v_cash FROM jsonb_array_elements(p_tenders) t;
    IF v_n > 0 THEN
      IF v_status = 'completed' THEN
        IF v_tsum < v_total THEN RAISE EXCEPTION 'Tenders do not cover the total'; END IF;
        IF v_tsum > v_total * 2 THEN RAISE EXCEPTION 'Cash tender is far above the total'; END IF;
      ELSIF v_tsum > v_total THEN
        RAISE EXCEPTION 'Tenders exceed the invoice total';
      END IF;
    END IF;
  END IF;
  IF v_nm = 0 THEN v_tsum := least(greatest(coalesce(p_payment, 0), 0), v_total); v_cash := v_tsum; END IF;

  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  IF v_status = 'completed' THEN
    v_pay := v_total;
    IF v_cash < v_total THEN v_cash := v_total; END IF;
  ELSE
    v_pay := v_tsum;
  END IF;

  v_pm := CASE WHEN v_nm > 1 THEN 'split'
    WHEN v_nm = 1 THEN (SELECT min(t->>'method') FROM jsonb_array_elements(p_tenders) t)
    ELSE coalesce(p_method,'cash') END;

  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, discount, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax, v_disc,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, v_pm,
      nullif(btrim(coalesce(p_customer_name,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
      nullif(btrim(coalesce(p_note,'')),''), me.id, v_shift)
    RETURNING id, number INTO v_sale, v_num;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT p.id, p.name, public.effective_price(p.id), coalesce(pc.cost, 0)
      INTO v_pid, v_name, v_unit, v_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = (ln->>'product_id')::uuid AND p.store_id = p_store;
    v_qty := (ln->>'qty')::numeric;
    SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_ld
      FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d WHERE (d->>'product_id')::uuid = v_pid;
    IF v_ld > v_unit * v_qty THEN v_ld := v_unit * v_qty; END IF;
    INSERT INTO public.sale_items(sale_id, product_id, name, qty, price, discount)
      VALUES (v_sale, v_pid, v_name, v_qty,
        CASE WHEN v_qty > 0 THEN round((v_unit * v_qty - v_ld) / v_qty, 2) ELSE 0 END, v_ld)
      RETURNING id INTO v_item;
    INSERT INTO public.sale_item_costs(sale_item_id, cost) VALUES (v_item, v_cost);
  END LOOP;

  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_nm > 0 AND v_tsum > 0 THEN
      IF v_status = 'completed' AND v_cash > 0 AND v_tsum > v_total AND v_cash > v_total - (v_tsum - v_cash) THEN
        v_ovr := v_tsum - v_total;
        INSERT INTO public.payments(sale_id, amount, method, staff_id)
          SELECT v_sale, greatest(GREATEST((t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END, 0), 0), t->>'method', me.id
          FROM jsonb_array_elements(p_tenders) t
          WHERE (t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END > 0;
      ELSE
        INSERT INTO public.payments(sale_id, amount, method, staff_id)
          SELECT v_sale, (t->>'amount')::numeric, t->>'method', me.id FROM jsonb_array_elements(p_tenders) t WHERE (t->>'amount')::numeric > 0;
      END IF;
    ELSIF v_pay > 0 THEN
      INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (v_sale, v_pay, coalesce(v_pm,'cash'), me.id);
    END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax, 'discount', v_disc);
END $$;

CREATE OR REPLACE FUNCTION public.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
RETURNS json LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.checkout($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) $$;

-- ---------- 8. Stock writes: the product must belong to the store ------------
CREATE OR REPLACE FUNCTION app.set_stock_qty(p_token uuid, p_store uuid, p_product uuid, p_qty numeric, p_reason text, p_note text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_cur numeric; v_delta numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND store_id = p_store) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_qty IS NULL OR p_qty < 0 OR p_qty > 100000000 THEN RAISE EXCEPTION 'Quantity must be between 0 and 100,000,000'; END IF;
  IF p_qty <> round(p_qty, 2) THEN RAISE EXCEPTION 'Quantity can have at most 2 decimal places'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  IF coalesce(char_length(p_note),0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_store::text || ':' || p_product::text));
  SELECT qty INTO v_cur FROM public.store_stock WHERE store_id = p_store AND product_id = p_product FOR UPDATE;
  v_delta := round(p_qty, 2) - coalesce(v_cur, 0);
  IF v_delta = 0 THEN RETURN coalesce(v_cur, 0); END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, v_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  RETURN coalesce(v_cur, 0) + v_delta;
END $$;

CREATE OR REPLACE FUNCTION public.set_stock_qty(p_token uuid, p_store uuid, p_product uuid, p_qty numeric, p_reason text, p_note text)
RETURNS numeric LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.set_stock_qty($1,$2,$3,$4,$5,$6) $$;

CREATE OR REPLACE FUNCTION app.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_qty numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND store_id = p_store) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  IF p_delta IS NULL OR p_delta = 0 OR p_delta NOT BETWEEN -1000000 AND 1000000 THEN
    RAISE EXCEPTION 'Enter an adjustment amount between 1 and 1,000,000'; END IF;
  IF coalesce(char_length(p_note),0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_store::text || ':' || p_product::text));
  SELECT coalesce(qty, 0) INTO v_qty FROM public.store_stock WHERE store_id = p_store AND product_id = p_product FOR UPDATE;
  v_qty := coalesce(v_qty, 0);
  IF v_qty + p_delta < 0 THEN RAISE EXCEPTION 'Only % in stock — cannot remove %', v_qty, abs(p_delta); END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, p_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.adjust_stock_reason($1,$2,$3,$4,$5,$6) $$;

-- ---------- 9. low_stock + start_stock_take: scoped to the store ------------
CREATE OR REPLACE FUNCTION app.low_stock(p_token uuid, p_store uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r json;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  SELECT coalesce(json_agg(json_build_object(
      'product_id', t.id, 'name', t.name, 'sku', t.sku,
      'qty', t.qty, 'reorder_point', t.reorder_point, 'shortfall', t.reorder_point - t.qty
    ) ORDER BY t.reorder_point - t.qty DESC, t.name), '[]'::json) INTO r
  FROM (
    SELECT p.id, p.name, p.sku, coalesce(ss.qty, 0) AS qty, p.reorder_point
    FROM public.products p
    LEFT JOIN public.store_stock ss ON ss.product_id = p.id AND ss.store_id = p_store
    WHERE p.store_id = p_store AND p.active AND p.reorder_point IS NOT NULL
      AND coalesce(ss.qty, 0) <= p.reorder_point
  ) t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.low_stock(p_token uuid, p_store uuid)
RETURNS json LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT app.low_stock($1,$2) $$;

CREATE OR REPLACE FUNCTION app.start_stock_take(p_token uuid, p_store uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; t uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF EXISTS (SELECT 1 FROM public.stock_takes WHERE store_id = p_store AND status = 'open') THEN RAISE EXCEPTION 'A stock take is already open for this store'; END IF;
  INSERT INTO public.stock_takes(business_id, store_id, started_by) VALUES (me.business_id, p_store, me.id) RETURNING id INTO t;
  INSERT INTO public.stock_take_lines(stock_take_id, product_id, expected)
    SELECT t, p.id, coalesce(ss.qty, 0) FROM public.products p
      LEFT JOIN public.store_stock ss ON ss.product_id = p.id AND ss.store_id = p_store
     WHERE p.store_id = p_store AND p.active;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.start_stock_take(p_token uuid, p_store uuid)
RETURNS uuid LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.start_stock_take($1,$2) $$;

-- ---------- 10. Transfers: source item belongs to the origin, receive copies --
-- The origin item must be one the source store actually owns.
CREATE OR REPLACE FUNCTION app.create_transfer(p_token uuid, p_from uuid, p_to uuid, p_items jsonb, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_id uuid; v_qty numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'Pick two different stores'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_from AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown source store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_to AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown destination store'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Add at least one item to transfer'; END IF;
  IF jsonb_array_length(p_items) > 200 THEN RAISE EXCEPTION 'Too many lines on one transfer (max 200)'; END IF;
  IF coalesce(char_length(p_note), 0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  SELECT count(*) INTO v_qty FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$'
      OR (x->>'qty')::numeric <= 0;
  IF v_qty > 0 THEN RAISE EXCEPTION 'Transfer lines need a catalogue item and a quantity above zero'; END IF;
  SELECT count(*) INTO v_qty FROM (SELECT (x->>'product_id')::uuid pid FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d;
  IF v_qty > 0 THEN RAISE EXCEPTION 'Merge duplicate product lines on the transfer'; END IF;
  SELECT count(*) INTO v_qty FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid
   WHERE p.store_id <> p_from OR NOT p.active;
  IF v_qty > 0 THEN RAISE EXCEPTION 'One or more items are not in the source store'; END IF;
  SELECT string_agg(p.name, ', ') INTO v_qty FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid
    LEFT JOIN public.store_stock ss ON ss.product_id = (x->>'product_id')::uuid AND ss.store_id = p_from
   WHERE coalesce(ss.qty, 0) < (x->>'qty')::numeric;
  IF v_qty IS NOT NULL THEN RAISE EXCEPTION 'Not enough stock at the source store for: %', v_qty; END IF;

  INSERT INTO public.stock_transfers(business_id, from_store, to_store, status, note, created_by)
    VALUES (me.business_id, p_from, p_to, 'in_transit', nullif(btrim(coalesce(p_note,'')),''), me.id)
    RETURNING id INTO v_id;
  INSERT INTO public.stock_transfer_lines(transfer_id, product_id, qty)
    SELECT v_id, (x->>'product_id')::uuid, (x->>'qty')::numeric FROM jsonb_array_elements(p_items) x;

  PERFORM app.set_ctx('transfer_out', v_id, 'Transfer ' || (SELECT t.number FROM public.stock_transfers t WHERE t.id = v_id));
  INSERT INTO public.store_stock(store_id, product_id, qty)
    SELECT p_from, l.product_id, -l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = v_id
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_transfer(p_token uuid, p_from uuid, p_to uuid, p_items jsonb, p_note text)
RETURNS uuid LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.create_transfer($1,$2,$3,$4,$5) $$;

-- Receive: for each line, find (or create) the matching item in the DESTINATION
-- store's own catalog, then book the units against that copy.
CREATE OR REPLACE FUNCTION app.receive_transfer(p_token uuid, p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; t public.stock_transfers; r record; src public.products; v_dst uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_id AND business_id = me.business_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status <> 'in_transit' THEN RAISE EXCEPTION 'Transfer is not in transit'; END IF;
  IF me.role = 'manager' AND me.store_id IS NOT NULL AND me.store_id <> t.to_store THEN RAISE EXCEPTION 'You are not assigned to the destination store'; END IF;
  PERFORM app.set_ctx('transfer_in', p_id, 'Transfer ' || t.number);
  FOR r IN SELECT l.product_id AS src_id, l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = p_id LOOP
    SELECT * INTO src FROM public.products WHERE id = r.src_id;
    -- Prefer a same-code match, else a same-name item, already in the destination.
    SELECT p.id INTO v_dst FROM public.products p
      WHERE p.store_id = t.to_store
        AND ( (src.sku IS NOT NULL AND btrim(src.sku) <> '' AND lower(btrim(p.sku)) = lower(btrim(src.sku)))
              OR p.name = src.name )
      ORDER BY (src.sku IS NOT NULL AND btrim(src.sku) <> '' AND lower(btrim(p.sku)) = lower(btrim(src.sku))) DESC NULLS LAST, p.name
      LIMIT 1;
    IF v_dst IS NULL THEN
      INSERT INTO public.products(business_id, store_id, name, sku, category, price, active, reorder_point)
        VALUES (me.business_id, t.to_store, src.name, src.sku, src.category, src.price, src.active, src.reorder_point)
        RETURNING id INTO v_dst;
      INSERT INTO public.product_costs(product_id, cost)
        SELECT v_dst, pc.cost FROM public.product_costs pc WHERE pc.product_id = src.id
        ON CONFLICT (product_id) DO NOTHING;
    END IF;
    INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (t.to_store, v_dst, r.qty)
      ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  END LOOP;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  UPDATE public.stock_transfers SET status = 'received', received_by = me.id, received_at = now() WHERE id = p_id;
  RETURN 'received';
END $$;

CREATE OR REPLACE FUNCTION public.receive_transfer(p_token uuid, p_id uuid)
RETURNS text LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.receive_transfer($1,$2) $$;

-- ---------- 11. Shared collection: collapse per-store copies to one line -----
CREATE OR REPLACE FUNCTION app.get_shared_collection(p_slug text) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'name', c.name, 'discount_pct', c.discount_pct, 'business', b.name, 'currency', b.currency,
    'items', coalesce((select json_agg(json_build_object('name', d.name, 'price', d.price, 'sale_price', public.effective_price(d.id)) order by d.name)
       from (
         select distinct on (lower(btrim(p.name)), p.price) p.id, p.name, p.price
         from public.product_collections pc join public.products p on p.id = pc.product_id and p.active
         where pc.collection_id = c.id
         order by lower(btrim(p.name)), p.price, p.id
       ) d), '[]'::json))
  from public.collections c join public.businesses b on b.id = c.business_id
  where c.share_slug = btrim(coalesce(p_slug,'')) and c.is_shared
$$;

CREATE OR REPLACE FUNCTION public.get_shared_collection(p_slug text) RETURNS json
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT app.get_shared_collection($1) $$;

-- ---------- 12. Re-affirm the RPC surface for everything changed above -------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.save_product(uuid,uuid,uuid,text,text,text,numeric,numeric,boolean,numeric)',
    'public.save_product(uuid,uuid,uuid,text,text,text,numeric,numeric,boolean,numeric)',
    'app.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'public.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'app.set_stock_qty(uuid,uuid,uuid,numeric,text,text)',
    'public.set_stock_qty(uuid,uuid,uuid,numeric,text,text)',
    'app.adjust_stock_reason(uuid,uuid,uuid,numeric,text,text)',
    'public.adjust_stock_reason(uuid,uuid,uuid,numeric,text,text)',
    'app.low_stock(uuid,uuid)',
    'public.low_stock(uuid,uuid)',
    'app.start_stock_take(uuid,uuid)',
    'public.start_stock_take(uuid,uuid)',
    'app.create_transfer(uuid,uuid,uuid,jsonb,text)',
    'public.create_transfer(uuid,uuid,uuid,jsonb,text)',
    'app.receive_transfer(uuid,uuid)',
    'public.receive_transfer(uuid,uuid)',
    'app.gen_item_code(uuid)',
    'app.session_store()',
    'app.get_shared_collection(text)',
    'public.get_shared_collection(text)'] LOOP
    IF f LIKE 'app.gen_item_code%' OR f = 'app.session_store()' THEN
      EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
    ELSE
      EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon, authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- --- from 20261018204540_perf_fk_indexes_and_rls_initplan.sql -------------------
-- Covering indexes on unindexed foreign keys (Supabase perf advisor: 25 findings).
-- FK columns on the child side are JOINed/CASCADEd constantly (sales, payments,
-- refunds, stock ledger, approval queues) yet had no leading index, forcing seq
-- scans as tenants grow. Plain btree per column; IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS cash_movements_staff_id_idx ON public.cash_movements (staff_id);
CREATE INDEX IF NOT EXISTS cash_shifts_business_id_idx ON public.cash_shifts (business_id);
CREATE INDEX IF NOT EXISTS cash_shifts_closed_by_idx ON public.cash_shifts (closed_by);
CREATE INDEX IF NOT EXISTS cash_shifts_opened_by_idx ON public.cash_shifts (opened_by);
CREATE INDEX IF NOT EXISTS expenses_created_by_idx ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS payments_staff_id_idx ON public.payments (staff_id);
CREATE INDEX IF NOT EXISTS refund_items_product_id_idx ON public.refund_items (product_id);
CREATE INDEX IF NOT EXISTS refund_items_sale_item_id_idx ON public.refund_items (sale_item_id);
CREATE INDEX IF NOT EXISTS refunds_shift_id_idx ON public.refunds (shift_id);
CREATE INDEX IF NOT EXISTS refunds_staff_id_idx ON public.refunds (staff_id);
CREATE INDEX IF NOT EXISTS sales_approved_by_idx ON public.sales (approved_by);
CREATE INDEX IF NOT EXISTS sales_created_by_idx ON public.sales (created_by);
CREATE INDEX IF NOT EXISTS staff_store_id_idx ON public.staff (store_id);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_id_idx ON public.staff_sessions (staff_id);
CREATE INDEX IF NOT EXISTS stock_movements_product_id_idx ON public.stock_movements (product_id);
CREATE INDEX IF NOT EXISTS stock_movements_staff_id_idx ON public.stock_movements (staff_id);
CREATE INDEX IF NOT EXISTS stock_take_lines_counted_by_idx ON public.stock_take_lines (counted_by);
CREATE INDEX IF NOT EXISTS stock_take_lines_product_id_idx ON public.stock_take_lines (product_id);
CREATE INDEX IF NOT EXISTS stock_takes_business_id_idx ON public.stock_takes (business_id);
CREATE INDEX IF NOT EXISTS stock_takes_closed_by_idx ON public.stock_takes (closed_by);
CREATE INDEX IF NOT EXISTS stock_takes_started_by_idx ON public.stock_takes (started_by);
CREATE INDEX IF NOT EXISTS stock_transfer_lines_product_id_idx ON public.stock_transfer_lines (product_id);
CREATE INDEX IF NOT EXISTS stock_transfers_created_by_idx ON public.stock_transfers (created_by);
CREATE INDEX IF NOT EXISTS stock_transfers_received_by_idx ON public.stock_transfers (received_by);
CREATE INDEX IF NOT EXISTS subscription_payments_created_by_idx ON public.subscription_payments (created_by);

-- RLS initplan (perf advisor WARN): auth.uid() was re-evaluated per row on the
-- hottest read policy. Wrapping it in a scalar subquery makes Postgres evaluate
-- it once per statement. Same predicate, same security, just an initplan.
DROP POLICY IF EXISTS "own business" ON public.businesses;
CREATE POLICY "own business" ON public.businesses FOR SELECT TO authenticated USING (owner_id = (select auth.uid()));

