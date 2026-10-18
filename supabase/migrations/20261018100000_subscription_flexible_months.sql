-- Allow any whole number of months (1–24) for subscription payments.
-- The old p_period text ('monthly'/'yearly') is replaced by p_months integer.
-- Yearly discount (15%) kicks in at 12+ months so existing behaviour is preserved.
-- Old function signatures are kept as wrappers for any cached clients.

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

  monthly_rate := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END;
  -- 15% discount for 12 or more months
  discount := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  amt := round(monthly_rate * p_stores * p_months * discount, 2);

  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_payments
    (tx_ref, business_id, period, currency, amount, stores, created_by)
  VALUES
    (ref, st.business_id, p_months::text, p_currency, amt, p_stores, st.id);

  RETURN json_build_object(
    'tx_ref',    ref,
    'amount',    amt,
    'currency',  p_currency,
    'stores',    p_stores,
    'months',    p_months
  );
END $$;

REVOKE ALL ON FUNCTION app.start_store_subscription_payment(uuid,integer,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app.start_store_subscription_payment(uuid,integer,text,integer) TO authenticated,service_role;

-- Public wrapper
CREATE OR REPLACE FUNCTION public.start_store_subscription_payment(
  p_token    uuid,
  p_months   integer,
  p_currency text,
  p_stores   integer
) RETURNS json LANGUAGE sql SET search_path=public AS $$
  SELECT app.start_store_subscription_payment($1,$2,$3,$4);
$$;
REVOKE ALL ON FUNCTION public.start_store_subscription_payment(uuid,integer,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_store_subscription_payment(uuid,integer,text,integer) TO authenticated,service_role;

-- complete_subscription_payment: period column now stores the month count as text
-- e.g. '1', '3', '6', '12'. Old rows have 'monthly'/'yearly' — handle both.
CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p           public.subscription_payments;
  s           public.subscriptions;
  target      integer;
  old_slots   integer;
  remaining   double precision;
  duration    double precision;
  p_months    integer;
  monthly_rate numeric;
  discount    numeric;
  expected_amt numeric;
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

  -- Re-derive expected amount server-side to prevent tampering
  monthly_rate := CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END;
  discount     := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  expected_amt := round(monthly_rate * p.stores * p_months * discount, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  old_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  target    := greatest(p.stores, old_slots);

  -- Credit remaining prepaid time proportionally across new slot count
  remaining := greatest(0,
    extract(epoch FROM (coalesce(s.paid_until, now()) - now()))
  ) * old_slots / NULLIF(target, 0);

  -- New duration: p_months × ~30.44 days, scaled by store ratio
  duration := extract(epoch FROM (
    now() + make_interval(months => p_months) - now()
  )) * p.stores / NULLIF(target, 0);

  UPDATE public.subscriptions
     SET paid_until       = now() + make_interval(secs => remaining + duration),
         paid_store_limit = target,
         plan             = CASE WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;

REVOKE ALL ON FUNCTION public.complete_subscription_payment(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_payment(text) TO service_role;
