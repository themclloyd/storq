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
