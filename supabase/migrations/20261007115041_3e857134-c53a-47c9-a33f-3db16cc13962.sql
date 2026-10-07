ALTER TABLE public.subscriptions ADD COLUMN paid_store_limit integer NOT NULL DEFAULT 0;
UPDATE public.subscriptions s SET paid_store_limit = coalesce((SELECT p.stores FROM public.subscription_payments p WHERE p.business_id=s.business_id AND p.status='paid' ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC LIMIT 1),0);

CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.business_id=p_business AND ((s.paid_until>now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id=p_business)) OR (s.trial_ends_at>now() AND coalesce(s.paid_until,'-infinity')<=now())))
$$;

CREATE OR REPLACE FUNCTION public.require_staff(p_token uuid,p_roles text[]) RETURNS public.staff LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.staff;
BEGIN
 st:=public.require_staff_nosub(p_token,p_roles);
 IF NOT public.subscription_active(st.business_id) THEN RAISE EXCEPTION 'Subscription inactive or store limit exceeded: open Billing to continue'; END IF;
 RETURN st;
END $$;

CREATE OR REPLACE FUNCTION app.save_store(p_token uuid,p_id uuid,p_name text,p_type text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me public.staff; s public.subscriptions; n integer; r uuid;
BEGIN
 me:=public.require_staff(p_token,ARRAY['admin']);
 SELECT * INTO s FROM public.subscriptions WHERE business_id=me.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;
 IF p_name IS NULL OR trim(p_name)='' OR p_type IS NULL OR p_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Enter a store name and valid store type'; END IF;
 IF p_id IS NULL THEN
  SELECT count(*) INTO n FROM public.stores WHERE business_id=me.business_id;
  IF s.paid_until>now() THEN
   IF n>=s.paid_store_limit THEN RAISE EXCEPTION 'All paid store slots are in use. Pay for additional capacity on Billing before adding a store'; END IF;
  ELSIF s.trial_ends_at<=now() THEN RAISE EXCEPTION 'Subscription expired: open Billing'; END IF;
  INSERT INTO public.stores(business_id,name,store_type) VALUES(me.business_id,trim(p_name),p_type) RETURNING id INTO r;
 ELSE
  UPDATE public.stores SET name=trim(p_name),store_type=p_type WHERE id=p_id AND business_id=me.business_id RETURNING id INTO r;
  IF r IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
 END IF;
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(p_token uuid,p_period text,p_currency text,p_stores integer) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.staff; s public.subscriptions; n integer; amt numeric; ref text;
BEGIN
 st:=public.require_staff_nosub(p_token,ARRAY['admin','manager']);
 SELECT * INTO s FROM public.subscriptions WHERE business_id=st.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;
 IF p_period IS NULL OR p_period NOT IN ('monthly','yearly') OR p_currency IS NULL OR p_currency NOT IN ('MWK','USD') THEN RAISE EXCEPTION 'Invalid plan'; END IF;
 SELECT greatest(count(*),1) INTO n FROM public.stores WHERE business_id=st.business_id;
 IF p_stores IS NULL OR p_stores<n OR p_stores>1000 OR (s.paid_until>now() AND p_stores<s.paid_store_limit) THEN RAISE EXCEPTION 'Store capacity must cover existing stores and active paid slots (maximum 1000)'; END IF;
 amt:=(CASE WHEN p_currency='MWK' THEN 60000 ELSE 35 END)*p_stores;
 IF p_period='yearly' THEN amt:=round(amt*12*0.85,2); END IF;
 ref:='storq-'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.subscription_payments(tx_ref,business_id,period,currency,amount,stores,created_by) VALUES(ref,st.business_id,p_period,p_currency,amt,p_stores,st.id);
 RETURN json_build_object('tx_ref',ref,'amount',amt,'currency',p_currency,'stores',p_stores);
END $$;
REVOKE ALL ON FUNCTION app.start_store_subscription_payment(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app.start_store_subscription_payment(uuid,text,text,integer) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.start_store_subscription_payment(p_token uuid,p_period text,p_currency text,p_stores integer) RETURNS json LANGUAGE sql SET search_path=public AS $$ SELECT app.start_store_subscription_payment($1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION public.start_store_subscription_payment(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_store_subscription_payment(uuid,text,text,integer) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION app.start_subscription_payment(p_token uuid,p_period text,p_currency text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.staff; n integer;
BEGIN
 st:=public.require_staff_nosub(p_token,ARRAY['admin','manager']);
 SELECT greatest((SELECT count(*) FROM public.stores WHERE business_id=st.business_id),CASE WHEN paid_until>now() THEN paid_store_limit ELSE 0 END,1) INTO n FROM public.subscriptions WHERE business_id=st.business_id;
 RETURN app.start_store_subscription_payment(p_token,p_period,p_currency,n);
END $$;

CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.subscription_payments; s public.subscriptions; target integer; old_slots integer; remaining double precision; duration double precision;
BEGIN
 SELECT * INTO p FROM public.subscription_payments WHERE tx_ref=p_tx_ref FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
 IF p.status='paid' THEN RETURN; END IF;
 IF p.status<>'pending' OR p.stores<1 OR p.period NOT IN ('monthly','yearly') OR p.currency NOT IN ('MWK','USD') OR p.amount<>round((CASE WHEN p.currency='MWK' THEN 60000 ELSE 35 END)*p.stores*(CASE WHEN p.period='yearly' THEN 12*0.85 ELSE 1 END),2) THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;
 SELECT * INTO s FROM public.subscriptions WHERE business_id=p.business_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;
 old_slots:=CASE WHEN s.paid_until>now() THEN s.paid_store_limit ELSE 0 END;
 target:=greatest(p.stores,old_slots);
 remaining:=greatest(0,extract(epoch FROM (coalesce(s.paid_until,now())-now()))) * old_slots / target;
 duration:=extract(epoch FROM ((now()+CASE WHEN p.period='yearly' THEN interval '1 year' ELSE interval '1 month' END)-now())) * p.stores / target;
 UPDATE public.subscriptions SET paid_until=now()+make_interval(secs=>remaining+duration),paid_store_limit=target,plan=p.period WHERE business_id=p.business_id;
 UPDATE public.subscription_payments SET status='paid',paid_at=now() WHERE tx_ref=p_tx_ref;
END $$;
REVOKE ALL ON FUNCTION public.complete_subscription_payment(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_subscription_payment(text) TO service_role;
