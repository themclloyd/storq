-- ============================================================================
-- PIN hashes are for verification, never for reading.
--
-- `staff` is readable by every unlocked tier so the roster, the person picker
-- and the "created by" labels work. The bcrypt PIN hash used to travel with
-- that read: any member could pull every colleague's hash and crack a short
-- PIN offline, then unlock as the owner. The hash now sits outside the
-- client's column grant; the PIN pad and the override checks keep reading it
-- because they run inside SECURITY DEFINER functions as the table owner.
--
-- RLS still scopes rows; this adds the column privilege underneath it. A
-- table-level SELECT grant would reopen the hole, so the guard at the end
-- fails the migration if `pin_hash` becomes readable again.
-- ============================================================================

REVOKE SELECT ON public.staff FROM authenticated, anon;

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO cols
    FROM pg_attribute
   WHERE attrelid = 'public.staff'::regclass
     AND attnum > 0
     AND NOT attisdropped
     AND attname <> 'pin_hash';
  IF cols IS NULL THEN RAISE EXCEPTION 'public.staff has no readable columns'; END IF;
  EXECUTE format('GRANT SELECT (%s) ON public.staff TO authenticated', cols);
END $$;

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.staff', 'pin_hash', 'SELECT') THEN
    RAISE EXCEPTION 'pin_hash is still readable by authenticated';
  END IF;
  IF NOT (has_column_privilege('authenticated', 'public.staff', 'name', 'SELECT')
      AND has_column_privilege('authenticated', 'public.staff', 'permissions', 'SELECT')
      AND has_column_privilege('authenticated', 'public.staff', 'is_owner', 'SELECT')) THEN
    RAISE EXCEPTION 'the readable column grant on public.staff is incomplete';
  END IF;
  IF has_table_privilege('authenticated', 'public.staff', 'INSERT')
     OR has_table_privilege('authenticated', 'public.staff', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.staff', 'DELETE') THEN
    RAISE EXCEPTION 'public.staff gained a write privilege';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
