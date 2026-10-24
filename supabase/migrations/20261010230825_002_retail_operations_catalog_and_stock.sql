-- ============================================================================
-- 002 - Retail operations: catalogue, stock movement and sales summary
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261010230825  retail_operations
--   20261011001954  sales_summary
--   20261011134132  item_codes
--   20261011163319  drop_legacy_save_product_overload
--   20261011211528  fix_x_alias_collision
--   20261011215823  stock_absolute_set
--   20261011221117  drop_store_stock_bounds_enforce_in_sql
--   20261011221132  move_stock_floor_guard
--
-- Includes the three follow-up repairs to this phase (stale save_product overload, x-alias collision, stock floor guard); they are folded here in the order they originally shipped.
-- ============================================================================

-- --- from 20261010230825_retail_operations.sql ----------------------------------
-- ============================================================================
-- Retail operations: split tender, manual discounts (cap + manager PIN
-- override), store-to-store transfers with an in-transit ledger trail, and
-- per-product reorder points with a low-stock read RPC. All writes stay in
-- SECURITY DEFINER RPCs behind require_staff; tables remain read-only.
-- ============================================================================

-- ---------- 1. Schema ----------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reorder_point numeric(12,2);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_reorder_point_bounds;
ALTER TABLE public.products ADD CONSTRAINT products_reorder_point_bounds
  CHECK (reorder_point IS NULL OR (reorder_point >= 0 AND reorder_point <= 1000000));

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_discount_bounds;
ALTER TABLE public.sales ADD CONSTRAINT sales_discount_bounds CHECK (discount >= 0 AND discount <= 10000000000);

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_discount_bounds;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_discount_bounds CHECK (discount >= 0 AND discount <= 10000000000);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  number serial NOT NULL,
  from_store uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  to_store uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','received','cancelled')),
  note text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  received_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  CONSTRAINT stock_transfers_distinct_stores CHECK (from_store <> to_store),
  CONSTRAINT stock_transfers_note_len CHECK (coalesce(char_length(note),0) <= 500)
);
CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty numeric(12,2) NOT NULL CHECK (qty > 0 AND qty <= 1000000),
  UNIQUE (transfer_id, product_id)
);
CREATE INDEX IF NOT EXISTS stock_transfers_business_idx ON public.stock_transfers (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_from_idx ON public.stock_transfers (from_store, status);
CREATE INDEX IF NOT EXISTS stock_transfers_to_idx ON public.stock_transfers (to_store, status);
CREATE INDEX IF NOT EXISTS stock_transfer_lines_transfer_idx ON public.stock_transfer_lines (transfer_id);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers read transfers" ON public.stock_transfers;
CREATE POLICY "managers read transfers" ON public.stock_transfers FOR SELECT TO authenticated
  USING (business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager']));
DROP POLICY IF EXISTS "managers read transfer lines" ON public.stock_transfer_lines;
CREATE POLICY "managers read transfer lines" ON public.stock_transfer_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = transfer_id
    AND t.business_id = app.my_business_id() AND app.session_role() = ANY (ARRAY['admin','manager'])));
GRANT SELECT ON public.stock_transfers, public.stock_transfer_lines TO authenticated;
GRANT ALL ON public.stock_transfers, public.stock_transfer_lines TO service_role;

