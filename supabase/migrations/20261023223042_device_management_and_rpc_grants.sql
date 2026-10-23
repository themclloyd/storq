-- Signed-in tills: list them, end one — plus the grant the last migration missed.
--
-- 1. The three account-level helpers added with the lifecycle work were revoked
--    from `authenticated` while their `public` wrappers are plain SECURITY
--    INVOKER functions. A wrapper runs with the caller's privileges, so the
--    inner call died with "permission denied for function ..." before reaching
--    a single guard: sign-out only cleared the browser, the Billing sweep saw no
--    pending references, and the owner PIN reset could never run. Every other
--    app.* helper behind a wrapper is granted to `authenticated`, so this
--    restores the convention rather than inventing a second one.
--
-- 2. The business login is shared by every till, so "which devices are open and
--    who is on them" had no answer anywhere in the product: a phone left signed
--    in on a counter stayed live for eight hours with nothing able to end it.

-- ---------------------------------------------------------------------------
-- 1. Restore the grants
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION app.lock_device(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.pending_payment_refs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.reset_owner_pin(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Signed-in tills
-- ---------------------------------------------------------------------------

-- One row per live PIN session in this business, whichever staff member holds
-- it, so the owner can see the shop's devices rather than just their own.
-- `is_current` marks the till asking, which the screen hides behind "this till".
CREATE OR REPLACE FUNCTION app.account_devices(p_token uuid)
RETURNS TABLE (
  device_id text,
  staff_id uuid,
  staff_name text,
  created_at timestamptz,
  expires_at timestamptz,
  is_current boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st public.staff;
BEGIN
  -- Reading the roster is enough to read the device list; ending one needs the
  -- change grant below.
  st := app.require_perm(p_token, ARRAY['staff', 'view_staff']);

  RETURN QUERY
    SELECT s.device_id, s.staff_id, p.name, s.created_at, s.expires_at,
           (s.token = p_token)
      FROM public.staff_sessions s
      JOIN public.staff p ON p.id = s.staff_id
     WHERE s.auth_uid = auth.uid()
       AND s.expires_at > now()
       AND p.business_id = st.business_id
     ORDER BY s.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION app.account_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.account_devices(uuid) TO authenticated;

-- End one till. The session row is the credential, so deleting it is the whole
-- revocation: the next read or write from that device resolves no staff row and
-- falls back to the PIN pad. Throttle state is cleared with it, or a till that
-- was locked out would stay locked out after it was reset.
CREATE OR REPLACE FUNCTION app.revoke_device(p_token uuid, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st public.staff;
  dev text := lower(btrim(coalesce(p_device_id, '')));
  ended integer;
BEGIN
  st := app.require_perm(p_token, ARRAY['staff']);

  IF dev = '' OR dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN
    RAISE EXCEPTION 'Unknown device';
  END IF;

  -- Ending the till you are standing at is a sign-out, and it is done from the
  -- pad. Refusing it here keeps one button from locking the counter it is on.
  IF EXISTS (
    SELECT 1 FROM public.staff_sessions ss
     WHERE ss.token = p_token AND ss.device_id = dev
  ) THEN
    RAISE EXCEPTION 'That is this till — use sign out on it instead';
  END IF;

  DELETE FROM public.staff_sessions s
   USING public.staff p
   WHERE s.staff_id = p.id
     AND p.business_id = st.business_id
     AND s.auth_uid = auth.uid()
     AND s.device_id = dev;
  GET DIAGNOSTICS ended = ROW_COUNT;

  IF ended = 0 THEN
    RAISE EXCEPTION 'That till is no longer signed in';
  END IF;

  DELETE FROM public.pin_throttle
   WHERE auth_uid = auth.uid()
     AND business_id = st.business_id
     AND device_id = dev;

  RETURN json_build_object('ok', true, 'ended', ended);
END $$;

REVOKE ALL ON FUNCTION app.revoke_device(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.revoke_device(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.account_devices(p_token uuid)
RETURNS TABLE (
  device_id text,
  staff_id uuid,
  staff_name text,
  created_at timestamptz,
  expires_at timestamptz,
  is_current boolean
)
LANGUAGE sql
SET search_path = public
AS $$ SELECT * FROM app.account_devices($1) $$;

CREATE OR REPLACE FUNCTION public.revoke_device(p_token uuid, p_device_id text)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.revoke_device($1, $2) $$;

-- ---------------------------------------------------------------------------
-- 3. Proof
-- ---------------------------------------------------------------------------

-- The whole point of the first section: a wrapper can reach its helper.
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'app.lock_device(text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'app.pending_payment_refs(uuid)', 'execute')
     OR NOT has_function_privilege('authenticated', 'app.reset_owner_pin(text)', 'execute') THEN
    RAISE EXCEPTION 'A wrapper would be blocked from its own helper function';
  END IF;
  -- ...and anonymous callers still cannot touch the helpers directly.
  IF has_function_privilege('anon', 'app.reset_owner_pin(text)', 'execute')
     OR has_function_privilege('anon', 'app.revoke_device(uuid,text)', 'execute') THEN
    RAISE EXCEPTION 'anon must not execute account helpers';
  END IF;
END $$;
