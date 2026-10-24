-- ===== Tax settings & new columns =====
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT true;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_id uuid;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS refunded_qty numeric NOT NULL DEFAULT 0;

-- ===== Stock movement ledger =====
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delta numeric NOT NULL,
  balance_after numeric NOT NULL,
  reason text NOT NULL DEFAULT 'adjustment',
  note text,
  ref_id uuid,
  staff_id uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_movements(store_id, product_id, created_at DESC);
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.business_id = app.my_business_id()));

CREATE OR REPLACE FUNCTION app.log_stock_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d numeric; v_staff text; v_ref text;
BEGIN
  d := NEW.qty - CASE WHEN TG_OP = 'UPDATE' THEN OLD.qty ELSE 0 END;
  IF d = 0 THEN RETURN NEW; END IF;
  v_staff := nullif(current_setting('storq.staff', true), '');
  v_ref := nullif(current_setting('storq.ref', true), '');
  INSERT INTO public.stock_movements(store_id, product_id, delta, balance_after, reason, note, ref_id, staff_id)
  VALUES (NEW.store_id, NEW.product_id, d, NEW.qty,
    coalesce(nullif(current_setting('storq.reason', true), ''), 'adjustment'),
    nullif(current_setting('storq.note', true), ''),
    v_ref::uuid, v_staff::uuid);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.log_stock_movement() FROM public, anon, authenticated;
CREATE TRIGGER store_stock_ledger AFTER INSERT OR UPDATE OF qty ON public.store_stock
  FOR EACH ROW EXECUTE FUNCTION app.log_stock_movement();

CREATE OR REPLACE FUNCTION app.set_ctx(p_reason text, p_ref uuid, p_note text) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('storq.reason', coalesce(p_reason,''), true),
         set_config('storq.ref', coalesce(p_ref::text,''), true),
         set_config('storq.note', coalesce(p_note,''), true);
$$;
REVOKE ALL ON FUNCTION app.set_ctx(text, uuid, text) FROM public, anon, authenticated;

-- record acting staff for the ledger whenever a PIN session is verified
CREATE OR REPLACE FUNCTION public.require_staff_nosub(p_token uuid, p_roles text[])
 RETURNS staff LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND s.active AND s.business_id = public.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.role = ANY(p_roles)) THEN RAISE EXCEPTION 'Your role (%) is not allowed to do this', st.role; END IF;
  PERFORM set_config('storq.staff', st.id::text, true);
  RETURN st;
END $$;

-- sale stock movement tags reason
CREATE OR REPLACE FUNCTION public._move_stock(p_sale uuid, p_sign integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM app.set_ctx(CASE WHEN p_sign < 0 THEN 'sale' ELSE 'sale_reversal' END, p_sale, NULL);
  INSERT INTO public.store_stock(store_id, product_id, qty)
  SELECT s.store_id, i.product_id, p_sign * i.qty FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id
   WHERE i.sale_id = p_sale AND i.product_id IS NOT NULL
  ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;
REVOKE EXECUTE ON FUNCTION public._move_stock(uuid, int) FROM public, anon, authenticated;

-- backfill opening balances so the ledger starts from current stock
INSERT INTO public.stock_movements(store_id, product_id, delta, balance_after, reason, note)
SELECT store_id, product_id, qty, qty, 'opening_balance', 'Balance when ledger started' FROM public.store_stock WHERE qty <> 0;

-- stock adjustment with reason
CREATE OR REPLACE FUNCTION app.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown product'; END IF;
  IF p_reason NOT IN ('supplier_intake','damage','shrinkage','transfer_in','transfer_out','correction','return_to_supplier','adjustment') THEN
    RAISE EXCEPTION 'Unknown reason'; END IF;
  PERFORM app.set_ctx(p_reason, NULL, p_note);
  INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_store, p_product, p_delta)
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
END $$;

