-- ============================================================================
-- Make the PIN throttle actually hold, and stop device-id rotation bypassing it.
--
-- The previous app.unlock_with_pin() incremented public.pin_throttle and then
-- RAISE EXCEPTION 'Wrong PIN'. Postgres rolls the whole statement back on an
-- exception, so the increment was erased every time: five wrong PINs never
-- locked anything, and every attempt still paid for a bcrypt compare per active
-- staff row. The function now RETURNS a small JSON verdict instead of raising:
--
--   {ok:true,  token, id, name, role, store_id, expires_at}
--   {ok:false, code:'wrong_pin',  attempts_left}
--   {ok:false, code:'throttled',  retry_after, attempts_left}
--
-- Two counters guard the pad:
--   * per (business, login, device): 5 wrong attempts -> 15 minutes, so one
--     counter cannot lock the other tills in the shop;
--   * per (business, login): 20 wrong attempts -> 15 minutes, so a caller that
--     rotates the client-supplied p_device_id cannot buy unlimited guesses.
-- A correct PIN clears both. Counters live in 15-minute windows so an occasional
-- fat finger yesterday never counts toward today's lock.
--
-- Deploy this migration together with the client that understands `ok:false`.
-- ============================================================================

-- ---------- 1. Login-wide backstop ------------------------------------------
CREATE TABLE IF NOT EXISTS public.pin_login_throttle (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  auth_uid uuid NOT NULL,
  fails integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, auth_uid)
);
ALTER TABLE public.pin_login_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access" ON public.pin_login_throttle;
CREATE POLICY "no direct access" ON public.pin_login_throttle
  FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.pin_login_throttle FROM public, anon, authenticated;
GRANT ALL ON public.pin_login_throttle TO service_role;
COMMENT ON TABLE public.pin_login_throttle IS
  'Login-wide PIN attempt backstop: catches a caller that rotates device ids to dodge the per-device counter.';

ALTER TABLE public.pin_throttle ADD COLUMN IF NOT EXISTS window_start timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.pin_login_throttle DROP CONSTRAINT IF EXISTS pin_login_throttle_fails;
ALTER TABLE public.pin_login_throttle ADD CONSTRAINT pin_login_throttle_fails CHECK (fails >= 0);

