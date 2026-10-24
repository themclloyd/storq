CREATE OR REPLACE FUNCTION public.require_staff_nosub(p_token uuid, p_roles text[]) RETURNS public.staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  SELECT s.* INTO st FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.token = p_token AND ss.expires_at > now() AND s.active AND s.business_id = public.my_business_id();
  IF st.id IS NULL THEN RAISE EXCEPTION 'Locked: enter your PIN again'; END IF;
  IF NOT (st.role = ANY(p_roles)) THEN RAISE EXCEPTION 'Your role (%) is not allowed to do this', st.role; END IF;
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.subscriptions WHERE business_id = p_business
    AND (trial_ends_at > now() OR coalesce(paid_until, '-infinity') > now()))
$$;

CREATE OR REPLACE FUNCTION public.require_staff(p_token uuid, p_roles text[]) RETURNS public.staff
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.staff;
BEGIN
  st := public.require_staff_nosub(p_token, p_roles);
  IF NOT public.subscription_active(st.business_id) THEN
    RAISE EXCEPTION 'Subscription expired: renew on the Billing page to continue';
  END IF;
  RETURN st;
END $$;

CREATE OR REPLACE FUNCTION public.start_subscription_payment(p_token uuid, p_period text, p_currency text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s staff; n int; amt numeric; ref text;
BEGIN
  s := require_staff_nosub(p_token, ARRAY['admin','manager']);
  IF p_period NOT IN ('monthly','yearly') OR p_currency NOT IN ('MWK','USD') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
  SELECT greatest(count(*),1) INTO n FROM stores WHERE business_id = s.business_id;
  amt := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END * n;
  IF p_period = 'yearly' THEN amt := round(amt * 12 * 0.85, 2); END IF;
  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO subscription_payments (tx_ref, business_id, period, currency, amount, stores, created_by)
  VALUES (ref, s.business_id, p_period, p_currency, amt, n, s.id);
  RETURN json_build_object('tx_ref', ref, 'amount', amt, 'currency', p_currency, 'stores', n);
END $$;

REVOKE EXECUTE ON FUNCTION public.require_staff_nosub(uuid, text[]) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.subscription_active(uuid) FROM public, anon;