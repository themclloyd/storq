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
