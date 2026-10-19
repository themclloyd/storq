-- ============================================================================
-- Operator surface & database-linter hardening.
--
--   * public.my_platform_role() was SECURITY DEFINER, but the only table it
--     reads (platform_admins) already has an RLS policy binding rows to
--     auth.uid(). The definer privilege buys nothing and the security linter
--     flags it, so it reverts to SECURITY INVOKER. Its body keeps the `active`
--     filter, which RLS alone would not enforce, so a revoked operator still
--     resolves to NULL immediately.
--   * platform_audit_log and platform_deleted_tenants had RLS enabled with ZERO
--     policies — the linter's "RLS enabled but no policies" warning. An explicit
--     deny-all policy for the session roles makes the intent visible; the
--     SECURITY DEFINER ops_* writers and service_role (which bypasses RLS) are
--     unaffected.
--   * ops_* procedures are locked to authenticated (operators only, guarded in
--     bodies by require_platform_admin) and service_role; anon and PUBLIC cannot
--     reach them at all.
-- ============================================================================

-- ---------- 1. my_platform_role: drop the needless definer privilege --------
CREATE OR REPLACE FUNCTION public.my_platform_role() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT role FROM public.platform_admins
   WHERE user_id = (select auth.uid()) AND active
$$;
COMMENT ON FUNCTION public.my_platform_role() IS
  'Caller''s own platform role, or NULL. Runs as INVOKER: platform_admins RLS already scopes to auth.uid(), and the active flag is checked here because the RLS policy does not.';
REVOKE ALL ON FUNCTION public.my_platform_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_platform_role() TO authenticated;

-- ---------- 2. Explicit deny-all policies on the audit tables ---------------
DO $$
BEGIN
  DROP POLICY IF EXISTS "no session access" ON public.platform_audit_log;
  CREATE POLICY "no session access" ON public.platform_audit_log
    FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

  DROP POLICY IF EXISTS "no session access" ON public.platform_deleted_tenants;
  CREATE POLICY "no session access" ON public.platform_deleted_tenants
    FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
END $$;

-- ---------- 3. Reaffirm: no unprivileged role can execute ops_* -------------
-- Operators are authenticated principals; require_platform_admin inside each
-- body rejects a non-operator. anon and the PUBLIC pseudo-role get nothing.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'ops\_%' ESCAPE '\'
      AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- ---------- 4. Proof: identity resolves under INVOKER, locks stay shut ------
-- Rollback-only fixture. It shows the definer flag is gone, a real operator
-- still resolves their role, deactivation still revokes instantly, the audit
-- tables carry an explicit policy, and no ops_* function is reachable by anon.
DO $$
DECLARE b uuid; uid uuid; r text; n integer; definer boolean;
BEGIN
  SELECT id, owner_id INTO b, uid FROM public.businesses LIMIT 1;
  IF b IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'No tenant available for operator hardening checks'; END IF;

  -- my_platform_role is no longer SECURITY DEFINER.
  SELECT prosecdef INTO definer FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'my_platform_role' AND pg_get_function_identity_arguments(p.oid) = '';
  IF definer THEN RAISE EXCEPTION 'my_platform_role is still SECURITY DEFINER'; END IF;

  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  INSERT INTO public.platform_admins(user_id, name, role) VALUES (uid, 'Hardening check operator', 'owner');

  -- An active operator resolves their role exactly as before the INVOKER change.
  r := public.my_platform_role();
  IF r IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'INVOKER my_platform_role lost the operator identity'; END IF;

  -- Deactivation still revokes instantly (the RLS policy alone would not).
  UPDATE public.platform_admins SET active = false WHERE user_id = uid;
  r := public.my_platform_role();
  IF r IS NOT NULL THEN RAISE EXCEPTION 'A revoked operator still resolved a role'; END IF;

  -- Each audit table now has at least one policy (RLS-enabled-with-no-policy gone).
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace nn ON nn.oid = c.relnamespace
   WHERE nn.nspname = 'public' AND c.relname IN ('platform_audit_log', 'platform_deleted_tenants')
     AND EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid);
  IF n <> 2 THEN RAISE EXCEPTION 'an audit table still has RLS enabled with no policy'; END IF;

  -- No unprivileged role reaches the operator console or its audit trail.
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nn ON nn.oid = p.pronamespace
   WHERE nn.nspname = 'public' AND p.proname LIKE 'ops\_%' ESCAPE '\'
     AND has_function_privilege('anon', p.oid, 'execute');
  IF n > 0 THEN RAISE EXCEPTION 'anon can still execute % ops_* function(s)', n; END IF;
  IF has_table_privilege('authenticated', 'public.platform_audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can still SELECT platform_audit_log';
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'operator_hardening_checks_passed_rollback';
EXCEPTION WHEN no_data_found THEN
  IF SQLERRM <> 'operator_hardening_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: my_platform_role is INVOKER and still gates on active; audit tables policy-backed; ops_* and audit closed to unprivileged roles; fixtures rolled back';
END $$;

NOTIFY pgrst, 'reload schema';
