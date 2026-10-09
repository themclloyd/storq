ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_ref uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_ref_key ON public.sales (client_ref) WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION app.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me public.staff; s public.sales; r json;
BEGIN
  me := public.require_staff(p_token, array['admin','manager','cashier']);
  IF p_client_ref IS NULL THEN RAISE EXCEPTION 'Missing sale reference'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_client_ref::text));
  SELECT * INTO s FROM public.sales WHERE client_ref = p_client_ref;
  IF s.id IS NOT NULL THEN
    IF s.business_id <> me.business_id THEN RAISE EXCEPTION 'Sale reference already used'; END IF;
    RETURN json_build_object('id', s.id, 'number', s.number, 'status', s.status, 'total', s.total, 'tax', s.tax, 'duplicate', true);
  END IF;
  r := app.checkout(p_token, p_store, p_kind, p_items, p_payment, p_method, p_customer_name, p_customer_phone, p_note);
  UPDATE public.sales SET client_ref = p_client_ref WHERE id = (r->>'id')::uuid;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION app.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.checkout_ref(p_token uuid, p_client_ref uuid, p_store uuid, p_kind text, p_items jsonb, p_payment numeric, p_method text, p_customer_name text, p_customer_phone text, p_note text)
 RETURNS json LANGUAGE sql SET search_path TO 'public'
AS $function$ SELECT app.checkout_ref($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) $function$;
REVOKE ALL ON FUNCTION public.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.role_routine_grants WHERE routine_schema='app' AND routine_name='checkout' AND grantee='authenticated') THEN
    GRANT EXECUTE ON FUNCTION app.checkout_ref(uuid,uuid,uuid,text,jsonb,numeric,text,text,text,text) TO authenticated;
  END IF;
END $$;