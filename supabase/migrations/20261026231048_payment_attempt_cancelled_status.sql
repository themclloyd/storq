-- ============================================================================
-- 012 - Pay the cancelled attempt with the schema's own word
--
-- 011 introduced the lifetime rule but wrote the closing status as `abandoned`,
-- which `sub_payments_bounds` has never allowed (`pending`, `paid`, `failed`,
-- `cancelled` since 001). The sweep therefore raised 23514 the first time it ran,
-- and because the billing read calls it before it answers, an unclosed attempt was
-- enough to break the read instead of settling it.
--
-- `cancelled` is already the vocabulary of this table and of every status field in
-- the schema, so the fix is to use it rather than widen the constraint into two
-- words for one meaning. The three functions are redefined here; nothing else in
-- 011 changes.
-- ============================================================================

-- ---------- 1. The sweep, now legal ---------------------------------------
CREATE OR REPLACE FUNCTION app.close_stale_payment_attempts(p_business uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  closed integer;
BEGIN
  WITH done AS (
    UPDATE public.subscription_payments p
       SET status = 'cancelled'
     WHERE p.status = 'pending'
       AND p.created_at < now() - interval '30 minutes'
       AND (p_business IS NULL OR p.business_id = p_business)
    RETURNING 1
  )
  SELECT count(*)::int INTO closed FROM done;
  RETURN closed;
END $$;

REVOKE ALL ON FUNCTION app.close_stale_payment_attempts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.close_stale_payment_attempts(uuid) TO service_role;

-- ---------- 2. The cancel button ------------------------------------------
CREATE OR REPLACE FUNCTION app.cancel_pending_payments(p_token uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st     public.staff;
  closed integer;
BEGIN
  st := app.require_perm_nosub(p_token, ARRAY['money']);
  WITH done AS (
    UPDATE public.subscription_payments p
       SET status = 'cancelled'
     WHERE p.business_id = st.business_id
       AND p.status = 'pending'
    RETURNING 1
  )
  SELECT count(*)::int INTO closed FROM done;
  RETURN closed;
END $$;

REVOKE ALL ON FUNCTION app.cancel_pending_payments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.cancel_pending_payments(uuid) TO authenticated, service_role;

-- ---------- 3. A late settlement still activates --------------------------
-- Verbatim 011 body with the accepted statuses renamed to match.
CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p           public.subscription_payments;
  s           public.subscriptions;
  target      integer;
  paid_slots  integer;
  billed      integer;
  p_months    integer;
  rate        numeric;
  disc        numeric;
  expected_amt numeric;
  new_until   timestamptz;
  capacity_purchase boolean;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;
  IF p.status NOT IN ('pending', 'cancelled') OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid subscription payment';
  END IF;

  p_months := CASE
    WHEN p.period = 'monthly' THEN 1
    WHEN p.period = 'yearly'  THEN 12
    ELSE p.period::integer
  END;
  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  billed := coalesce(p.billed_stores, p.stores);
  IF billed < 1 OR billed > p.stores THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;

  -- Snapshot first, current constants only for rows written before it existed.
  rate := coalesce(p.unit_rate, CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END);
  disc := coalesce(p.discount, CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END);
  expected_amt := round(rate * billed * p_months * disc, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  capacity_purchase := billed < p.stores;

  -- Capacity may never shrink what is already paid for (a second intent may have
  -- landed in between). A term purchase is the caller's chosen count, including a
  -- renewal that releases spare slots down to the live locations.
  target := CASE WHEN capacity_purchase THEN greatest(p.stores, paid_slots) ELSE p.stores END;

  IF capacity_purchase THEN
    -- The new slots join the term already bought; only a lapsed account needs a
    -- fresh one, because there is nothing left to join.
    new_until := CASE WHEN s.paid_until > now() THEN s.paid_until
                      ELSE now() + make_interval(months => p_months) END;
  ELSE
    new_until := greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => p_months);
  END IF;

  UPDATE public.subscriptions
     SET paid_until       = new_until,
         paid_store_limit = target,
         -- A capacity purchase is a partial term, so it never relabels the plan.
         plan             = CASE WHEN capacity_purchase THEN s.plan
                                 WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END,
         suspended_at     = NULL
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;

-- ---------- 4. Proof -------------------------------------------------------
-- Running the sweep is the proof: it is the statement that raised 23514, and any
-- click older than half an hour is closed here for good.
DO $$
BEGIN
  PERFORM app.close_stale_payment_attempts(NULL);

  IF EXISTS (SELECT 1 FROM public.subscription_payments WHERE status = 'abandoned') THEN
    RAISE EXCEPTION 'a row still carries the status the constraint rejects';
  END IF;
  IF position(
       'cancelled' IN pg_get_functiondef('app.cancel_pending_payments(uuid)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'the cancel path no longer closes an attempt';
  END IF;
  IF position(
       '''cancelled''' IN pg_get_functiondef('public.complete_subscription_payment(text)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'a late settlement would be refused';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
