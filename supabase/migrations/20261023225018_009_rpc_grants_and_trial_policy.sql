-- ============================================================================
-- 009 - RPC grant fixes and the one-day trial policy
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261023225018  rpc_grant_fixes
--   20261023225732  trial_one_day_with_grace
-- ============================================================================

-- --- from 20261023225018_rpc_grant_fixes.sql ------------------------------------
-- Two leftovers from hand-rolled wrappers.
--
-- 1. `app.set_shift_float` was never granted to `authenticated`, and the public
--    wrapper is SECURITY INVOKER. Every "adjust float" on the shifts page raised
--    42501 for the owner as well, so the drawer float could only be set at open.
--    Found by walking every public invoker wrapper and asking whether the inner
--    app.* function is executable by the role that reaches it.
--
-- 2. The wrappers added for device management, PIN recovery and the payment
--    checks still carried the default EXECUTE grant, so `anon` could call them.
--    Each one refuses anon inside — no PIN session token, no platform operator —
--    so nothing leaked, but a function nobody needs before signing in should not
--    be callable before signing in. Supabase also grants EXECUTE to `anon`
--    explicitly through ALTER DEFAULT PRIVILEGES, so revoking from PUBLIC alone
--    changes nothing; both have to go. `checkout`, `checkout_ref` and
--    `setup_business` keep their anon grant: they predate this rule.

GRANT EXECUTE ON FUNCTION app.set_shift_float(uuid, uuid, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.account_devices(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_device(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lock_device(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pending_payment_refs(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_owner_pin(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_pending_payments(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_journal_payment_verification(uuid, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.account_devices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_device(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_device(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_payment_refs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_owner_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_pending_payments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_journal_payment_verification(uuid, text, text, text) TO authenticated;

-- Proof: the reachable set is exactly right, in both directions.
DO $$
DECLARE
  r record;
BEGIN
  IF NOT has_function_privilege('authenticated', 'app.set_shift_float(uuid,uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app.set_shift_float is still unreachable for a signed-in till';
  END IF;

  -- No public wrapper may be reachable by anon unless it was already anon by
  -- design (the three named in the header).
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname NOT IN ('checkout', 'checkout_ref', 'setup_business')
  LOOP
    RAISE EXCEPTION 'still callable by anon: %', r.fn;
  END LOOP;

  -- And nothing the client calls may be missing for authenticated.
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND NOT p.prosecdef
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    RAISE EXCEPTION 'public invoker wrapper not callable by authenticated: %', r.fn;
  END LOOP;
END $$;

-- --- from 20261023225732_trial_one_day_with_grace.sql ---------------------------
-- Free trial: one day, plus one day of grace.
--
-- Fourteen days of free stock was long enough to run a whole trading cycle and
-- never pay for it. The trial is now a single day, and the day it ends is
-- followed by one more day where the tills keep working — the same courtesy a
-- paid term gets, kept to a single day so a free account cannot quietly turn
-- into a free month.
--
-- Existing rows keep the trial they signed up for; only new businesses get the
-- shorter one. Nothing here touches `platform_deleted_tenants`, so a reopened
-- tenant still starts with no trial at all.

ALTER TABLE public.subscriptions
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '1 day');

-- The enforcement point. Everything else (screens, reports, the operator
-- console) is a mirror of this one truth.
CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.business_id = p_business
    AND s.suspended_at IS NULL AND s.closed_at IS NULL
    -- Paid branch with a 3-day grace: the time test stretches past paid_until,
    -- but the capacity test still applies inside the grace window.
    AND ((s.paid_until + interval '3 days' > now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id = p_business))
      -- Trial branch with a 1-day grace, still on a single store, and only while
      -- no paid term is running (a payment takes over the day it lands).
      OR (s.trial_ends_at + interval '1 day' > now() AND coalesce(s.paid_until,'-infinity') <= now()
          AND (SELECT count(*) FROM public.stores WHERE business_id = p_business) <= 1)))
$function$;

-- The operator console derives its own state label, so it has to agree with the
-- function above or a tenant in grace looks locked while it is still selling.
-- Rewritten from the stored definition rather than retyped, so the rest of the
-- body cannot drift: only the trial line changes.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.ops_business_roster(text,text,integer,integer)'::regprocedure)
    INTO d;

  IF position('WHEN base.trial_ends_at > now() THEN ''trial''' in d) = 0 THEN
    RAISE EXCEPTION 'ops_business_roster no longer has the expected trial branch';
  END IF;

  d := replace(
    d,
    'WHEN base.trial_ends_at > now() THEN ''trial''',
    'WHEN base.trial_ends_at + interval ''1 day'' > now() THEN ''trial'''
  );

  IF position('base.trial_ends_at + interval ''1 day'' > now()' in d) = 0 THEN
    RAISE EXCEPTION 'ops_business_roster rewrite did not apply';
  END IF;

  EXECUTE d;
END $$;

-- Proof: the shape of the new clock, checked against a live row rather than by
-- reading the source back.
DO $$
DECLARE
  new_default text;
  ended_12h timestamptz := now() - interval '12 hours';
  ended_2d  timestamptz := now() - interval '2 days';
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO new_default
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.subscriptions'::regclass AND a.attname = 'trial_ends_at';
  IF new_default IS NULL OR position('1 day' in new_default) = 0 THEN
    RAISE EXCEPTION 'trial_ends_at default is still %', coalesce(new_default, 'missing');
  END IF;

  IF ended_2d + interval '1 day' > now() THEN
    RAISE EXCEPTION 'a trial that ended two days ago would still be selling';
  END IF;
  IF NOT (ended_12h + interval '1 day' > now()) THEN
    RAISE EXCEPTION 'a trial that ended twelve hours ago would already be locked';
  END IF;
END $$;

