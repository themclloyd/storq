CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM public;
GRANT USAGE ON SCHEMA app TO authenticated, anon, service_role;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;

DO $$
DECLARE r record; n int; i int; callargs text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_arguments(p.oid) args, pg_get_function_identity_arguments(p.oid) idargs,
           pg_get_function_result(p.oid) res, p.pronargs, has_function_privilege('anon', p.oid, 'execute') anon_ok, p.provolatile
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND p.proname <> 'rls_auto_enable'
      AND (has_function_privilege('authenticated', p.oid, 'execute') OR has_function_privilege('anon', p.oid, 'execute'))
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA app', r.proname, r.idargs);
    callargs := '';
    FOR i IN 1..r.pronargs LOOP
      callargs := callargs || CASE WHEN i > 1 THEN ', ' ELSE '' END || '$' || i;
    END LOOP;
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path = public AS %L',
      r.proname, r.args, r.res, CASE WHEN r.provolatile = 's' THEN 'STABLE' ELSE 'VOLATILE' END,
      format('SELECT app.%I(%s)', r.proname, callargs));
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public', r.proname, r.idargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.idargs);
    EXECUTE format('GRANT EXECUTE ON FUNCTION app.%I(%s) TO authenticated, service_role', r.proname, r.idargs);
    IF r.anon_ok THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.idargs);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.%I(%s) TO anon', r.proname, r.idargs);
    END IF;
  END LOOP;
END $$;

CREATE POLICY "no direct access" ON public.staff_sessions FOR SELECT TO authenticated USING (false);