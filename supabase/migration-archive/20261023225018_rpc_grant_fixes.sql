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
