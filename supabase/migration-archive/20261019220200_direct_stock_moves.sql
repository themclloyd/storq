-- ============================================================================
-- Direct stock moves: a transfer is dispatched and booked in ONE atomic RPC.
-- The in_transit/receive/cancel freight lifecycle is retired for 1-3 shop
-- retailers; the stock_transfers history table, its lines and the immutable
-- stock_movements ledger (transfer_out + transfer_in) stay exactly as before.
-- ============================================================================

-- ---------- 1. Backfill: book and complete any open in_transit transfers ----
-- Goods for an open transfer have physically moved already, so receiving is the
-- semantically true completion. Same match-or-copy rule receive_transfer used:
-- prefer a same-sku item in the destination catalog, then same-name, else copy
-- the source product (with its cost) into the destination store's own catalog.
DO $$
DECLARE t public.stock_transfers; r record; src public.products; v_dst uuid;
BEGIN
  FOR t IN SELECT * FROM public.stock_transfers WHERE status = 'in_transit' ORDER BY created_at LOOP
    PERFORM app.set_ctx('transfer_in', t.id, 'Transfer ' || t.number);
    FOR r IN SELECT l.product_id AS src_id, l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = t.id LOOP
      SELECT * INTO src FROM public.products WHERE id = r.src_id;
      SELECT p.id INTO v_dst FROM public.products p
        WHERE p.store_id = t.to_store
          AND ( (src.sku IS NOT NULL AND btrim(src.sku) <> '' AND lower(btrim(p.sku)) = lower(btrim(src.sku)))
                OR p.name = src.name )
        ORDER BY (src.sku IS NOT NULL AND btrim(src.sku) <> '' AND lower(btrim(p.sku)) = lower(btrim(src.sku))) DESC NULLS LAST, p.name
        LIMIT 1;
      IF v_dst IS NULL THEN
        INSERT INTO public.products(business_id, store_id, name, sku, category, price, active, reorder_point)
          VALUES (t.business_id, t.to_store, src.name, src.sku, src.category, src.price, src.active, src.reorder_point)
          RETURNING id INTO v_dst;
        INSERT INTO public.product_costs(product_id, cost)
          SELECT v_dst, pc.cost FROM public.product_costs pc WHERE pc.product_id = src.id
          ON CONFLICT (product_id) DO NOTHING;
      END IF;
      INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (t.to_store, v_dst, r.qty)
        ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
    END LOOP;
    PERFORM app.set_ctx(NULL, NULL, NULL);
    UPDATE public.stock_transfers SET status = 'received', received_at = now() WHERE id = t.id;
  END LOOP;
END $$;

