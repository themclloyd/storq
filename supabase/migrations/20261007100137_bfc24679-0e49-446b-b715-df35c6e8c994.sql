CREATE TABLE public.subscriptions (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  paid_until timestamptz,
  plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (business_id = public.my_business_id());

CREATE TABLE public.subscription_payments (
  tx_ref text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL,
  stores int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sub payments" ON public.subscription_payments FOR SELECT TO authenticated USING (business_id = public.my_business_id());

INSERT INTO public.subscriptions (business_id) SELECT id FROM public.businesses ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.on_business_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN INSERT INTO subscriptions (business_id) VALUES (NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
CREATE TRIGGER business_subscription AFTER INSERT ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.on_business_created();

CREATE OR REPLACE FUNCTION public.start_subscription_payment(p_token uuid, p_period text, p_currency text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s staff; n int; amt numeric; ref text;
BEGIN
  s := require_staff(p_token, ARRAY['admin','manager']);
  IF p_period NOT IN ('monthly','yearly') OR p_currency NOT IN ('MWK','USD') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
  SELECT greatest(count(*),1) INTO n FROM stores WHERE business_id = s.business_id;
  amt := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END * n;
  IF p_period = 'yearly' THEN amt := round(amt * 12 * 0.85, 2); END IF;
  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO subscription_payments (tx_ref, business_id, period, currency, amount, stores, created_by)
  VALUES (ref, s.business_id, p_period, p_currency, amt, n, s.id);
  RETURN json_build_object('tx_ref', ref, 'amount', amt, 'currency', p_currency, 'stores', n);
END $$;

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p subscription_payments; base timestamptz;
BEGIN
  SELECT * INTO p FROM subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF p IS NULL OR p.status = 'paid' THEN RETURN; END IF;
  UPDATE subscription_payments SET status = 'paid', paid_at = now() WHERE tx_ref = p_tx_ref;
  SELECT greatest(now(), coalesce(paid_until, now())) INTO base FROM subscriptions WHERE business_id = p.business_id;
  UPDATE subscriptions SET paid_until = base + CASE WHEN p.period = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
    plan = p.period WHERE business_id = p.business_id;
END $$;
REVOKE ALL ON FUNCTION public.complete_subscription_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_payment(text) TO service_role;