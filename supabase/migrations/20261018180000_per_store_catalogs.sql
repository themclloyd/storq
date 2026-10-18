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
