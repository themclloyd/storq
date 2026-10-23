-- Offline sales keep the time they happened.
--
-- A queued sale replayed from a till that was offline went in with
-- now() as its timestamp, so a Saturday evening sale synced on Monday: landed
-- in Monday's revenue and in whatever drawer happened to be open when the
-- network came back. Yesterday's till could not be counted and today's
-- expected cash was wrong by the amount of the queue.
--
-- The client now sends the moment it rang the sale up, and the sale is stamped
-- with that moment (clamped to the last week so a device with a badly set clock
-- cannot backdate into closed books) and attributed to the drawer that was
-- open then. A historical sale with no drawer covering it stays unattributed
-- instead of being pushed into today's count.
--
-- The public RPCs are dropped and recreated rather than overloaded: a 12-arg
-- and a 13-arg version would both resolve, and the old one must not survive.

DROP FUNCTION public.checkout_ref(uuid, uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);
DROP FUNCTION public.checkout(uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);
DROP FUNCTION app.checkout_ref(uuid, uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);
DROP FUNCTION app.checkout(uuid, uuid, text, jsonb, numeric, text, text, text, text, jsonb, jsonb, text);

-- Drawer attribution follows the sale's own timestamp for both paths.
CREATE OR REPLACE FUNCTION app.attach_drawer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r uuid;
BEGIN
  -- An approval invoice takes no money yet; its drawer opens when it is paid.
  -- A layby with no deposit is a promise, not cash in the drawer.
  IF NEW.shift_id IS NOT NULL
     OR NEW.status = 'pending_approval'
     OR (NEW.status = 'layby_open' AND coalesce(NEW.paid, 0) <= 0) THEN
    RETURN NEW;
  END IF;

  -- The drawer that was open when this sale happened, not the one open now.
  SELECT id INTO r FROM public.cash_shifts
   WHERE store_id = NEW.store_id
     AND opened_at <= NEW.created_at
     AND (closed_at IS NULL OR closed_at > NEW.created_at)
   ORDER BY opened_at DESC
   LIMIT 1;
  IF r IS NOT NULL THEN
    NEW.shift_id := r;
    RETURN NEW;
  END IF;

  -- No drawer covered that moment. A live sale still gets one opened for it;
  -- a replayed offline sale from an untracked window stays unattributed rather
  -- than inflating today's count.
  IF NEW.created_at < now() - interval '1 minute' THEN RETURN NEW; END IF;

  NEW.shift_id := app.ensure_drawer(NEW.business_id, NEW.store_id, NEW.created_by);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE me public.staff; st public.stores; v_gross numeric; v_disc numeric; v_sub numeric; v_total numeric; v_tax numeric; v_sale uuid;
  v_status text; v_num int; v_pay numeric; v_shift uuid; v_short text; v_lines int; v_matched int; v_n int; ln jsonb;
  v_pid uuid; v_name text; v_unit numeric; v_cost numeric; v_qty numeric; v_ld numeric; v_item uuid; v_dc int;
  v_nm int; v_cash numeric; v_tsum numeric; v_pm text; v_ovr numeric; v_at timestamptz;
