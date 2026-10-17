-- Guard the source of the Dresses-class bug: an item whose buying cost meets
-- or beats its selling price poisons every report downstream (product profit
-- goes negative per unit sold) and was accepted by every entry path. Cost is
-- optional (0 = unknown), so the rule only bites when a cost is actually set.
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
  IF coalesce(p_cost, 0) > 0 AND coalesce(p_cost, 0) >= p_price THEN
    RAISE EXCEPTION 'Buying cost must be below the selling price';
  END IF;
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
