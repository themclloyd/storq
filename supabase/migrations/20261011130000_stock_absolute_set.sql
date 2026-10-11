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