-- ---------- 2. unlock_with_pin: counted failures that survive the call ------
CREATE OR REPLACE FUNCTION app.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid;
  v_now timestamptz := now();
  -- A generated uuid or the client's `d-...` fallback; anything else collapses
  -- to the legacy empty bucket so a caller cannot address a shared sentinel.
  dev text := lower(btrim(coalesce(p_device_id, '')));
  v_window constant interval := interval '15 minutes';
  v_device_max constant integer := 5;
  v_login_max constant integer := 20;
  st public.staff;
  t uuid;
  v_exp timestamptz;
  v_dfails integer;
  v_dwin timestamptz;
  v_dlock timestamptz;
  v_lfails integer;
  v_lwin timestamptz;
  v_llock timestamptz;
  v_left integer;
  v_wait integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  b := app.my_business_id();
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;

  IF dev <> '' AND dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN dev := ''; END IF;

  -- The login-wide row is the serialization point: every attempt for this
  -- business login locks it first, so two tills cannot race past the counter.
  INSERT INTO public.pin_login_throttle (business_id, auth_uid)
  VALUES (b, uid)
  ON CONFLICT (business_id, auth_uid) DO NOTHING;

  SELECT fails, window_start, locked_until
    INTO v_lfails, v_lwin, v_llock
    FROM public.pin_login_throttle
   WHERE business_id = b AND auth_uid = uid
   FOR UPDATE;

  SELECT fails, window_start, locked_until
    INTO v_dfails, v_dwin, v_dlock
    FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev
   FOR UPDATE;

  v_dfails := coalesce(v_dfails, 0);
  v_dwin := coalesce(v_dwin, v_now);
  v_lfails := coalesce(v_lfails, 0);
  v_lwin := coalesce(v_lwin, v_now);

  -- An active lock always wins, even when the supplied PIN is correct.
  IF (v_dlock IS NOT NULL AND v_dlock > v_now)
     OR (v_llock IS NOT NULL AND v_llock > v_now) THEN
    v_wait := greatest(1, ceil(extract(epoch FROM (
      greatest(coalesce(v_dlock, '-infinity'::timestamptz),
               coalesce(v_llock, '-infinity'::timestamptz)) - v_now)) / 60)::int);
    RETURN json_build_object('ok', false, 'code', 'throttled',
      'retry_after', v_wait * 60, 'attempts_left', 0);
  END IF;

  -- Windows restart after they expire; success clears both rows outright.
  IF v_now >= v_dwin + v_window THEN v_dfails := 0; v_dwin := v_now; END IF;
  IF v_now >= v_lwin + v_window THEN v_lfails := 0; v_lwin := v_now; END IF;

  IF p_pin IS NOT NULL AND p_pin ~ '^[0-9]{4,8}$' THEN
    SELECT * INTO st FROM public.staff
     WHERE business_id = b AND active
       AND pin_hash = extensions.crypt(p_pin, pin_hash)
     LIMIT 1;
  END IF;

  IF st.id IS NULL THEN
    v_dfails := v_dfails + 1;
    v_lfails := v_lfails + 1;

    -- Persist BEFORE returning: an exception would roll these increments back,
    -- which is exactly why the old throttle never locked anything.
    INSERT INTO public.pin_throttle
      (business_id, auth_uid, device_id, fails, window_start, locked_until, updated_at)
    VALUES
      (b, uid, dev, v_dfails, v_dwin,
       CASE WHEN v_dfails >= v_device_max THEN v_now + v_window END, v_now)
    ON CONFLICT (business_id, auth_uid, device_id) DO UPDATE
      SET fails = excluded.fails,
          window_start = excluded.window_start,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at;

    INSERT INTO public.pin_login_throttle
      (business_id, auth_uid, fails, window_start, locked_until, updated_at)
    VALUES
      (b, uid, v_lfails, v_lwin,
       CASE WHEN v_lfails >= v_login_max THEN v_now + v_window END, v_now)
    ON CONFLICT (business_id, auth_uid) DO UPDATE
      SET fails = excluded.fails,
          window_start = excluded.window_start,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at;

    -- Spoofed/rotated device ids create one row each; expired ones are junk.
    DELETE FROM public.pin_throttle
     WHERE business_id = b AND auth_uid = uid AND device_id <> dev
       AND updated_at < v_now - interval '1 day'
       AND (locked_until IS NULL OR locked_until < v_now);

    IF v_dfails >= v_device_max OR v_lfails >= v_login_max THEN
      RETURN json_build_object('ok', false, 'code', 'throttled',
        'retry_after', extract(epoch FROM v_window)::int, 'attempts_left', 0);
    END IF;

    v_left := greatest(0, v_device_max - v_dfails);
    RETURN json_build_object('ok', false, 'code', 'wrong_pin', 'attempts_left', v_left);
  END IF;

  -- A valid PIN proves the person, so both counters start clean.
  DELETE FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev;
  DELETE FROM public.pin_login_throttle
   WHERE business_id = b AND auth_uid = uid;
  DELETE FROM public.staff_sessions WHERE expires_at < v_now;
  -- Replace only this device's session; other counters keep their live session.
  DELETE FROM public.staff_sessions WHERE auth_uid = uid AND device_id = dev;

  v_exp := v_now + interval '8 hours';
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, expires_at)
  VALUES (st.id, uid, dev, v_exp)
  RETURNING token INTO t;

  RETURN json_build_object('ok', true, 'token', t, 'id', st.id, 'name', st.name,
    'role', st.role, 'store_id', st.store_id, 'expires_at', v_exp);
END $$;

