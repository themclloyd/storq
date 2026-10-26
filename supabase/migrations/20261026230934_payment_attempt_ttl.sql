-- ============================================================================
-- 011 - A cancelled checkout is not a payment
--
-- Every "Pay" press mints a pending intent before the PayChangu widget opens: the
-- provider needs our `tx_ref` up front, and `complete_subscription_payment` prices
-- the purchase from that row. The side effect was permanent. A buyer who opened the
-- checkout and closed it left a `pending` row that `pending_payment_refs` handed
-- back for seven days, so the billing screen kept a "waiting for confirmation"
-- banner up, kept polling for it, kept asking the provider about it from the cron
-- sweep, and listed the click in the ledger as money on its way.
--
-- An intent now lives exactly as long as the checkout session that produced it:
-- thirty minutes, the window `start_store_subscription_payment` already uses to
-- reuse a matching intent. Past that it is closed as `abandoned`, and a row the
-- buyer cancels from the screen closes immediately.
--
-- `abandoned` is not `failed`. A mobile-money charge can land after the browser gave
-- up, so activation still accepts an abandoned row — it is simply no longer proof
-- that anything is about to happen, and it is no longer scanned, counted or shown.
-- ============================================================================

-- ---------- 1. Closing an attempt nobody is going to finish ----------------
-- One rule, three callers: the billing read (before it answers), the explicit
-- cancel on screen, and the reconciler (service role, all tenants).
CREATE OR REPLACE FUNCTION app.close_stale_payment_attempts(p_business uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  closed integer;
BEGIN
  WITH done AS (
    UPDATE public.subscription_payments p
       SET status = 'abandoned'
     WHERE p.status = 'pending'
       AND p.created_at < now() - interval '30 minutes'
       AND (p_business IS NULL OR p.business_id = p_business)
    RETURNING 1
  )
  SELECT count(*)::int INTO closed FROM done;
  RETURN closed;
END $$;

REVOKE ALL ON FUNCTION app.close_stale_payment_attempts(uuid) FROM PUBLIC, anon, authenticated;
-- Only reached through a SECURITY DEFINER body (billing read) or by the cron's
-- service role; custom schemas carry no default grant, so it is named here.
GRANT EXECUTE ON FUNCTION app.close_stale_payment_attempts(uuid) TO service_role;

-- Service-role entry point for the cron sweep, which has no tenant to scope to.
CREATE OR REPLACE FUNCTION public.expire_payment_attempts()
RETURNS integer
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.close_stale_payment_attempts(NULL) $$;

REVOKE ALL ON FUNCTION public.expire_payment_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_payment_attempts() TO service_role;

-- ---------- 2. The billing read only sees live attempts --------------------
-- Same signature, but the window is now the session rather than a week, and it
-- closes what it finds stale on the way past so a shop that never opens this
-- screen still stops being asked about a click it abandoned.
CREATE OR REPLACE FUNCTION app.pending_payment_refs(p_token uuid)
RETURNS TABLE (
  tx_ref text,
  amount numeric,
  currency text,
  stores integer,
  billed_stores integer,
  period text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st public.staff;
BEGIN
  st := app.require_perm_nosub(p_token, ARRAY['money']);
  PERFORM app.close_stale_payment_attempts(st.business_id);
  RETURN QUERY
    SELECT p.tx_ref, p.amount, p.currency, p.stores, p.billed_stores, p.period, p.created_at
      FROM public.subscription_payments p
     WHERE p.business_id = st.business_id
       AND p.status = 'pending'
       AND p.created_at > now() - interval '30 minutes'
     ORDER BY p.created_at DESC
     LIMIT 20;
END $$;

REVOKE ALL ON FUNCTION app.pending_payment_refs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.pending_payment_refs(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pending_payment_refs(p_token uuid)
RETURNS TABLE (
  tx_ref text,
  amount numeric,
  currency text,
  stores integer,
  billed_stores integer,
  period text,
  created_at timestamptz
)
LANGUAGE sql
SET search_path = public
AS $$ SELECT * FROM app.pending_payment_refs($1) $$;

REVOKE ALL ON FUNCTION public.pending_payment_refs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pending_payment_refs(uuid) TO authenticated;

-- ---------- 3. "I didn't pay" ----------------------------------------------
-- Business-wide on purpose: the intent belongs to the shop, not to the till that
-- opened it, and the owner pressing this on one device is clearing the prompt the
-- other device is showing.
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
       SET status = 'abandoned'
     WHERE p.business_id = st.business_id
       AND p.status = 'pending'
    RETURNING 1
  )
  SELECT count(*)::int INTO closed FROM done;
  RETURN closed;
END $$;

REVOKE ALL ON FUNCTION app.cancel_pending_payments(uuid) FROM PUBLIC, anon, authenticated;
-- The public wrapper below is SECURITY INVOKER, so the signed-in till executes this
-- body itself — same arrangement as `app.pending_payment_refs`.
GRANT EXECUTE ON FUNCTION app.cancel_pending_payments(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_pending_payments(p_token uuid)
RETURNS integer
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.cancel_pending_payments($1) $$;

REVOKE ALL ON FUNCTION public.cancel_pending_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_pending_payments(uuid) TO authenticated;

-- ---------- 4. Activation still honours a late settlement ------------------
-- Verbatim 010 body with one condition widened: an `abandoned` row is still a
-- priced intent, so a charge that lands after the session expired activates the
-- term it paid for instead of being refused as "invalid".
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
  IF p.status NOT IN ('pending', 'abandoned') OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
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

-- ---------- 5. Proof -------------------------------------------------------
DO $$
DECLARE
  fn text;
BEGIN
  -- The sweep and the internal helper are unreachable from a browser.
  FOREACH fn IN ARRAY ARRAY[
    'public.expire_payment_attempts()',
    'app.close_stale_payment_attempts(uuid)'
  ]
  LOOP
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'still callable by a signed-in till: %', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'still callable by anon: %', fn;
    END IF;
  END LOOP;

  -- What the screen does need stays reachable.
  IF NOT has_function_privilege('authenticated', 'public.pending_payment_refs(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the billing read is unreachable for a signed-in till';
  END IF;
  IF NOT has_function_privilege('authenticated', 'app.pending_payment_refs(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the inner billing read is unreachable';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cancel_pending_payments(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the cancel button would fail for a signed-in till';
  END IF;
  IF NOT has_function_privilege('authenticated', 'app.cancel_pending_payments(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the cancel button would fail behind its wrapper';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
