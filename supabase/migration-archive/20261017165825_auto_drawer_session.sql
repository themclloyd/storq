-- ============================================================================
-- The drawer follows the PIN session, not the staff member's memory.
--
-- Until now a shift existed only if someone opened it by hand on the Cash
-- drawer screen, and checkout attached a shift_id only when one happened to be
-- open. In practice the drawer stayed closed, the Z-report stayed empty, and
-- nothing on the till said so — the feature was forgotten because the software
-- never mentioned it.
--
-- Now the first money movement at a store opens the drawer for the staff
-- member whose PIN session recorded it (`sales.created_by` /
-- `payments.staff_id`), and every sale, layby instalment and approval
-- settlement after it attaches to that drawer. Closing stays manual: it needs
-- a real count of the notes and coins.
-- ============================================================================

-- ---------- 1. The open drawer for a store, created on first money movement ---
-- Race-safe: two tills selling at the same instant both try to open. The
-- partial unique index (one_open_shift_per_store) lets exactly one win, and the
-- loser picks up the winner's row instead of failing the sale.
CREATE OR REPLACE FUNCTION app.ensure_drawer(p_business uuid, p_store uuid, p_staff uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r uuid;
BEGIN
  SELECT id INTO r FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  IF r IS NOT NULL THEN RETURN r; END IF;
  INSERT INTO public.cash_shifts(business_id, store_id, opened_by, opening_float)
    VALUES (p_business, p_store, p_staff, 0)
    ON CONFLICT (store_id) WHERE status = 'open' DO NOTHING
    RETURNING id INTO r;
  IF r IS NULL THEN
    SELECT id INTO r FROM public.cash_shifts WHERE store_id = p_store AND status = 'open';
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION app.ensure_drawer(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 2. Sales: the seller's session opens the drawer -------------------
CREATE OR REPLACE FUNCTION app.attach_drawer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- An approval invoice takes no money yet; its drawer opens when it is paid.
  -- A layby with no deposit is a promise, not cash in the drawer.
  IF NEW.shift_id IS NOT NULL
     OR NEW.status = 'pending_approval'
     OR (NEW.status = 'layby_open' AND coalesce(NEW.paid, 0) <= 0) THEN
    RETURN NEW;
  END IF;
  NEW.shift_id := app.ensure_drawer(NEW.business_id, NEW.store_id, NEW.created_by);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.attach_drawer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_attach_drawer ON public.sales;
CREATE TRIGGER sales_attach_drawer BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION app.attach_drawer();

-- ---------- 3. Payments: approvals and layby instalments do too --------------
-- A checkout already carries a shift (the sale insert above opened it). These
-- two paths take money against an existing sale, so the drawer has to follow
-- the person holding the cash now.
CREATE OR REPLACE FUNCTION app.attach_drawer_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.sales; r uuid;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = NEW.sale_id;
  IF s.id IS NULL OR s.shift_id IS NOT NULL THEN RETURN NEW; END IF;
  r := app.ensure_drawer(s.business_id, s.store_id, coalesce(NEW.staff_id, s.created_by));
  IF r IS NOT NULL THEN
    UPDATE public.sales SET shift_id = r WHERE id = s.id AND shift_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.attach_drawer_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_attach_drawer ON public.payments;
CREATE TRIGGER payments_attach_drawer AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app.attach_drawer_payment();

-- ---------- 4. Starting cash stays correctable while the drawer is open ------
-- The drawer opens itself with a zero float, so the notes that were already in
-- the till at the start have to be recordable afterwards; otherwise every
-- Z-report reads "over" by the float.
CREATE OR REPLACE FUNCTION app.set_shift_float(p_token uuid, p_shift uuid, p_float numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me public.staff; sh public.cash_shifts;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_float IS NULL OR p_float < 0 OR p_float > 100000000 THEN RAISE EXCEPTION 'Enter a valid starting amount'; END IF;
  SELECT * INTO sh FROM public.cash_shifts
    WHERE id = p_shift AND business_id = me.business_id AND status = 'open' FOR UPDATE;
  IF sh.id IS NULL THEN RAISE EXCEPTION 'Drawer is not open'; END IF;
  IF me.role = 'cashier' AND me.store_id IS NOT NULL AND me.store_id <> sh.store_id THEN
    RAISE EXCEPTION 'You are not assigned to this store';
  END IF;
  UPDATE public.cash_shifts SET opening_float = p_float WHERE id = sh.id;
END $$;
REVOKE ALL ON FUNCTION app.set_shift_float(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_shift_float(p_token uuid, p_shift uuid, p_float numeric)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT app.set_shift_float($1,$2,$3)
$$;
REVOKE ALL ON FUNCTION public.set_shift_float(uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shift_float(uuid,uuid,numeric) TO authenticated;
