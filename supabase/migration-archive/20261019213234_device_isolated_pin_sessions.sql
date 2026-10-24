-- ============================================================================
-- Device-isolated PIN throttling and concurrent multi-device staff sessions.
--
-- Every till in a shop signs in with the ONE business email, so auth.uid() is
-- identical across counters. Before this change:
--   * pin_throttle keyed on (business_id, auth_uid): five bad PINs at counter 1
--     locked PIN entry for the whole business, including every other register.
--   * unlock_with_pin deleted `staff_sessions WHERE auth_uid = uid`: unlocking
--     counter B silently kicked counter A off the same login.
--
-- A stable per-device id (persisted in localStorage on the client, forwarded as
-- p_device_id) now scopes both the failed-attempt counter and the session row to
-- one register, so tills fail and unlock independently.
-- ============================================================================

-- ---------- 1. Throttle and sessions gain a device column -------------------
ALTER TABLE public.pin_throttle ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT '';
-- The old PK locked the whole login; rebuild it around the device too.
ALTER TABLE public.pin_throttle DROP CONSTRAINT IF EXISTS pin_throttle_pkey;
ALTER TABLE public.pin_throttle ADD CONSTRAINT pin_throttle_pkey
  PRIMARY KEY (business_id, auth_uid, device_id);

ALTER TABLE public.staff_sessions ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT '';
UPDATE public.staff_sessions SET device_id = '' WHERE device_id IS NULL;
-- Sessions are now looked up and replaced per device, not per login.
CREATE INDEX IF NOT EXISTS staff_sessions_auth_device_idx
  ON public.staff_sessions (auth_uid, device_id);

-- ---------- 2. unlock_with_pin: per-device throttle and non-destructive swap -
DROP FUNCTION IF EXISTS app.unlock_with_pin(text);
CREATE OR REPLACE FUNCTION app.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE b uuid; uid uuid := auth.uid(); dev text := coalesce(nullif(btrim(p_device_id), ''), '');
  st public.staff; t uuid; thr public.pin_throttle; v_exp timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  b := app.my_business_id();
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN RAISE EXCEPTION 'Wrong PIN'; END IF;

  -- Failed attempts and the lockout belong to THIS device only.
  SELECT * INTO thr FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev FOR UPDATE;
  IF thr.business_id IS NOT NULL AND thr.locked_until IS NOT NULL AND thr.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong PIN attempts. Try again in % minute(s)',
      greatest(1, ceil(extract(epoch FROM (thr.locked_until - now())) / 60)::int);
  END IF;

  SELECT * INTO st FROM public.staff
   WHERE business_id = b AND active AND pin_hash = extensions.crypt(p_pin, pin_hash) LIMIT 1;

  IF st.id IS NULL THEN
    INSERT INTO public.pin_throttle (business_id, auth_uid, device_id, fails, locked_until, updated_at)
    VALUES (b, uid, dev, 1, NULL, now())
    ON CONFLICT (business_id, auth_uid, device_id) DO UPDATE
      SET fails = pin_throttle.fails + 1,
          locked_until = CASE WHEN pin_throttle.fails + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
          updated_at = now();
    RAISE EXCEPTION 'Wrong PIN';
  END IF;

  DELETE FROM public.pin_throttle WHERE business_id = b AND auth_uid = uid AND device_id = dev;
  -- Replace only this device's session; other counters keep their live PIN session.
  DELETE FROM public.staff_sessions WHERE auth_uid = uid AND device_id = dev;
  DELETE FROM public.staff_sessions WHERE expires_at < now();

  v_exp := now() + interval '8 hours';
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, expires_at)
    VALUES (st.id, uid, dev, v_exp) RETURNING token INTO t;
  RETURN json_build_object('token', t, 'id', st.id, 'name', st.name, 'role', st.role,
    'store_id', st.store_id, 'expires_at', v_exp);
END $$;

-- ---------- 3. lock_session: clear only the locking device's throttle --------
CREATE OR REPLACE FUNCTION app.lock_session(p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id(); v_dev text;
BEGIN
  SELECT device_id INTO v_dev FROM public.staff_sessions WHERE token = p_token AND auth_uid = uid;
  DELETE FROM public.staff_sessions ss
   WHERE ss.token = p_token AND (ss.auth_uid = uid OR ss.auth_uid IS NULL
     OR ss.staff_id IN (SELECT id FROM public.staff WHERE business_id = app.my_business_id()));
  IF v_dev IS NOT NULL THEN
    DELETE FROM public.pin_throttle WHERE auth_uid = uid AND device_id = v_dev AND business_id = b;
  ELSE
    DELETE FROM public.pin_throttle WHERE auth_uid = uid;
  END IF;
END $$;

-- lock_all_sessions stays full-account: signing out clears every register's
-- throttle and session for this login (unchanged behaviour, new column ignored).

-- ---------- 4. Reaffirm the RPC surface for the new signature ---------------
DROP FUNCTION IF EXISTS public.unlock_with_pin(text);
CREATE OR REPLACE FUNCTION public.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT app.unlock_with_pin(p_pin, p_device_id)
$$;

REVOKE ALL ON FUNCTION app.unlock_with_pin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app.unlock_with_pin(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unlock_with_pin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.unlock_with_pin(text, text) TO authenticated, service_role;

-- ---------- 5. Proof: throttle is unique per register, not per login ---------
-- Rollback-only fixture, mirroring the guard checks elsewhere in this schema.
-- It asserts the key that gives tills independence, then aborts so the live
-- tables are untouched.
DO $$
DECLARE b uuid; uid uuid; dup boolean := false;
BEGIN
  SELECT id, owner_id INTO b, uid FROM public.businesses LIMIT 1;
  IF b IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'No tenant available for device-isolation checks'; END IF;

  -- One login now holds an independent failed-attempt row per register...
  INSERT INTO public.pin_throttle (business_id, auth_uid, device_id, fails) VALUES (b, uid, 'dev-1', 5);
  INSERT INTO public.pin_throttle (business_id, auth_uid, device_id, fails) VALUES (b, uid, 'dev-2', 2);

  -- ...but the same register cannot hold two rows, so a whole-login lockout
  -- cannot silently re-form behind a device's back.
  BEGIN
    INSERT INTO public.pin_throttle (business_id, auth_uid, device_id, fails) VALUES (b, uid, 'dev-1', 1);
  EXCEPTION WHEN unique_violation THEN dup := true;
  END;
  IF NOT dup THEN RAISE EXCEPTION 'pin_throttle is not keyed per device'; END IF;

  -- A session row carries its device so unlock replaces just that register.
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, expires_at)
    SELECT id, uid, 'dev-1', now() + interval '1 hour' FROM public.staff WHERE business_id = b LIMIT 1;

  RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'device_isolation_checks_passed_rollback';
EXCEPTION WHEN no_data_found THEN
  IF SQLERRM <> 'device_isolation_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: pin_throttle unique per (business, login, device); sessions carry device_id; fixtures rolled back';
END $$;

NOTIFY pgrst, 'reload schema';
