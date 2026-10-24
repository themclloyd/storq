DO $$
DECLARE b public.businesses; st public.staff; token uuid:=gen_random_uuid(); n integer; ref text:='storq-guard-test-'||replace(gen_random_uuid()::text,'-',''); first_end timestamptz; second_end timestamptz; blocked boolean;
BEGIN
 SELECT * INTO b FROM public.businesses LIMIT 1;
 SELECT * INTO st FROM public.staff WHERE business_id=b.id AND active AND role='admin' LIMIT 1;
 IF b.id IS NULL OR st.id IS NULL THEN RAISE EXCEPTION 'No existing admin available for rollback-only guard checks'; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',b.owner_id::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',b.owner_id,'role','authenticated')::text,true);
  INSERT INTO public.staff_sessions(token,staff_id,expires_at) VALUES(token,st.id,now()+interval '5 minutes');
  SELECT count(*) INTO n FROM public.stores WHERE business_id=b.id;
  UPDATE public.subscriptions SET paid_until=now()+interval '1 month',paid_store_limit=n,trial_ends_at=now()+interval '1 day' WHERE business_id=b.id;
  IF NOT public.subscription_active(b.id) THEN RAISE EXCEPTION 'Covered store access failed'; END IF;
  blocked:=false;
  BEGIN
   PERFORM app.save_store(token,NULL,'Rollback-only test store','direct');
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE '%All paid store slots%' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Extra store was not blocked'; END IF;
  UPDATE public.subscriptions SET paid_store_limit=greatest(n-1,0) WHERE business_id=b.id;
  IF public.subscription_active(b.id) THEN RAISE EXCEPTION 'Over-capacity access bypassed guard'; END IF;
  blocked:=false;
  BEGIN PERFORM public.require_staff(token,ARRAY['admin']);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%store limit exceeded%' THEN blocked:=true; ELSE RAISE; END IF; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Staff write guard failed'; END IF;
  UPDATE public.subscriptions SET paid_until=now()+interval '1 month',paid_store_limit=n WHERE business_id=b.id;
  INSERT INTO public.subscription_payments(tx_ref,business_id,period,currency,amount,stores,status,created_by) VALUES(ref,b.id,'monthly','MWK',60000*(n+1),n+1,'pending',st.id);
  PERFORM public.complete_subscription_payment(ref);
  SELECT paid_until INTO first_end FROM public.subscriptions WHERE business_id=b.id;
  IF NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE business_id=b.id AND paid_store_limit=n+1) THEN RAISE EXCEPTION 'Confirmed capacity not activated'; END IF;
  PERFORM public.complete_subscription_payment(ref);
  SELECT paid_until INTO second_end FROM public.subscriptions WHERE business_id=b.id;
  IF first_end<>second_end THEN RAISE EXCEPTION 'Duplicate confirmation granted time'; END IF;
  IF abs(extract(epoch FROM (first_end-now()))-extract(epoch FROM ((now()+interval '1 month')-now()))*(1.0+n::numeric/(n+1)))>3 THEN RAISE EXCEPTION 'Prepaid credit calculation failed'; END IF;
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='guard_checks_passed_rollback';
 EXCEPTION WHEN no_data_found THEN
  IF SQLERRM<>'guard_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: extra stores blocked; over-capacity staff actions blocked; paid slots activated; duplicate confirmation safe; prepaid credit preserved; all fixtures rolled back';
 END;
END $$;