-- ---------- 2. create_transfer is now the whole move ------------------------
-- Verbatim validation from the two-step version (source ownership, positive
-- stock check, line shape), then: header row is inserted already 'received',
-- the source is deducted (transfer_out) and the destination is booked
-- (transfer_in) in the same transaction. A manager may only move between
-- stores when they are assigned to one of the endpoints.
CREATE OR REPLACE FUNCTION app.create_transfer(p_token uuid, p_from uuid, p_to uuid, p_items jsonb, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; v_id uuid; v_number integer; v_bad numeric; v_names text; r record; src public.products; v_dst uuid;
BEGIN
  me := public.require_staff(p_token, array['admin','manager']);
  IF me.role = 'manager' AND me.store_id IS NOT NULL AND me.store_id NOT IN (p_from, p_to) THEN RAISE EXCEPTION 'You are not assigned to either store'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RAISE EXCEPTION 'Pick two different stores'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_from AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown source store'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_to AND business_id = me.business_id) THEN RAISE EXCEPTION 'Unknown destination store'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Add at least one item to transfer'; END IF;
  IF jsonb_array_length(p_items) > 200 THEN RAISE EXCEPTION 'Too many lines on one transfer (max 200)'; END IF;
  IF coalesce(char_length(p_note), 0) > 500 THEN RAISE EXCEPTION 'Note is too long (max 500 characters)'; END IF;
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_items) x
   WHERE coalesce(jsonb_typeof(x),'') <> 'object'
      OR coalesce(x->>'product_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(x->>'qty','') !~ '^[0-9]{1,7}(\.[0-9]{1,3})?$'
      OR (x->>'qty')::numeric <= 0;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Transfer lines need a catalogue item and a quantity above zero'; END IF;
  SELECT count(*) INTO v_bad FROM (SELECT (x->>'product_id')::uuid pid FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Merge duplicate product lines on the transfer'; END IF;
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid
   WHERE p.store_id <> p_from OR NOT p.active;
  IF v_bad > 0 THEN RAISE EXCEPTION 'One or more items are not in the source store'; END IF;
  SELECT string_agg(p.name, ', ') INTO v_names FROM jsonb_array_elements(p_items) x
    JOIN public.products p ON p.id = (x->>'product_id')::uuid
    LEFT JOIN public.store_stock ss ON ss.product_id = (x->>'product_id')::uuid AND ss.store_id = p_from
   WHERE coalesce(ss.qty, 0) < (x->>'qty')::numeric;
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'Not enough stock at the source store for: %', v_names; END IF;

  INSERT INTO public.stock_transfers(business_id, from_store, to_store, status, note, created_by, received_by, received_at)
    VALUES (me.business_id, p_from, p_to, 'received', nullif(btrim(coalesce(p_note,'')),''), me.id, me.id, now())
    RETURNING id, number INTO v_id, v_number;
  INSERT INTO public.stock_transfer_lines(transfer_id, product_id, qty)
    SELECT v_id, (x->>'product_id')::uuid, (x->>'qty')::numeric FROM jsonb_array_elements(p_items) x;

  PERFORM app.set_ctx('transfer_out', v_id, 'Transfer ' || v_number);
  INSERT INTO public.store_stock(store_id, product_id, qty)
    SELECT p_from, l.product_id, -l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = v_id
    ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;

  PERFORM app.set_ctx('transfer_in', v_id, 'Transfer ' || v_number);
  FOR r IN SELECT l.product_id AS src_id, l.qty FROM public.stock_transfer_lines l WHERE l.transfer_id = v_id LOOP
    SELECT * INTO src FROM public.products WHERE id = r.src_id;
    SELECT p.id INTO v_dst FROM public.products p
      WHERE p.store_id = p_to
        AND ( (src.sku IS NOT NULL AND btrim(src.sku) <> '' AND lower(btrim(p.sku)) = lower(btrim(src.sku)))
              OR p.name = src.name )
      ORDER BY (src.sku IS NOT NULL AND btrim(src.sku) <> '' AND lower(btrim(p.sku)) = lower(btrim(src.sku))) DESC NULLS LAST, p.name
      LIMIT 1;
    IF v_dst IS NULL THEN
      INSERT INTO public.products(business_id, store_id, name, sku, category, price, active, reorder_point)
        VALUES (me.business_id, p_to, src.name, src.sku, src.category, src.price, src.active, src.reorder_point)
        RETURNING id INTO v_dst;
      INSERT INTO public.product_costs(product_id, cost)
        SELECT v_dst, pc.cost FROM public.product_costs pc WHERE pc.product_id = src.id
        ON CONFLICT (product_id) DO NOTHING;
    END IF;
    INSERT INTO public.store_stock(store_id, product_id, qty) VALUES (p_to, v_dst, r.qty)
      ON CONFLICT (store_id, product_id) DO UPDATE SET qty = public.store_stock.qty + excluded.qty;
  END LOOP;
  PERFORM app.set_ctx(NULL, NULL, NULL);
  RETURN v_id;
END $$;

-- ---------- 3. Retire the handoff RPCs --------------------------------------
DROP FUNCTION IF EXISTS public.receive_transfer(uuid, uuid);
DROP FUNCTION IF EXISTS app.receive_transfer(uuid, uuid);
DROP FUNCTION IF EXISTS public.cancel_transfer(uuid, uuid);
DROP FUNCTION IF EXISTS app.cancel_transfer(uuid, uuid);

-- ---------- 4. Re-affirm the surviving RPC surface ---------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.create_transfer(uuid,uuid,uuid,jsonb,text)',
    'public.create_transfer(uuid,uuid,uuid,jsonb,text)',
    'app.low_stock(uuid,uuid)',
    'public.low_stock(uuid,uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f || ' FROM public, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated, service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
