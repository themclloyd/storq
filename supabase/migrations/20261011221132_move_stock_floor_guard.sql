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
