-- Delta pricing: a payment is charged only for the slots it actually buys.
--
-- Before, `start_store_subscription_payment` priced `rate × p_stores × months` on the
-- TOTAL capacity, so raising 1 paid slot to 2 slots re-charged the slot that was
-- already paid for. `complete_subscription_payment` then divided the remaining
-- prepaid time by the new slot count, so the customer also lost runway.
--
-- Now the charged slot count is snapshotted on the payment row as `billed_stores`:
--   * capacity increase on an active subscription → p_stores − paid_store_limit
--   * renewal, first payment or reactivation      → p_stores
-- Completing a capacity purchase leaves the existing expiry alone and only extends
-- it if the new slots paid for a longer term — prepaid time is never clawed back.
-- A renewal still adds its months on top of the current expiry. "Renew and add" is
-- not one purchase: each flow makes its own payment with its own snapshot.

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS billed_stores integer NOT NULL DEFAULT 1;

-- Every historical row was priced on its full slot count, so keep it equal there.
UPDATE public.subscription_payments SET billed_stores = stores WHERE billed_stores <> stores;

ALTER TABLE public.subscription_payments DROP CONSTRAINT IF EXISTS sub_payments_billed_bounds;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT sub_payments_billed_bounds
  CHECK (billed_stores BETWEEN 1 AND 1000 AND billed_stores <= stores);

CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token    uuid,
  p_months   integer,  -- 1–24
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  st  public.staff;
  s   public.subscriptions;
  n   integer;
  amt numeric;
  ref text;
  monthly_rate numeric;
  discount numeric;
  paid_slots integer;
  billed     integer;
BEGIN
  st := public.require_staff_nosub(p_token, ARRAY['admin','manager']);
  SELECT * INTO s FROM public.subscriptions WHERE business_id = st.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Months must be between 1 and 24';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid currency';
  END IF;

  SELECT greatest(count(*), 1) INTO n FROM public.stores WHERE business_id = st.business_id;
  IF p_stores IS NULL OR p_stores < n OR p_stores > 1000
     OR (s.paid_until > now() AND p_stores < s.paid_store_limit) THEN
    RAISE EXCEPTION 'Store capacity must cover existing stores and active paid slots (maximum 1000)';
  END IF;

  -- Slots already covered by a payment. An expired subscription owes nothing, so a
  -- reactivation is again priced on the full capacity.
  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  billed := CASE WHEN paid_slots > 0 AND p_stores > paid_slots
                 THEN p_stores - paid_slots
                 ELSE p_stores END;

  monthly_rate := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END;
  -- 15% discount for 12 or more months
  discount := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  amt := round(monthly_rate * billed * p_months * discount, 2);

  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_payments
    (tx_ref, business_id, period, currency, amount, stores, billed_stores, created_by)
  VALUES
    (ref, st.business_id, p_months::text, p_currency, amt, p_stores, billed, st.id);

  RETURN json_build_object(
    'tx_ref',        ref,
    'amount',        amt,
    'currency',      p_currency,
    'stores',        p_stores,
    'billed_stores', billed,
    'months',        p_months
  );
END $$;

-- Legacy period-based overload: keep the signature for cached clients, but route it
-- through the pricing above so it can never charge the full capacity again.
CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token    uuid,
  p_period   text,
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT app.start_store_subscription_payment(
    $1,
    CASE WHEN $2 = 'yearly' THEN 12 WHEN $2 = 'monthly' THEN 1 ELSE NULL END::integer,
    $3,
    $4
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p           public.subscription_payments;
  s           public.subscriptions;
  target      integer;
  paid_slots  integer;
  billed      integer;
  p_months    integer;
  monthly_rate numeric;
  discount    numeric;
  expected_amt numeric;
  new_until   timestamptz;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;
  IF p.status <> 'pending' OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid subscription payment';
  END IF;

  -- Resolve months from the period column (new integer-as-text, or legacy strings)
  p_months := CASE
    WHEN p.period = 'monthly' THEN 1
    WHEN p.period = 'yearly'  THEN 12
    ELSE p.period::integer
  END;

  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  -- Re-derive expected amount server-side from the snapshot to prevent tampering.
  -- Rows written before billed_stores existed are validated on their full count.
  billed := coalesce(p.billed_stores, p.stores);
  IF billed < 1 OR billed > p.stores THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;

  monthly_rate := CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END;
  discount     := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  expected_amt := round(monthly_rate * billed * p_months * discount, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  target     := greatest(p.stores, paid_slots);

  new_until := CASE
    -- Capacity purchase: the slots already paid for keep their full runway, and the
    -- new ones are active for the term they bought. Never moves the expiry earlier.
    WHEN billed < p.stores AND s.paid_until > now()
      THEN greatest(s.paid_until, now() + make_interval(months => p_months))
    -- Renewal / first payment / reactivation: add the term to the current expiry.
    ELSE greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => p_months)
  END;

  UPDATE public.subscriptions
     SET paid_until       = new_until,
         paid_store_limit = target,
         plan             = CASE WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;