-- ---------- 3. Lock/sign-out clears the new counter too ---------------------
CREATE OR REPLACE FUNCTION app.lock_session(p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id(); v_dev text;
BEGIN
  SELECT device_id INTO v_dev FROM public.staff_sessions WHERE token = p_token AND auth_uid = uid;
  DELETE FROM public.staff_sessions ss
   WHERE ss.token = p_token AND (ss.auth_uid = uid OR ss.auth_uid IS NULL
     OR ss.staff_id IN (SELECT id FROM public.staff WHERE business_id = b));
  IF v_dev IS NOT NULL THEN
    DELETE FROM public.pin_throttle
     WHERE auth_uid = uid AND device_id = v_dev AND business_id = b;
  ELSE
    DELETE FROM public.pin_throttle WHERE auth_uid = uid;
  END IF;
  DELETE FROM public.pin_login_throttle WHERE auth_uid = uid AND business_id = b;
END $$;

CREATE OR REPLACE FUNCTION app.lock_all_sessions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id();
BEGIN
  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
      OR (b IS NOT NULL AND auth_uid IS NULL
          AND staff_id IN (SELECT id FROM public.staff WHERE business_id = b));
  DELETE FROM public.pin_throttle WHERE auth_uid = uid;
  DELETE FROM public.pin_login_throttle WHERE auth_uid = uid;
END $$;

-- ---------- 4. Reaffirm the RPC surface -------------------------------------
DROP FUNCTION IF EXISTS public.unlock_with_pin(text, text);
CREATE OR REPLACE FUNCTION public.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT app.unlock_with_pin(p_pin, p_device_id)
$$;

REVOKE ALL ON FUNCTION app.unlock_with_pin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app.unlock_with_pin(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unlock_with_pin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.unlock_with_pin(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app.lock_session(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app.lock_session(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app.lock_all_sessions() FROM public, anon;
GRANT EXECUTE ON FUNCTION app.lock_all_sessions() TO authenticated, service_role;

-- ---------- 5. Proof (rollback only) ----------------------------------------
-- Five wrong PINs must persist a per-device lock; a different device keeps its
-- own budget; and a caller rotating device ids still hits the login backstop.
DO $$
DECLARE
  b uuid; uid uuid; st_id uuid;
  r json;
  n int;
  v_locked boolean;
BEGIN
  SELECT id, owner_id INTO b, uid FROM public.businesses ORDER BY created_at LIMIT 1;
  IF b IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'No tenant available for throttle checks'; END IF;

  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  INSERT INTO public.staff (business_id, name, role, pin_hash, active)
  VALUES (b, 'throttle proof', 'cashier',
          extensions.crypt('2468', extensions.gen_salt('bf')), true)
  RETURNING id INTO st_id;

  -- Four misses report a shrinking budget; the fifth locks THIS device.
  FOR n IN 1..5 LOOP
    r := app.unlock_with_pin('0000', 'proof-device-a');
    IF r->>'ok' <> 'false' THEN RAISE EXCEPTION 'Attempt % was not rejected', n; END IF;
    IF n < 5 AND (r->>'code' <> 'wrong_pin' OR (r->>'attempts_left')::int <> 5 - n) THEN
      RAISE EXCEPTION 'Attempt % reported the wrong budget: %', n, r;
    END IF;
  END LOOP;
  IF r->>'code' <> 'throttled' THEN RAISE EXCEPTION 'Fifth miss did not lock: %', r; END IF;

  SELECT fails, coalesce(locked_until > now(), false)
    INTO n, v_locked
    FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = 'proof-device-a';
  IF n IS DISTINCT FROM 5 OR NOT v_locked THEN
    RAISE EXCEPTION 'Per-device counter was not persisted (fails=%, locked=%)', n, v_locked;
  END IF;

  -- A correct PIN on a different register is unaffected by that lock.
  r := app.unlock_with_pin('2468', 'proof-device-b');
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'A clean register was blocked: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.pin_throttle
              WHERE business_id = b AND auth_uid = uid AND device_id = 'proof-device-b') THEN
    RAISE EXCEPTION 'A successful unlock left a throttle row behind';
  END IF;

  -- Rotating device ids cannot buy more guesses: the login-wide counter wins.
  INSERT INTO public.pin_login_throttle (business_id, auth_uid, fails, window_start)
  VALUES (b, uid, 19, now())
  ON CONFLICT (business_id, auth_uid) DO UPDATE
    SET fails = 19, window_start = now(), locked_until = NULL;

  r := app.unlock_with_pin('0000', 'proof-device-rotated');
  IF r->>'code' <> 'throttled' THEN
    RAISE EXCEPTION 'Rotating the device id bypassed the login backstop: %', r;
  END IF;
  r := app.unlock_with_pin('2468', 'proof-device-rotated');
  IF r->>'code' <> 'throttled' THEN
    RAISE EXCEPTION 'The login backstop let a correct PIN through during a lock: %', r;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0002',
    MESSAGE = 'pin_throttle_checks_passed_rollback';
EXCEPTION WHEN no_data_found THEN
  IF SQLERRM <> 'pin_throttle_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: per-device and login-wide PIN throttles persist and release independently; fixtures rolled back';
END $$;

NOTIFY pgrst, 'reload schema';
