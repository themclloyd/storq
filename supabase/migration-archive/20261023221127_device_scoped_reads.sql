-- Device-scoped read tier.
--
-- app.session_role() and app.session_store() are called by every SELECT policy
-- on this schema. They used to resolve the account's newest live session
-- (`ORDER BY expires_at DESC LIMIT 1`), which was correct while a business
-- login was shared per device and wrong the moment PIN sessions became
-- per-device: two tills signed in as the same person resolved to whichever
-- session sorted first, so a cashier device could read at the manager tier and
-- a second shop could read the other shop's catalogue.
--
-- The read now resolves from the request's own `x-storq-session` header, which
-- the PostgREST client attaches from the token held by that browser. The
-- header is a hint only: the token still has to belong to the signed-in
-- auth.uid(), still has to be unexpired, and the staff row still has to be
-- active, so a forged or borrowed value resolves to nobody.
--
-- Fallback: when no header arrives (a client mid-update, a curl, the service
-- role), a single live session for the account is unambiguous and keeps
-- reading. Two or more live sessions is exactly the ambiguous case that used
-- to escalate, so it resolves to no tier and no store, and RLS denies.

CREATE OR REPLACE FUNCTION app.request_header(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT nullif(btrim(coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> lower(p_name), ''
  )), '')
$$;

-- Private: only the policy helpers below may read the raw request.
REVOKE ALL ON FUNCTION app.request_header(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.request_session_token()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE raw text := app.request_header('x-storq-session');
BEGIN
  -- Shape check before the cast: a malformed header must read as "no header",
  -- never raise 22P02 from inside an RLS policy.
  IF raw IS NULL OR raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
END $$;

REVOKE ALL ON FUNCTION app.request_session_token() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.session_staff()
RETURNS public.staff
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE tok uuid := app.request_session_token(); st public.staff; n integer;
BEGIN
  IF tok IS NOT NULL THEN
    SELECT s.* INTO st
      FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
     WHERE ss.token = tok AND ss.auth_uid = auth.uid()
       AND ss.expires_at > now() AND s.active;
    IF st.id IS NOT NULL THEN RETURN st; END IF;
    -- A token this account does not own proves nothing; fall through.
  END IF;

  -- No usable header. One live session cannot be confused with another person,
  -- so a single-till device (or a client mid-update) still reads. Two or more
  -- is exactly the case that used to escalate, so it resolves to nobody.
  SELECT count(*) INTO n
    FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
   WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active;
  IF n = 1 THEN
    SELECT s.* INTO st
      FROM public.staff_sessions ss JOIN public.staff s ON s.id = ss.staff_id
     WHERE ss.auth_uid = auth.uid() AND ss.expires_at > now() AND s.active;
  END IF;
  RETURN st;
END $$;

-- Private: it returns a whole staff row, including the column the table grant
-- deliberately withholds from the client.
REVOKE ALL ON FUNCTION app.session_staff() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.session_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT (app.session_staff()).role $$;

CREATE OR REPLACE FUNCTION app.session_store()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT (app.session_staff()).store_id $$;

REVOKE ALL ON FUNCTION app.session_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.session_store() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.session_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.session_store() TO authenticated, service_role;

-- Regression proof, rollback only: builds a tenant with a manager session and
-- a store-bound cashier session, then asserts the header decides the tier.
DO $proof$
DECLARE
  b uuid; sa uuid; st_a uuid; st_b uuid; mgr uuid; csh uuid;
  tok_m uuid; tok_c uuid; row app.staff;
BEGIN
  SELECT u.id INTO sa
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.businesses x WHERE x.owner_id = u.id)
   LIMIT 1;
  IF sa IS NULL THEN RETURN; END IF;   -- fresh database: nothing to build with

  INSERT INTO public.businesses (owner_id, name) VALUES (sa, 'Proof Tenant') RETURNING id INTO b;
  INSERT INTO public.stores (business_id, name) VALUES (b, 'Proof A') RETURNING id INTO st_a;
  INSERT INTO public.stores (business_id, name) VALUES (b, 'Proof B') RETURNING id INTO st_b;
  INSERT INTO public.staff (business_id, name, role, pin_hash, active, is_owner)
    VALUES (b, 'Proof Manager', 'manager', 'x', true, false) RETURNING id INTO mgr;
  INSERT INTO public.staff (business_id, store_id, name, role, pin_hash, active, is_owner)
    VALUES (b, st_a, 'Proof Cashier', 'cashier', 'x', true, false) RETURNING id INTO csh;

  tok_m := gen_random_uuid(); tok_c := gen_random_uuid();
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, token, expires_at)
    VALUES (mgr, sa, 'proof-m', tok_m, now() + interval '1 hour'),
           (csh, sa, 'proof-c', tok_c, now() + interval '1 hour');

  PERFORM set_config('request.jwt.claim.sub', sa::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa)::text, true);

  PERFORM set_config('request.headers', json_build_object('x-storq-session', tok_m)::text, true);
  row := app.session_staff();
  ASSERT row.id = mgr, 'manager header must resolve the manager session';
  ASSERT row.store_id IS NULL, 'manager is not store-bound';

  PERFORM set_config('request.headers', json_build_object('x-storq-session', tok_c)::text, true);
  row := app.session_staff();
  ASSERT row.id = csh, 'cashier header must resolve the cashier session';
  ASSERT row.store_id = st_a, 'cashier must resolve its own store';

  PERFORM set_config('request.headers', '{}', true);
  ASSERT app.session_staff().id IS NULL, 'two live sessions with no header must deny';

  PERFORM set_config('request.headers', json_build_object('x-storq-session', gen_random_uuid())::text, true);
  ASSERT app.session_staff().id IS NULL, 'a forged token must deny';

  DELETE FROM public.staff_sessions WHERE device_id = 'proof-m';
  PERFORM set_config('request.headers', '{}', true);
  row := app.session_staff();
  ASSERT row.id = csh, 'a lone live session keeps reading without a header';

  RAISE EXCEPTION 'proof complete: rolling back';
EXCEPTION WHEN OTHERS THEN
  IF sqlerrm <> 'proof complete: rolling back' THEN RAISE; END IF;
END $proof$;