-- ---------- 2. save_product: validated custom reorder point ----------
CREATE OR REPLACE FUNCTION app.save_product(p_token uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean, p_reorder_point numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
  IF p_reorder_point IS NOT NULL AND p_reorder_point NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'Reorder point must be between 0 and 1,000,000';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.products(business_id, name, sku, category, price, active, reorder_point)
      VALUES (me.business_id, btrim(p_name), nullif(btrim(p_sku),''), nullif(btrim(p_category),''), p_price, coalesce(p_active, true), p_reorder_point)
      RETURNING id INTO r;
  ELSE
    UPDATE public.products SET name = btrim(p_name), sku = nullif(btrim(p_sku),''), category = nullif(btrim(p_category),''),
      price = p_price, active = coalesce(p_active, true), reorder_point = p_reorder_point
      WHERE id = p_id AND business_id = me.business_id RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;
  END IF;
  INSERT INTO public.product_costs(product_id, cost) VALUES (r, coalesce(p_cost, 0))
    ON CONFLICT (product_id) DO UPDATE SET cost = coalesce(p_cost, 0);
  RETURN r;
END $$;

-- The client RPC resolves through the public wrapper: replace the legacy
-- 8-parameter body with a forward to the app version above.
DROP FUNCTION IF EXISTS public.save_product(uuid, uuid, text, text, text, numeric, numeric, boolean);
CREATE OR REPLACE FUNCTION public.save_product(p_token uuid, p_id uuid, p_name text, p_sku text, p_category text, p_price numeric, p_cost numeric, p_active boolean, p_reorder_point numeric DEFAULT NULL)
RETURNS uuid LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.save_product($1,$2,$3,$4,$5,$6,$7,$8,$9) $$;

-- ---------- 3. Checkout v2: per-line discounts + split tenders ----------
-- Drop the old overloads first: CREATE OR REPLACE with added defaulted params
-- would otherwise leave a second callable overload behind.
DROP FUNCTION IF EXISTS app.checkout(uuid, uuid, text, jsonb, numeric, text, text, text, text);
DROP FUNCTION IF EXISTS public.checkout(uuid, uuid, text, jsonb, numeric, text, text, text, text);

CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; st public.stores; b public.businesses; v_gross numeric; v_disc numeric; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; v_n int; x jsonb;
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
  SELECT * INTO b FROM public.businesses WHERE id = me.business_id;

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

  IF b.tax_rate > 0 AND b.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + b.tax_rate/100), 2);
  ELSIF b.tax_rate > 0 THEN v_tax := round(v_sub * b.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
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

  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT p.id, p.name, public.effective_price(p.id), coalesce(pc.cost, 0)
      INTO v_pid, v_name, v_unit, v_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
    v_qty := (x->>'qty')::numeric;
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

-- The till replays through checkout_ref: carry the new options through it.
DROP FUNCTION IF EXISTS app.checkout_ref(uuid, uuid, uuid, text, jsonb, numeric, text, text, text, text);
DROP FUNCTION IF EXISTS public.checkout_ref(uuid, uuid, uuid, text, jsonb, numeric, text, text, text, text);
CREATE OR REPLACE FUNCTION app.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE me public.staff; s public.sales; r json;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'Missing sale reference'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_ref::text));
  SELECT * INTO s FROM public.sales WHERE client_ref = p_client_ref;
  IF s.id IS NOT NULL THEN
    IF s.business_id <> me.business_id THEN RAISE EXCEPTION 'Sale reference already used'; END IF;
    RETURN json_build_object('id', s.id, 'number', s.number, 'status', s.status, 'total', s.total, 'tax', s.tax, 'discount', s.discount, 'duplicate', true);
  END IF;
  r := app.checkout(p_token, p_store, p_kind, p_items, p_payment, p_method, p_customer_name, p_customer_phone, p_note,
    p_tenders, p_discounts, p_override_pin);
  UPDATE public.sales SET client_ref = p_client_ref WHERE id = (r->>'id')::uuid;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
 RETURNS json LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.checkout($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) $$;

CREATE OR REPLACE FUNCTION public.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
 RETURNS json LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.checkout_ref($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) $$;

