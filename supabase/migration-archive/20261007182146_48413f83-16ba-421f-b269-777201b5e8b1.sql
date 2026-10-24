CREATE OR REPLACE FUNCTION app.process_refund(p_token uuid, p_sale uuid, p_items jsonb, p_method text, p_reason text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me public.staff; s public.sales; r uuid; rn int; x jsonb; it public.sale_items;
  q numeric; amt numeric := 0; cst numeric := 0; line numeric; v_shift uuid; v_tax numeric; v_sub numeric; v_left numeric;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  SELECT * INTO s FROM public.sales WHERE id = p_sale AND business_id = me.business_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Unknown sale'; END IF;
  IF s.status NOT IN ('completed','layby_completed','partially_refunded') THEN RAISE EXCEPTION 'Only completed sales can be refunded'; END IF;
  IF jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Pick items to return'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'Give a reason for the refund'; END IF;
  SELECT coalesce(sum(price*qty),0) INTO v_sub FROM public.sale_items WHERE sale_id = s.id;
  IF v_sub <= 0 THEN RAISE EXCEPTION 'Nothing to refund'; END IF;
  SELECT id INTO v_shift FROM public.cash_shifts WHERE store_id = s.store_id AND status = 'open';
  INSERT INTO public.refunds(business_id, store_id, sale_id, amount, method, reason, staff_id, shift_id)
    VALUES (s.business_id, s.store_id, s.id, 0, coalesce(p_method,'cash'), p_reason, me.id, v_shift) RETURNING id, number INTO r, rn;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO it FROM public.sale_items WHERE id = (x->>'sale_item_id')::uuid AND sale_id = s.id FOR UPDATE;
    IF it.id IS NULL THEN RAISE EXCEPTION 'Item not on this sale'; END IF;
    q := (x->>'qty')::numeric;
    IF q IS NULL OR q <= 0 THEN CONTINUE; END IF;
    IF q > it.qty - it.refunded_qty THEN RAISE EXCEPTION 'Cannot return more % than was sold', it.name; END IF;
    -- share of what the customer actually paid (incl. any VAT charged on the sale)
    line := round(s.total * (it.price * q) / v_sub, 2);
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
  SELECT coalesce(sum(qty - refunded_qty),0) INTO v_left FROM public.sale_items WHERE sale_id = s.id;
  IF v_left <= 0 OR s.refunded + amt > s.total THEN amt := s.total - s.refunded; END IF;
  IF amt <= 0 THEN RAISE EXCEPTION 'This sale is already fully refunded'; END IF;
  v_tax := CASE WHEN s.total > 0 THEN round(s.tax * amt / s.total, 2) ELSE 0 END;
  UPDATE public.refunds SET amount = amt, cost = cst, tax = v_tax WHERE id = r;
  UPDATE public.sales SET refunded = refunded + amt,
    status = CASE WHEN v_left <= 0 OR refunded + amt >= total - 0.01 THEN 'refunded' ELSE 'partially_refunded' END WHERE id = s.id;
  RETURN json_build_object('id', r, 'number', rn, 'amount', amt);
END $function$;