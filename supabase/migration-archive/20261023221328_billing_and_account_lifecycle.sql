-- Account lifecycle: trial length, owner PIN recovery, per-device sign-out.
--
-- Three gaps closed here, all of them ways a paying shop could end up with no
-- way back in:
--
--  * The trial default was one day, so a shop that registered on Friday and
--    came back on Monday was locked out before it ever rang up a sale.
--  * The owner PIN had no recovery path at all: a forgotten digit meant a
--    permanent dead end on a device that only knows the PIN pad.
--  * Signing out called app.lock_all_sessions(), which took every till in the
--    business offline because they share one business login.

-- ---------------------------------------------------------------------------
-- 1. Trial length
-- ---------------------------------------------------------------------------

ALTER TABLE public.subscriptions
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

-- One-time backfill: give trial tenants the two weeks they should have had.
-- greatest() keeps any longer trial already granted, and paid tenants are
-- untouched.
UPDATE public.subscriptions s
   SET trial_ends_at = greatest(s.trial_ends_at, s.created_at + interval '14 days')
 WHERE s.paid_until IS NULL
   AND s.closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Linter: trigger function without a pinned search_path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Linter: unindexed foreign key
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS platform_audit_log_actor_idx
  ON public.platform_audit_log (actor_user_id);

-- ---------------------------------------------------------------------------
-- 4. Per-device sign-out
-- ---------------------------------------------------------------------------

-- Ends only the session this device holds. The business login is shared, so
-- one till signing out must never sign the shop out everywhere. The header
-- token is a second handle on the same row for a client that lost its device
-- id.
CREATE OR REPLACE FUNCTION app.lock_device(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid := app.my_business_id();
  dev text := lower(btrim(coalesce(p_device_id, '')));
  tok uuid := app.request_session_token();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF dev <> '' AND dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN dev := ''; END IF;

  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
     AND ((dev <> '' AND device_id = dev)
          OR (tok IS NOT NULL AND token = tok));

  DELETE FROM public.pin_throttle
   WHERE auth_uid = uid
     AND dev <> ''
     AND device_id = dev
     AND (b IS NULL OR business_id = b);
END $$;

REVOKE ALL ON FUNCTION app.lock_device(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lock_device(p_device_id text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.lock_device($1) $$;

-- ---------------------------------------------------------------------------
-- 5. Owner PIN recovery
-- ---------------------------------------------------------------------------

-- The password that signs the business in can also re-set the owner PIN, but
-- only right after it was actually typed: the PIN pad is what an unattended
-- till exposes, so recovery has to cost a fresh password sign-in rather than
-- ride on a session someone walked away from.
CREATE OR REPLACE FUNCTION app.reset_owner_pin(p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid;
  o public.staff;
  v_seen timestamptz;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 8 digits';
  END IF;

  SELECT id INTO b FROM public.businesses WHERE owner_id = uid;
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;

  SELECT last_sign_in_at INTO v_seen FROM auth.users WHERE id = uid;
  IF v_seen IS NULL OR v_seen < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Confirm your password again to reset the PIN';
  END IF;

  SELECT * INTO o FROM public.staff WHERE business_id = b AND is_owner LIMIT 1;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Owner not found'; END IF;

  -- Two people sharing one PIN would unlock as the wrong person.
  IF public.pin_taken(b, p_pin, o.id) THEN
    RAISE EXCEPTION 'That PIN already belongs to someone else';
  END IF;

  UPDATE public.staff
     SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
   WHERE id = o.id;

  -- Every live till was unlocked with the old PIN, so the reset ends them all
  -- and the new one is the only way back in. Throttle state goes too, or a
  -- locked-out pad would stay locked after a successful reset.
  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
      OR staff_id IN (SELECT id FROM public.staff WHERE business_id = b);
  DELETE FROM public.pin_throttle WHERE business_id = b;
  DELETE FROM public.pin_login_throttle WHERE business_id = b;

  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION app.reset_owner_pin(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_owner_pin(p_pin text)
RETURNS json
LANGUAGE sql
SET search_path = public
AS $$ SELECT app.reset_owner_pin($1) $$;

-- ---------------------------------------------------------------------------
-- 6. Pending subscription payments for the Billing sweep
-- ---------------------------------------------------------------------------

-- The Billing screen is the recovery screen, so this reads while the
-- subscription is inactive: a shop whose payment went through but whose
-- browser never came back needs to find that reference and settle it.
CREATE OR REPLACE FUNCTION app.pending_payment_refs(p_token uuid)
RETURNS TABLE (
  tx_ref text,
  amount numeric,
  currency text,
  stores integer,
  billed_stores integer,
  period text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE st public.staff;
BEGIN
  st := app.require_perm_nosub(p_token, ARRAY['money']);
  RETURN QUERY
    SELECT p.tx_ref, p.amount, p.currency, p.stores, p.billed_stores, p.period, p.created_at
      FROM public.subscription_payments p
     WHERE p.business_id = st.business_id
       AND p.status = 'pending'
       AND p.created_at > now() - interval '7 days'
     ORDER BY p.created_at DESC
     LIMIT 20;
END $$;

REVOKE ALL ON FUNCTION app.pending_payment_refs(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pending_payment_refs(p_token uuid)
RETURNS TABLE (
  tx_ref text,
  amount numeric,
  currency text,
  stores integer,
  billed_stores integer,
  period text,
  created_at timestamptz
)
LANGUAGE sql
SET search_path = public
AS $$ SELECT * FROM app.pending_payment_refs($1) $$;
