-- `store_payment_methods` was the only tenant table whose read policy was granted
-- to `public` instead of `authenticated`. The qual is tenant-scoped, so an
-- anonymous caller matched no rows — but that safety was coming from the qual, not
-- from the policy, and every other table gets its rows only from a signed-in
-- session. Tightening the role makes that the rule rather than a consequence.

ALTER POLICY "own store payment methods" ON public.store_payment_methods TO authenticated;

DO $$
DECLARE r text;
BEGIN
  SELECT coalesce(array_to_string(array(
           SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)), ','), '')
    INTO r
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.store_payment_methods'::regclass;

  IF r <> 'authenticated' THEN
    RAISE EXCEPTION 'store_payment_methods read policy still applies to %', coalesce(nullif(r, ''), 'public');
  END IF;
END $$;