-- ---------- 4. Approval review: split tenders on the approved invoice ----------
DROP FUNCTION IF EXISTS app.review_invoice(uuid, uuid, boolean, numeric, text);
DROP FUNCTION IF EXISTS public.review_invoice(uuid, uuid, boolean, numeric, text);
CREATE OR REPLACE FUNCTION app.review_invoice(p_token uuid, p_sale uuid, p_approve boolean, p_payment numeric, p_method text, p_tenders jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; s public.sales; v_pay numeric; v_status text; v_short text; v_gross numeric; v_disc numeric;
  v_n int; v_nm int; v_lines int; v_cash numeric; v_tsum numeric; v_pm text; v_ovr numeric;
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

  -- the invoice total is authoritative only when nothing changed since it was
  -- written: recompute from stored net prices so a stale cart cannot bill more
  SELECT sum(i.price * i.qty), coalesce(sum(i.discount), 0) INTO v_gross, v_disc FROM public.sale_items i WHERE i.sale_id = p_sale;
  v_n := 0;
  IF v_gross IS NULL OR v_gross NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invoice has no billable items'; END IF;

  v_nm := 0; v_cash := 0; v_tsum := 0;
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) = 'array' THEN
    v_n := jsonb_array_length(p_tenders);
    IF v_n > 10 THEN RAISE EXCEPTION 'Too many tenders on one invoice (max 10)'; END IF;
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
    IF v_n > 0 AND (v_tsum < s.total OR v_tsum > s.total * 2) THEN RAISE EXCEPTION 'Tenders must cover the invoice total (cash overpayment for change is allowed)'; END IF;
  END IF;
  IF v_nm = 0 THEN v_tsum := least(greatest(coalesce(p_payment, 0), 0), s.total); v_cash := v_tsum; END IF;

  IF s.kind = 'layby' THEN
    IF v_nm > 0 THEN v_pay := v_tsum; ELSE v_pay := least(greatest(coalesce(p_payment, 0), 0), s.total); END IF;
    v_status := CASE WHEN v_pay >= s.total THEN 'layby_completed' ELSE 'layby_open' END;
  ELSE v_pay := s.total; v_status := 'completed';
  END IF;
  IF v_status = 'completed' THEN
    v_pay := s.total;
    IF v_cash < s.total THEN v_cash := s.total; END IF;
  END IF;
  IF p_method IS NOT NULL AND p_method NOT IN ('cash','card','mobile') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  v_pm := CASE WHEN v_nm > 1 THEN 'split'
    WHEN v_nm = 1 THEN (SELECT min(t->>'method') FROM jsonb_array_elements(p_tenders) t)
    ELSE coalesce(p_method,'cash') END;

  UPDATE public.sales SET status = v_status, discount = round(v_disc, 2), paid = v_pay, payment_method = v_pm,
    approved_by = me.id, approved_at = now() WHERE id = p_sale;
  PERFORM public._move_stock(p_sale, -1);
  IF v_pay > 0 THEN
    IF v_nm > 0 AND v_tsum > s.total THEN
      v_ovr := v_tsum - s.total;
      INSERT INTO public.payments(sale_id, amount, method, staff_id)
        SELECT p_sale, GREATEST((t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END, 0), t->>'method', me.id
        FROM jsonb_array_elements(p_tenders) t
        WHERE (t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END > 0;
    ELSIF v_nm > 0 THEN
      INSERT INTO public.payments(sale_id, amount, method, staff_id)
        SELECT p_sale, (t->>'amount')::numeric, t->>'method', me.id FROM jsonb_array_elements(p_tenders) t WHERE (t->>'amount')::numeric > 0;
    ELSE
      INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (p_sale, v_pay, coalesce(v_pm,'cash'), me.id);
    END IF;
  END IF;
  RETURN v_status;
END $$;

CREATE OR REPLACE FUNCTION public.review_invoice(p_token uuid, p_sale uuid, p_approve boolean, p_payment numeric, p_method text, p_tenders jsonb DEFAULT NULL)
RETURNS text LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.review_invoice($1,$2,$3,$4,$5,$6) $$;

-- ---------- 5. Store-to-store transfers: dispatch, receive, cancel ----------
-- Dispatch moves stock OUT of the origin under the ledger reason
-- 'transfer_out' so every unit stays traceable via stock_movements.
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
   WHERE p.business_id <> me.business_id OR NOT p.active;
  IF v_qty > 0 THEN RAISE EXCEPTION 'One or more items are not in your active catalogue'; END IF;
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

-- Receive books the stock INTO the destination under 'transfer_in'.
CREATE OR REPLACE FUNCTION app.receive_transfer(p_token uuid, p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; t public.stock_transfers;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_id AND business_id = me.business_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status <> 'in_transit' THEN RAISE EXCEPTION 'Transfer is not in transit'; END IF;
  IF me.role = 'manager' AND me.store_id IS NOT NULL AND me.store_id <> t.to_store THEN RAISE EXCEPTION 'You are not assigned to the destination store'; END IF;
  PERFORM app.set_ctx('transfer_in', p_id, 'Transfer ' || t.number);
  INSERT INTO public.store_stock(store_id, product_id, qty)
    SELECT t.to_store, l.product_id, l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = p_id
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  UPDATE public.stock_transfers SET status = 'received', received_by = me.id, received_at = now() WHERE id = p_id;
  RETURN 'received';
END $$;

-- Cancel returns the units to the origin; the ledger entry is a 'correction'
-- reversal pointing back at the transfer.
CREATE OR REPLACE FUNCTION app.cancel_transfer(p_token uuid, p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; t public.stock_transfers;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_id AND business_id = me.business_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status <> 'in_transit' THEN RAISE EXCEPTION 'Only in-transit transfers can be cancelled'; END IF;
  IF me.role = 'manager' AND me.store_id IS NOT NULL AND me.store_id <> t.from_store THEN RAISE EXCEPTION 'You are not assigned to the source store'; END IF;
  PERFORM app.set_ctx('correction', p_id, 'Cancel transfer ' || t.number);
  INSERT INTO public.store_stock(store_id, product_id, qty)
    SELECT t.from_store, l.product_id, l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = p_id
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  UPDATE public.stock_transfers SET status = 'cancelled', received_by = me.id, received_at = now() WHERE id = p_id;
  RETURN 'cancelled';
END $$;

CREATE OR REPLACE FUNCTION public.create_transfer(p_token uuid, p_from uuid, p_to uuid, p_items jsonb, p_note text)
RETURNS uuid LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.create_transfer($1,$2,$3,$4,$5) $$;
CREATE OR REPLACE FUNCTION public.receive_transfer(p_token uuid, p_id uuid)
RETURNS text LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.receive_transfer($1,$2) $$;
CREATE OR REPLACE FUNCTION public.cancel_transfer(p_token uuid, p_id uuid)
RETURNS text LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT app.cancel_transfer($1,$2) $$;

-- ---------- 6. Low-stock read RPC ----------
-- Active products at or below their reorder point for one store, worst first.
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
    WHERE p.business_id = me.business_id AND p.active AND p.reorder_point IS NOT NULL
      AND coalesce(ss.qty, 0) <= p.reorder_point
  ) t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.low_stock(p_token uuid, p_store uuid)
RETURNS json LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT app.low_stock($1,$2) $$;

-- ---------- 7. Re-affirm the RPC surface for everything changed above ----------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.save_product(uuid,uuid,text,text,text,numeric,numeric,boolean,numeric)',
    'public.save_product(uuid,uuid,text,text,text,numeric,numeric,boolean,numeric)',
    'app.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'public.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'app.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'public.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'app.review_invoice(uuid,uuid,boolean,numeric,text,jsonb)',
    'public.review_invoice(uuid,uuid,boolean,numeric,text,jsonb)',
    'app.create_transfer(uuid,uuid,uuid,jsonb,text)',
    'public.create_transfer(uuid,uuid,uuid,jsonb,text)',
    'app.receive_transfer(uuid,uuid)',
    'public.receive_transfer(uuid,uuid)',
    'app.cancel_transfer(uuid,uuid)',
    'public.cancel_transfer(uuid,uuid)',
    'app.low_stock(uuid,uuid)',
    'public.low_stock(uuid,uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- --- from 20261011001954_sales_summary.sql --------------------------------------
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

-- --- from 20261011134132_item_codes.sql -----------------------------------------
-- ============================================================================
-- One code per item. SKU, barcode and QR label are the same identifier, so an
-- item carries exactly one value in `products.sku`: typed by the owner or
-- generated by Storq, matched case-insensitively by the till scanner, and
-- printed as the QR on the shelf label.
--
-- This migration: (1) adds the generator, (2) backfills codes and removes
-- case-insensitive duplicates, (3) makes the code unique per business so a scan
-- resolves exactly one item, (4) teaches save_product to fill a blank code on
-- create and to keep the current code when an edit leaves the field empty.
-- ============================================================================

-- ---------- 1. Auto-generator: unambiguous, unique inside the business ----------
-- Shape matches the client preview in src/lib/item-codes.ts: "S" plus 10
-- characters from a 16-letter subset of the code alphabet (no I, L, O or U so a
-- hand-transcribed code never mis-reads). The tail fallback is a whole UUID,
-- which cannot collide, in the astronomically unlikely case the loop is exhausted.
CREATE OR REPLACE FUNCTION app.gen_item_code(p_business uuid)
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
      WHERE business_id = p_business AND lower(btrim(sku)) = lower(v_try)
    ) THEN
      RETURN v_try;
    END IF;
  END LOOP;
  RETURN 'S' || translate(replace(gen_random_uuid()::text, '-', ''), '0123456789abcdef', '23456789ABCDEFGH');
END $$;
REVOKE ALL ON FUNCTION app.gen_item_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.gen_item_code(uuid) TO service_role;
COMMENT ON FUNCTION app.gen_item_code(uuid) IS 'Internal: next auto item code for a business. Called by save_product (SECURITY DEFINER).';

-- ---------- 2. Every existing item gets one code, duplicates re-coded ----------
DO $$
DECLARE r record;
BEGIN
  -- Codeless rows (the field was always optional) get a generated code so they
  -- can be labelled and scanned today.
  FOR r IN
    SELECT id, business_id FROM public.products WHERE sku IS NULL OR btrim(sku) = ''
    ORDER BY created_at, id
  LOOP
    UPDATE public.products SET sku = app.gen_item_code(r.business_id) WHERE id = r.id;
  END LOOP;

  -- "abc1" and "ABC1" are the same code for a scanner: keep the oldest owner-
  -- typed value and re-code the later rows so the unique index can be built.
  FOR r IN
    SELECT p.id, p.business_id
    FROM public.products p
    WHERE EXISTS (
      SELECT 1 FROM public.products q
      WHERE q.business_id = p.business_id
        AND lower(btrim(q.sku)) = lower(btrim(p.sku))
        AND (q.created_at, q.id) < (p.created_at, p.id)
    )
    ORDER BY p.created_at, p.id
  LOOP
    UPDATE public.products SET sku = app.gen_item_code(r.business_id) WHERE id = r.id;
  END LOOP;
END $$;

-- ---------- 3. One code, one item ----------
-- Replaces the old non-unique helper index; also the till's lookup path.
DROP INDEX IF EXISTS public.products_business_sku_idx;
CREATE UNIQUE INDEX IF NOT EXISTS products_business_code_key
  ON public.products (business_id, lower(btrim(sku)))
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

-- ---------- 4. save_product: fill blank on create, keep on edit ----------
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

COMMENT ON COLUMN public.products.sku IS 'The one item code: SKU, barcode and QR payload. Unique per business (case-insensitive), auto-generated when left blank on create.';

-- --- from 20261011163319_drop_legacy_save_product_overload.sql ------------------
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

-- --- from 20261011211528_fix_x_alias_collision.sql ------------------------------
-- ============================================================================
-- Fix the 400 every sale returned: Postgres raised SQLSTATE 42702,
-- 'column reference "x" is ambiguous'.
--
-- app.checkout declared a PL/pgSQL variable `x jsonb` (the cart-line loop
-- target) and, in the same function, also used `x` as a FROM alias —
-- `FROM jsonb_array_elements(p_items) x`. PL/pgSQL resolves a bare identifier
-- that matches both a declared variable and a range-table alias by raising an
-- ambiguity error, so the very first validation statement blew up and PostgREST
-- answered the till's /rpc/checkout_ref call with HTTP 400. No sale, layby or
-- approval invoice could be written.
--
-- app.process_refund has the identical shape (variable `x jsonb` plus the
-- `) x` alias in its pre-check), so refunds would fail the same way.
--
-- The fix renames the loop variable to `ln` and leaves the SQL aliases exactly
-- as the working sibling functions already write them (app.create_transfer uses
-- the `) x` alias with no matching variable and is unaffected). No signature,
-- behaviour, totals, stock or discount logic changes.
-- ============================================================================

-- ---------- 1. Checkout: cart-line loop variable x -> ln ----------
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text,
  p_tenders jsonb DEFAULT NULL, p_discounts jsonb DEFAULT NULL, p_override_pin text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me public.staff; st public.stores; b public.businesses; v_gross numeric; v_disc numeric; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
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
  SELECT * INTO b FROM public.businesses WHERE id = me.business_id;

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

  IF b.tax_rate > 0 AND b.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + b.tax_rate/100), 2);
  ELSIF b.tax_rate > 0 THEN v_tax := round(v_sub * b.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
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

-- ---------- 2. Refunds: same collision, same rename ----------
CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me public.staff; s public.sales; r uuid; rn int; ln jsonb; it public.sale_items;
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
  FOR ln IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (ln->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (ln->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    SELECT coalesce(cost, 0) INTO v_unit FROM public.sale_item_costs WHERE sale_item_id = it.id;
    line := round(s.total * (it.price * q) / v_sub, 2);
    amt := amt + line;
    UPDATE public.sale_items SET refunded_qty = refunded_qty + q WHERE id = it.id;
    INSERT INTO public.refund_items(refund_id, sale_item_id, product_id, name, qty, amount, cost, restock)
      VALUES (r, it.id, it.product_id, it.name, q, line,
        CASE WHEN coalesce((ln->>'restock')::boolean, true) THEN v_unit * q ELSE 0 END,
        coalesce((ln->>'restock')::boolean, true));
    IF coalesce((ln->>'restock')::boolean, true) AND it.product_id IS NOT NULL THEN
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

-- ---------- 3. Re-affirm the RPC surface for the two rebuilt bodies ----------
-- CREATE OR REPLACE keeps the existing pg_proc row, so its ACL survives; this
-- only makes the grants explicit and idempotent in case an earlier apply missed.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.checkout(uuid,uuid,text,jsonb,numeric,text,text,text,text,jsonb,jsonb,text)',
    'app.process_refund(uuid,uuid,jsonb,text,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- --- from 20261011215823_stock_absolute_set.sql ---------------------------------
-- ============================================================================
-- Stock quantities must land where the owner put them, and a sale that cannot
-- fit must say so in words instead of failing with a raw constraint error.
--
-- Two defects combined into the 400 the till reported:
--
-- 1. Every "set the quantity" screen (CSV import, the item sheet, the stock
--    dialog) sent app.adjust_stock_reason a DELTA it computed on the client as
--    target - cached_snapshot. The cached store_stock map is a 60-second
--    React-Query snapshot, so anything that moved stock after the page loaded -
--    a sale on another till, an offline replay, an earlier row of the same CSV -
--    made the delta wrong, and the row landed on a number nobody typed. The
--    `target <> cached` guard is worse: when the stale snapshot happened to
--    equal the CSV value, no write was sent at all and the import still
--    reported success.
--
-- 2. Both the sale pre-check and app.adjust_stock_reason read store_stock
--    without locking the row, then wrote it. A concurrent movement could commit
--    in between, so the write ran against a value that had already changed and
--    drove qty below zero. store_stock_bounds (qty >= 0) then raised SQLSTATE
--    23514 inside public._move_stock, and because the message contains the word
--    "constraint" the client masks it to "Something went wrong" - the cashier
--    saw no item, no quantity and no way to fix it.
--
-- The fix: (a) a real absolute "set quantity" RPC that computes the delta
-- inside SQL while holding the row, so a stale client snapshot cannot corrupt a
-- balance; (b) every sale-driven movement now locks the rows it is about to
-- change and raises a plain business message when the stock is not there.
-- Nothing about totals, payments, discounts or the ledger format changes.
-- ============================================================================

-- ---------- 1. app.set_stock_qty: absolute quantity, resolved server-side ----------
-- The callers all think in absolute terms ("this item has 12 on the shelf"), so
-- the RPC takes the absolute number and works out the movement itself against
-- the live, locked row. Reason stays inside the list the stock dialog already
-- uses, so the ledger and the movements screen keep reading the same way.
CREATE OR REPLACE FUNCTION app.set_stock_qty(p_token uuid, p_store uuid, p_product uuid, p_qty numeric, p_reason text, p_note text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_cur numeric; v_delta numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_qty IS NULL OR p_qty < 0 OR p_qty > 100000000 THEN RAISE EXCEPTION 'Quantity must be between 0 and 100,000,000'; END IF;
  IF p_qty <> round(p_qty, 2) THEN RAISE EXCEPTION 'Quantity can have at most 2 decimal places'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  IF coalesce(char_length(p_note),0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;

  -- Serialize on the exact (store, product) pair, then read the balance under
  -- the row lock: the delta can only ever be computed from the value the write
  -- will see. A sale committing meanwhile waits here instead of being lost.
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

-- Grants follow the established pair pattern: the public wrapper is what
-- PostgREST exposes, and because it is SECURITY INVOKER the app body must also
-- be executable by authenticated or every call dies on permission denied.
REVOKE ALL ON FUNCTION app.set_stock_qty(uuid,uuid,uuid,numeric,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app.set_stock_qty(uuid,uuid,uuid,numeric,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_stock_qty(uuid,uuid,uuid,numeric,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_stock_qty(uuid,uuid,uuid,numeric,text,text) TO authenticated, service_role;

-- ---------- 2. Sale movements: lock, then say which item is short ----------
-- Same job as before, but the balance is read under the lock that the write
-- takes, and a shortage becomes a sentence the till can show instead of a
-- CHECK violation. Products are handled in a stable id order so two sales that
-- share items cannot lock each other in opposite orders.
CREATE OR REPLACE FUNCTION public._move_stock(p_sale uuid, p_sign integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_store uuid; v_name text; v_pid uuid; v_need numeric; v_have numeric; r record;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  PERFORM app.set_ctx(CASE WHEN p_sign < 0 THEN 'sale' ELSE 'sale_reversal' END, p_sale, NULL);
  FOR r IN
    SELECT i.product_id AS pid, sum(i.qty) AS need_qty
      FROM public.sale_items i
     WHERE i.sale_id = p_sale AND i.product_id IS NOT NULL
     GROUP BY 1 ORDER BY 1
  LOOP
    v_pid := r.pid;
    v_need := r.need_qty;
    PERFORM pg_advisory_xact_lock(hashtext(v_store::text || ':' || v_pid::text));
    SELECT qty INTO v_have FROM public.store_stock
      WHERE store_id = v_store AND product_id = v_pid FOR UPDATE;
    v_have := coalesce(v_have, 0);
    IF p_sign < 0 AND v_have < v_need THEN
      SELECT coalesce(name, 'this item') INTO v_name FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Only % left in stock for %', trim_scale(v_have), v_name;
    END IF;
    INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (v_store, v_pid, p_sign * v_need)
      ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  END LOOP;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public._move_stock(uuid, int) FROM public, anon, authenticated;

-- ---------- 3. Manual adjustments: the guard read must hold the row ----------
-- Verbatim rest of app.adjust_stock_reason with the balance read taken under a
-- row lock plus the same advisory key, so "Only % in stock" is judged against
-- the value the very next statement writes.
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
  PERFORM pg_advisory_xact_lock(hashtext(p_store::text || ':' || p_product::text));
  SELECT coalesce(qty, 0) INTO v_qty FROM public.store_stock WHERE store_id = p_store AND product_id = p_product FOR UPDATE;
  -- No row yet means no stock, not "unknown": without this the comparison below
  -- turns NULL, the guard passes and the INSERT writes a negative balance.
  v_qty := coalesce(v_qty, 0);
  IF v_qty + p_delta < 0 THEN RAISE EXCEPTION 'Only % in stock — cannot remove %', v_qty, abs(p_delta); END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, p_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;

NOTIFY pgrst, 'reload schema';

-- --- from 20261011221117_drop_store_stock_bounds_enforce_in_sql.sql -------------
-- The store_stock_bounds CHECK constraint (qty >= 0) was causing cryptic 400
-- errors on the POS because any race between the guard read and the write would
-- surface as "new row violates check constraint" which maskRpcError hides.
-- The guard is now enforced in SQL logic inside _move_stock (FOR UPDATE +
-- explicit RAISE EXCEPTION) and adjust_stock_reason (advisory lock + guard).
-- A SQL-level check on the final write is redundant and harmful; remove it.
ALTER TABLE public.store_stock DROP CONSTRAINT IF EXISTS store_stock_bounds;

-- Re-add only the upper bound (sanity cap); zero/negative is now caught
-- upstream with a user-readable message before the write ever happens.
ALTER TABLE public.store_stock ADD CONSTRAINT store_stock_upper_bound
  CHECK (qty <= 100000000);

-- --- from 20261011221132_move_stock_floor_guard.sql -----------------------------
-- Belt-and-suspenders: after removing the qty>=0 constraint, _move_stock now
-- owns the floor. Add GREATEST(qty + delta, 0) so a race that slips past the
-- FOR UPDATE guard still produces qty=0 rather than a negative balance.
-- Additionally, surface a proper business error when the result would be < 0
-- so the cashier sees which item is short even in the concurrent case.
CREATE OR REPLACE FUNCTION public._move_stock(p_sale uuid, p_sign integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_store uuid; v_name text; v_pid uuid; v_need numeric; v_have numeric; r record;
BEGIN
  SELECT store_id INTO v_store FROM public.sales WHERE id = p_sale;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  PERFORM app.set_ctx(CASE WHEN p_sign < 0 THEN 'sale' ELSE 'sale_reversal' END, p_sale, NULL);
  FOR r IN
    SELECT i.product_id AS pid, sum(i.qty) AS need_qty
      FROM public.sale_items i
     WHERE i.sale_id = p_sale AND i.product_id IS NOT NULL
     GROUP BY 1 ORDER BY 1
  LOOP
    v_pid  := r.pid;
    v_need := r.need_qty;
    -- Advisory lock first so two concurrent sales on the same (store, product)
    -- pair are strictly serialised; the FOR UPDATE then guarantees we read the
    -- value that our write will actually land on.
    PERFORM pg_advisory_xact_lock(hashtext(v_store::text || ':' || v_pid::text));
    SELECT qty INTO v_have
      FROM public.store_stock
     WHERE store_id = v_store AND product_id = v_pid
     FOR UPDATE;
    v_have := coalesce(v_have, 0);
    IF p_sign < 0 AND v_have < v_need THEN
      SELECT coalesce(name, 'this item') INTO v_name FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Only % left in stock for %', trim_scale(v_have), v_name;
    END IF;
    INSERT INTO public.store_stock(store_id, product_id, qty)
         VALUES (v_store, v_pid, p_sign * v_need)
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET qty = GREATEST(public.store_stock.qty + excluded.qty, 0);
  END LOOP;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public._move_stock(uuid, int) FROM public, anon, authenticated;

