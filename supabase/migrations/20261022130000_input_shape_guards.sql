-- ============================================================================
-- Shape guards for contact data, so a pasted payload cannot be stored as one.
--
-- The client already refuses a value that IS a JSON document or a SQL statement
-- (src/lib/validate.ts: payloadKind + the strict EMAIL_RE), but the client is
-- never the authority: a staff token can be replayed straight against PostgREST.
-- The old server rule was "no spaces or @, and at least one dot", which happily
-- accepted  {"$gt":""}@shop.co  and  a');drop--@shop.co .
--
-- Two layers here:
--   1. stores_email_shape — the table itself only accepts an address made of
--      letters, digits and _ % + - . in the local part and dot-separated labels
--      in the domain. NOT VALID so any address written before this rule stays
--      readable; every INSERT/UPDATE from now on is checked.
--   2. app.save_store applies the same allowlist first, so a legitimate caller
--      reads "Enter a valid email address" instead of a constraint name.
--
-- The SQL below is injection-safe regardless: every write is a parameterized
-- RPC and no function builds SQL from caller text.
-- ============================================================================

-- ---------- 1. Table-level email shape --------------------------------------
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_email_shape;
ALTER TABLE public.stores ADD CONSTRAINT stores_email_shape
CHECK (
  email IS NULL OR (
    char_length(email) <= 254
    AND email ~* '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  )
) NOT VALID;

-- ---------- 2. save_store: same allowlist, readable message -----------------
CREATE OR REPLACE FUNCTION app.save_store(
  p_token uuid, p_id uuid, p_name text, p_type text,
  p_phone text DEFAULT NULL, p_email text DEFAULT NULL, p_address text DEFAULT NULL,
  p_tax_number text DEFAULT NULL, p_tax_rate numeric DEFAULT NULL, p_tax_inclusive boolean DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.staff; s public.subscriptions; n integer; r uuid;
  v_phone text; v_email text; v_address text; v_taxno text; v_rate numeric; v_incl boolean;
BEGIN
  me := public.require_staff(p_token, ARRAY['admin']);
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Enter a store name'; END IF;
  IF char_length(btrim(p_name)) > 120 THEN RAISE EXCEPTION 'Store name is too long (max 120 characters)'; END IF;
  IF btrim(p_name) ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Store name contains unsupported characters'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('direct','approval') THEN RAISE EXCEPTION 'Choose a store type'; END IF;

  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 32 OR v_phone !~ '^[+0-9()\- ]{6,32}$') THEN
    RAISE EXCEPTION 'Phone number must be 6-32 characters of digits, + ( ) - and spaces';
  END IF;
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  -- Allowlist, not "anything without a space": braces, quotes, brackets and
  -- semicolons are never part of a real address.
  IF v_email IS NOT NULL AND (
       char_length(v_email) > 254
       OR v_email !~* '^[a-z0-9_%+-]+(\.[a-z0-9_%+-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     ) THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  v_address := nullif(btrim(coalesce(p_address, '')), '');
  IF v_address IS NOT NULL AND char_length(v_address) > 240 THEN
    RAISE EXCEPTION 'Location is too long (max 240 characters)';
  END IF;
  v_taxno := nullif(btrim(coalesce(p_tax_number, '')), '');
  IF v_taxno IS NOT NULL AND char_length(v_taxno) > 40 THEN
    RAISE EXCEPTION 'VAT number is too long (max 40 characters)';
  END IF;
  IF (v_email IS NOT NULL AND v_email ~ '[[:cntrl:]<>]')
     OR (v_address IS NOT NULL AND v_address ~ '[[:cntrl:]<>]')
     OR (v_taxno IS NOT NULL AND v_taxno ~ '[[:cntrl:]<>]') THEN
    RAISE EXCEPTION 'Location details contain unsupported characters';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = me.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;

  IF p_id IS NULL THEN
    SELECT count(*) INTO n FROM public.stores WHERE business_id = me.business_id;
    IF s.paid_until > now() THEN
      IF n >= s.paid_store_limit THEN RAISE EXCEPTION 'All paid store slots are in use. Pay for additional capacity on Billing before adding a store'; END IF;
    ELSIF s.trial_ends_at <= now() THEN
      RAISE EXCEPTION 'Subscription expired: open Billing';
    ELSIF n >= 1 THEN
      RAISE EXCEPTION 'The free trial covers one store. Pay on Billing to add more stores';
    END IF;
    -- A new location inherits the business VAT default until it is changed.
    SELECT tax_rate, tax_inclusive INTO v_rate, v_incl FROM public.businesses WHERE id = me.business_id;
    IF p_tax_rate IS NOT NULL THEN v_rate := p_tax_rate; END IF;
    v_incl := coalesce(p_tax_inclusive, v_incl, true);
    IF v_rate IS NULL OR v_rate NOT BETWEEN 0 AND 50 THEN
      RAISE EXCEPTION 'Tax rate must be between 0 and 50 percent';
    END IF;
    INSERT INTO public.stores(business_id, name, store_type, phone, email, address, tax_number, tax_rate, tax_inclusive)
      VALUES (me.business_id, btrim(p_name), p_type, v_phone, v_email, v_address, v_taxno, v_rate, v_incl)
      RETURNING id INTO r;
  ELSE
    IF p_tax_rate IS NOT NULL AND (p_tax_rate < 0 OR p_tax_rate > 50) THEN
      RAISE EXCEPTION 'Tax rate must be between 0 and 50 percent';
    END IF;
    UPDATE public.stores
       SET name = btrim(p_name), store_type = p_type, phone = v_phone, email = v_email,
           address = v_address, tax_number = v_taxno,
           tax_rate = coalesce(p_tax_rate, tax_rate),
           tax_inclusive = coalesce(p_tax_inclusive, tax_inclusive)
     WHERE id = p_id AND business_id = me.business_id
     RETURNING id INTO r;
    IF r IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  END IF;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.save_store(uuid, uuid, text, text, text, text, text, text, numeric, boolean) TO authenticated, service_role;

-- ---------- 3. Proof (rollback only) ----------------------------------------
-- The constraint must reject every payload shape and still accept real addresses.
DO $$
DECLARE
  b uuid;
BEGIN
  SELECT id INTO b FROM public.businesses ORDER BY created_at LIMIT 1;
  IF b IS NULL THEN RAISE EXCEPTION 'No tenant available for email shape checks'; END IF;

  -- Real addresses (including plus addressing and sub-domains) are accepted.
  INSERT INTO public.stores(business_id, name, email)
  VALUES (b, 'email shape proof', 'owner+tag@sub.shop.co');

  -- Every one of these is a payload, not an address. A successful insert raises
  -- raise_exception (not check_violation), so it fails the migration loudly.
  BEGIN
    INSERT INTO public.stores(business_id, name, email)
    VALUES (b, 'email shape proof', '{"$gt":""}@shop.co');
    RAISE EXCEPTION 'A JSON local part was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.stores(business_id, name, email)
    VALUES (b, 'email shape proof', 'a'');drop--@shop.co');
    RAISE EXCEPTION 'A SQL payload was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.stores(business_id, name, email)
    VALUES (b, 'email shape proof', 'owner@shop');
    RAISE EXCEPTION 'A dotless domain was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE EXCEPTION USING ERRCODE = 'P0002',
    MESSAGE = 'email_shape_checks_passed_rollback';
EXCEPTION WHEN no_data_found THEN
  IF SQLERRM <> 'email_shape_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: stores.email accepts real addresses and rejects JSON/SQL payload shapes; fixtures rolled back';
END $$;

NOTIFY pgrst, 'reload schema';