BEGIN
  me := app.require_perm(p_token, '{sell}'::text[]);
  -- Offline replay: the till's clock is the truth, within reason. Future times
  -- collapse to now, times older than a week collapse to a week ago.
  v_at := least(coalesce(p_occurred_at, now()), now());
  IF v_at < now() - interval '7 days' THEN v_at := now() - interval '7 days'; END IF;
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
  IF me.store_id IS NOT NULL AND me.store_id <> p_store THEN RAISE EXCEPTION 'You are not assigned to this store'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('sale','layby') THEN RAISE EXCEPTION 'Unknown sale type'; END IF;
  IF p_kind = 'layby' AND coalesce(btrim(p_customer_name),'') = '' THEN RAISE EXCEPTION 'Layby needs a customer name'; END IF;
  IF char_length(coalesce(p_customer_name,'')) > 120 THEN RAISE EXCEPTION 'Customer name is too long (max 120 characters)'; END IF;
  IF p_customer_name ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Customer name contains unsupported characters'; END IF;
  IF p_customer_phone IS NOT NULL AND btrim(p_customer_phone) <> '' AND btrim(p_customer_phone) !~ '^[+0-9()\- ]{6,32}$' THEN
    RAISE EXCEPTION 'Customer phone must be 6-32 characters of digits, + ( ) - and spaces';
  END IF;
  IF coalesce(p_note,'') <> '' AND char_length(p_note) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  IF p_method IS NOT NULL AND NOT app.payment_method_allowed(p_store, p_method) THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF p_payment IS NOT NULL AND p_payment NOT BETWEEN 0 AND 10000000000 THEN RAISE EXCEPTION 'Payment amount must be between 0 and 10,000,000,000'; END IF;

  SELECT count(*) INTO v_matched FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.store_id = p_store AND p.active;
  IF v_matched <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'One or more items are not in your catalogue'; END IF;
  SELECT count(*) INTO v_lines FROM (
    SELECT (x->>'product_id')::uuid pid FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d;
  IF v_lines > 0 THEN RAISE EXCEPTION 'Merge duplicate cart lines before discounting'; END IF;

  SELECT sum(public.effective_price(p.id) * (x->>'qty')::numeric) INTO v_gross
    FROM jsonb_array_elements(p_items) x JOIN public.products p ON p.id = (x->>'product_id')::uuid AND p.store_id = p_store;
  IF v_gross IS NULL OR v_gross NOT BETWEEN 0 AND 100000000000 THEN RAISE EXCEPTION 'Invalid items'; END IF;
  SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO v_disc
    FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
    JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.store_id = p_store;
  IF v_disc < 0 OR v_disc > v_gross THEN RAISE EXCEPTION 'Discounts are larger than this sale'; END IF;
  v_sub := round(v_gross - v_disc, 2);
  IF v_sub < 0 THEN v_sub := 0; END IF;

  IF v_disc > 0 AND NOT app.has_perm(me, 'approvals') THEN
    IF (v_gross > 0 AND v_disc > round(v_gross * 0.10, 2)) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
      JOIN public.products p ON p.id = (d->>'product_id')::uuid AND p.store_id = p_store
      JOIN jsonb_array_elements(p_items) x ON (x->>'product_id')::uuid = p.id
      WHERE (d->>'amount')::numeric > round(public.effective_price(p.id) * (x->>'qty')::numeric * 0.10, 2)) THEN
      IF p_override_pin IS NULL OR p_override_pin !~ '^[0-9]{4,8}$' THEN
        RAISE EXCEPTION 'That discount needs a manager PIN';
      END IF;
      SELECT count(*) INTO v_dc FROM public.staff
       WHERE business_id = me.business_id AND active AND (is_owner OR 'approvals' = ANY (permissions))
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

  v_nm := 0; v_cash := 0; v_tsum := 0;
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) = 'array' THEN
    v_n := jsonb_array_length(p_tenders);
    IF v_n > 10 THEN RAISE EXCEPTION 'Too many tenders on one sale (max 10)'; END IF;
    IF v_n > 0 THEN
      SELECT count(*) INTO v_lines FROM jsonb_array_elements(p_tenders) t
       WHERE coalesce(jsonb_typeof(t),'') <> 'object'
          OR NOT app.payment_method_allowed(p_store, coalesce(t->>'method',''))
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

  -- The drawer that was open at v_at, matching the trigger's rule.
  SELECT id INTO v_shift FROM public.cash_shifts
   WHERE store_id = p_store
     AND opened_at <= v_at
     AND (closed_at IS NULL OR closed_at > v_at)
   ORDER BY opened_at DESC
   LIMIT 1;
  IF v_status = 'completed' THEN
    v_pay := v_total;
    IF v_cash < v_total THEN v_cash := v_total; END IF;
  ELSE
    v_pay := v_tsum;
  END IF;

  v_pm := CASE WHEN v_nm > 1 THEN 'split'
    WHEN v_nm = 1 THEN (SELECT min(t->>'method') FROM jsonb_array_elements(p_tenders) t)
    ELSE coalesce(p_method,'cash') END;

  INSERT INTO public.sales(business_id, store_id, kind, status, total, tax, discount, paid, payment_method, customer_name, customer_phone, note, created_by, shift_id, created_at)
    VALUES (me.business_id, p_store, p_kind, v_status, v_total, v_tax, v_disc,
      CASE WHEN v_status = 'pending_approval' THEN 0 ELSE v_pay END, v_pm,
      nullif(btrim(coalesce(p_customer_name,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
      nullif(btrim(coalesce(p_note,'')),''), me.id, v_shift, v_at)
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
        INSERT INTO public.payments(sale_id, amount, method, staff_id, created_at)
          SELECT v_sale, greatest(GREATEST((t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END, 0), 0), t->>'method', me.id, v_at
          FROM jsonb_array_elements(p_tenders) t
          WHERE (t->>'amount')::numeric - CASE WHEN t->>'method' = 'cash' THEN v_ovr ELSE 0 END > 0;
      ELSE
        INSERT INTO public.payments(sale_id, amount, method, staff_id, created_at)
          SELECT v_sale, (t->>'amount')::numeric, t->>'method', me.id, v_at FROM jsonb_array_elements(p_tenders) t WHERE (t->>'amount')::numeric > 0;
      END IF;
    ELSIF v_pay > 0 THEN
      INSERT INTO public.payments(sale_id, amount, method, staff_id, created_at) VALUES (v_sale, v_pay, coalesce(v_pm,'cash'), me.id, v_at);
    END IF;
    IF p_kind = 'layby' AND v_pay >= v_total THEN UPDATE public.sales SET status = 'layby_completed' WHERE id = v_sale; END IF;
  END IF;
  RETURN json_build_object('id', v_sale, 'number', v_num, 'status', (SELECT status FROM public.sales WHERE id = v_sale), 'total', v_total, 'tax', v_tax, 'discount', v_disc);
END $function$;

CREATE OR REPLACE FUNCTION app.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me public.staff; s public.sales; r json;
BEGIN
  me := app.require_perm(p_token, '{sell}'::text[]);
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'Missing sale reference'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_ref::text));
  SELECT * INTO s FROM public.sales WHERE client_ref = p_client_ref;
  IF s.id IS NOT NULL THEN
    IF s.business_id <> me.business_id THEN RAISE EXCEPTION 'Sale reference already used'; END IF;
    RETURN json_build_object('id', s.id, 'number', s.number, 'status', s.status, 'total', s.total, 'tax', s.tax, 'discount', s.discount, 'duplicate', true);
  END IF;
  r := app.checkout(p_token, p_store, p_kind, p_items, p_payment, p_method, p_customer_name, p_customer_phone, p_note,
    p_tenders, p_discounts, p_override_pin, p_occurred_at);
  UPDATE public.sales SET client_ref = p_client_ref WHERE id = (r->>'id')::uuid;
  RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.checkout(p_token uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $function$
  select app.checkout($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
$function$;

CREATE OR REPLACE FUNCTION public.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text, p_tenders jsonb DEFAULT NULL::jsonb, p_discounts jsonb DEFAULT NULL::jsonb, p_override_pin text DEFAULT NULL::text, p_occurred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $function$
  select app.checkout_ref($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
$function$;
