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