-- stock take close tags reason
CREATE OR REPLACE FUNCTION app.close_stock_take(p_token uuid, p_take uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; t public.stock_takes;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO t FROM public.stock_takes WHERE id = p_take AND business_id = me.business_id AND status = 'open';
  IF t.id IS NULL THEN RAISE EXCEPTION 'Stock take is not open'; END IF;
  PERFORM app.set_ctx('stocktake', p_take, NULL);
  INSERT INTO public.store_stock(store_id, product_id, qty)
    SELECT t.store_id, product_id, counted FROM public.stock_take_lines WHERE stock_take_id = p_take AND counted IS NOT NULL
  ON CONFLICT (store_id, product_id) DO UPDATE SET qty = excluded.qty;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  UPDATE public.stock_takes SET status = 'closed', closed_by = me.id, closed_at = now() WHERE id = p_take;
END $$;

-- ===== Cash shifts =====
CREATE TABLE public.cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  opened_by uuid REFERENCES public.staff(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric NOT NULL DEFAULT 0,
  closed_by uuid REFERENCES public.staff(id),
  closed_at timestamptz,
  expected_cash numeric,
  counted_cash numeric,
  variance numeric,
  summary jsonb,
  notes text
);
CREATE UNIQUE INDEX one_open_shift_per_store ON public.cash_shifts(store_id) WHERE status = 'open';
GRANT SELECT ON public.cash_shifts TO authenticated;
GRANT ALL ON public.cash_shifts TO service_role;
ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own shifts" ON public.cash_shifts FOR SELECT TO authenticated USING (business_id = app.my_business_id());

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount numeric NOT NULL,
  reason text,
  staff_id uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cash_movements TO authenticated;
GRANT ALL ON public.cash_movements TO service_role;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cash movements" ON public.cash_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cash_shifts s WHERE s.id = shift_id AND s.business_id = app.my_business_id()));

-- ===== Refunds =====
CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  number serial,
  amount numeric NOT NULL,
  cost numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  reason text,
  staff_id uuid REFERENCES public.staff(id),
  shift_id uuid REFERENCES public.cash_shifts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own refunds" ON public.refunds FOR SELECT TO authenticated USING (business_id = app.my_business_id());

CREATE TABLE public.refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES public.sale_items(id),
  product_id uuid REFERENCES public.products(id),
  name text NOT NULL,
  qty numeric NOT NULL,
  amount numeric NOT NULL,
  cost numeric NOT NULL DEFAULT 0,
  restock boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.refund_items TO authenticated;
GRANT ALL ON public.refund_items TO service_role;
ALTER TABLE public.refund_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own refund items" ON public.refund_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.refunds r WHERE r.id = refund_id AND r.business_id = app.my_business_id()));

-- ===== Shift functions =====
CREATE OR REPLACE FUNCTION app.open_shift(p_token uuid, p_store uuid, p_float numeric, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; r uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_shifts WHERE store_id = p_store AND status = 'open') THEN RAISE EXCEPTION 'A shift is already open for this store'; END IF;
  IF coalesce(p_float,0) < 0 THEN RAISE EXCEPTION 'Float cannot be negative'; END IF;
  INSERT INTO public.cash_shifts(business_id, store_id, opened_by, opening_float, notes)
    VALUES (me.business_id, p_store, me.id, coalesce(p_float,0), p_notes) RETURNING id INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.cash_move(p_token uuid, p_shift uuid, p_kind text, p_amount numeric, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_kind NOT IN ('in','out') THEN RAISE EXCEPTION 'Kind must be in or out'; END IF;
  IF coalesce(p_amount,0) <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id = p_shift AND business_id = me.business_id AND status = 'open') THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  INSERT INTO public.cash_movements(shift_id, kind, amount, reason, staff_id) VALUES (p_shift, p_kind, p_amount, p_reason, me.id);
END $$;

-- computes the live cash summary for a shift window
CREATE OR REPLACE FUNCTION app.shift_summary(p_shift uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cash_shifts; v_end timestamptz; cash_sales numeric; other jsonb; refunds_cash numeric; ins numeric; outs numeric; exp numeric; n int;
BEGIN
  SELECT * INTO s FROM public.cash_shifts WHERE id = p_shift;
  v_end := coalesce(s.closed_at, now());
  SELECT coalesce(sum(p.amount),0) INTO cash_sales FROM public.payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.store_id = s.store_id AND p.method = 'cash' AND p.created_at >= s.opened_at AND p.created_at <= v_end;
  SELECT coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) INTO other FROM (
    SELECT p.method, sum(p.amount) amt FROM public.payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.store_id = s.store_id AND p.created_at >= s.opened_at AND p.created_at <= v_end GROUP BY p.method) q;
  SELECT count(DISTINCT p.sale_id) INTO n FROM public.payments p JOIN public.sales x ON x.id = p.sale_id
    WHERE x.store_id = s.store_id AND p.created_at >= s.opened_at AND p.created_at <= v_end;
  SELECT coalesce(sum(amount),0) INTO refunds_cash FROM public.refunds
    WHERE store_id = s.store_id AND method = 'cash' AND created_at >= s.opened_at AND created_at <= v_end;
  SELECT coalesce(sum(amount) FILTER (WHERE kind='in'),0), coalesce(sum(amount) FILTER (WHERE kind='out'),0) INTO ins, outs
    FROM public.cash_movements WHERE shift_id = p_shift;
  SELECT coalesce(sum(amount),0) INTO exp FROM public.expenses
    WHERE store_id = s.store_id AND source = 'till' AND created_at >= s.opened_at AND created_at <= v_end;
  RETURN jsonb_build_object('opening_float', s.opening_float, 'cash_sales', cash_sales, 'by_method', other,
    'transactions', n, 'cash_refunds', refunds_cash, 'cash_in', ins, 'cash_out', outs, 'till_expenses', exp,
    'expected_cash', s.opening_float + cash_sales - refunds_cash + ins - outs - exp);
END $$;
REVOKE ALL ON FUNCTION app.shift_summary(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.get_shift_summary(p_token uuid, p_shift uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id = p_shift AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown shift'; END IF;
  RETURN app.shift_summary(p_shift);
END $$;

CREATE OR REPLACE FUNCTION app.close_shift(p_token uuid, p_shift uuid, p_counted numeric, p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; sm jsonb; exp numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  PERFORM 1 FROM public.cash_shifts WHERE id = p_shift AND business_id = me.business_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN RAISE EXCEPTION 'Enter the cash you counted'; END IF;
  UPDATE public.cash_shifts SET closed_at = now() WHERE id = p_shift;
  sm := app.shift_summary(p_shift);
  exp := (sm->>'expected_cash')::numeric;
  UPDATE public.cash_shifts SET status = 'closed', closed_by = me.id, expected_cash = exp, counted_cash = p_counted,
    variance = p_counted - exp, summary = sm, notes = coalesce(nullif(p_notes,''), notes) WHERE id = p_shift;
  RETURN sm || jsonb_build_object('counted_cash', p_counted, 'variance', p_counted - exp);
END $$;

-- ===== Refund function =====
-- p_items: [{sale_item_id, qty, restock}]
CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; s public.sales; b public.businesses; r uuid; rn int; x jsonb; it public.sale_items;
  q numeric; amt numeric := 0; cst numeric := 0; line numeric; v_shift uuid; v_tax numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  IF s.status NOT IN ('completed','layby_completed','refunded','partially_refunded') THEN RAISE EXCEPTION 'Only completed sales can be refunded'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Pick items to return'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'Give a reason for the refund'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id = s.business_id;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = s.store_id AND status = 'open';
  INSERT INTO public.refunds(business_id, store_id, sale_id, amount, method, reason, staff_id, shift_id)
    VALUES (s.business_id, s.store_id, s.id, 0, coalesce(p_method,'cash'), p_reason, me.id, v_shift) RETURNING id, number INTO r, rn;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (x->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (x->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    line := round(it.price * q, 2);
    IF NOT b.tax_inclusive AND b.tax_rate > 0 THEN line := round(line * (1 + b.tax_rate/100), 2); END IF;
    amt := amt + line;
    UPDATE public.sale_items SET refunded_qty = refunded_qty + q WHERE id = it.id;
    INSERT INTO public.refund_items(refund_id, sale_item_id, product_id, name, qty, amount, cost, restock)
      VALUES (r, it.id, it.product_id, it.name, q, line, CASE WHEN coalesce((x->>'restock')::boolean, true) THEN it.cost * q ELSE 0 END,
        coalesce((x->>'restock')::boolean, true));
    IF coalesce((x->>'restock')::boolean, true) AND it.product_id IS NOT NULL THEN
      cst := cst + it.cost * q;
      PERFORM app.set_ctx('refund_restock', r, p_reason);
      INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (s.store_id, it.product_id, q)
        ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
      PERFORM app.set_ctx(NULL, NULL, NULL);
    END IF;
  END LOOP;
  IF amt <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  IF s.refunded + amt > s.total + 0.01 THEN RAISE EXCEPTION 'Refund exceeds sale total'; END IF;
  v_tax := CASE WHEN s.total > 0 THEN round(s.tax * amt / s.total, 2) ELSE 0 END;
  UPDATE public.refunds SET amount = amt, cost = cst, tax = v_tax WHERE id = r;
  UPDATE public.sales SET refunded = refunded + amt,
    status = CASE WHEN refunded + amt >= total - 0.01 THEN 'refunded' ELSE 'partially_refunded' END WHERE id = s.id;
  RETURN json_build_object('id', r, 'number', rn, 'amount', amt);
END $$;

-- ===== Tax settings =====
CREATE OR REPLACE FUNCTION app.save_tax_settings(p_token uuid, p_rate numeric, p_inclusive boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff;
BEGIN
  me := public.require_staff(p_token, array['admin']);
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 50 THEN RAISE EXCEPTION 'Tax rate must be between 0 and 50%%'; END IF;
  UPDATE public.businesses SET tax_rate = p_rate, tax_inclusive = coalesce(p_inclusive, true) WHERE id = me.business_id;
END $$;

-- ===== Checkout with tax + shift =====
CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; st public.stores; b public.businesses; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid; v_status text; v_num int; v_pay numeric; v_shift uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  SELECT * INTO st FROM public.stores WHERE id = p_store AND business_id = me.business_id;
  IF st.id IS NULL THEN RAISE EXCEPTION 'Unknown store'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE coalesce((x->>'qty')::numeric,0) <= 0) THEN RAISE EXCEPTION 'Quantities must be above zero'; END IF;
  IF p_kind NOT IN ('sale','layby') THEN RAISE EXCEPTION 'Unknown sale type'; END IF;
  IF p_kind = 'layby' AND coalesce(trim(p_customer_name),'') = '' THEN RAISE EXCEPTION 'Layby needs a customer name'; END IF;
  SELECT * INTO b FROM public.businesses WHERE id = me.business_id;
  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_sub
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Invalid items'; END IF;
  IF b.tax_rate > 0 AND b.tax_inclusive THEN v_total := round(v_sub, 2); v_tax := round(v_sub - v_sub / (1 + b.tax_rate/100), 2);
  ELSIF b.tax_rate > 0 THEN v_tax := round(v_sub * b.tax_rate/100, 2); v_total := round(v_sub, 2) + v_tax;
  ELSE v_total := round(v_sub, 2); v_tax := 0; END IF;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  v_pay := least(greatest(coalesce(p_payment,0),0), v_total);
  IF st.store_type = 'approval' THEN v_status := 'pending_approval';
  ELSIF p_kind = 'layby' THEN v_status := 'layby_open';
  ELSE v_status := 'completed'; v_pay := v_total; END IF;
  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, p_method, p_customer_name, p_customer_phone, p_note, me.id, v_shift)
    RETURNING id, number INTO v_sale, v_num;
  INSERT INTO public.sale_items(sale_id, product_id, name, qty, price, cost)
    SELECT v_sale, p.id, p.name, (x->>'qty')::numeric, public.effective_price(p.id), p.cost
      FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.business_id = me.business_id;
  IF v_status <> 'pending_approval' THEN
    PERFORM public._move_stock(v_sale, -1);
    IF v_pay > 0 THEN INSERT INTO public.payments(sale_id, amount, method, staff_id) VALUES (v_sale, v_pay, coalesce(p_method,'cash'), me.id); END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax);
END $$;

-- ===== Public wrappers =====
CREATE OR REPLACE FUNCTION public.adjust_stock_reason(p_token uuid, p_store uuid, p_product uuid, p_delta numeric, p_reason text, p_note text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.adjust_stock_reason($1,$2,$3,$4,$5,$6) $$;
CREATE OR REPLACE FUNCTION public.open_shift(p_token uuid, p_store uuid, p_float numeric, p_notes text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.open_shift($1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION public.cash_move(p_token uuid, p_shift uuid, p_kind text, p_amount numeric, p_reason text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.cash_move($1,$2,$3,$4,$5) $$;
CREATE OR REPLACE FUNCTION public.get_shift_summary(p_token uuid, p_shift uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.get_shift_summary($1,$2) $$;
CREATE OR REPLACE FUNCTION public.close_shift(p_token uuid, p_shift uuid, p_counted numeric, p_notes text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.close_shift($1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION public.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
RETURNS json LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.process_refund($1,$2,$3,$4,$5) $$;
CREATE OR REPLACE FUNCTION public.save_tax_settings(p_token uuid, p_rate numeric, p_inclusive boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT app.save_tax_settings($1,$2,$3) $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['adjust_stock_reason(uuid,uuid,uuid,numeric,text,text)','open_shift(uuid,uuid,numeric,text)',
    'cash_move(uuid,uuid,text,numeric,text)','get_shift_summary(uuid,uuid)','close_shift(uuid,uuid,numeric,text)',
    'process_refund(uuid,uuid,jsonb,text,text)','save_tax_settings(uuid,numeric,boolean)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.' || f || ' FROM public, anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.' || f || ' FROM public, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || f || ' TO authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app.' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.set_ctx(text, uuid, text) TO authenticated;
