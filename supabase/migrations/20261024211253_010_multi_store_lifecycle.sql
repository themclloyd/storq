-- ============================================================================
-- 010 - The multi-store lifecycle
--
-- Three gaps, each one a real shop's story:
--
-- 1. A branch that closed could never leave the account. A location is now
--    archived rather than deleted (Square's rule exactly: "you cannot delete it,
--    you can deactivate it"), so every sale, shift and movement stays readable,
--    the slot stops being consumed, and reopening the branch is one tap.
--
-- 2. A capacity purchase was co-terminous in what it granted but not in what it
--    charged. Adding a slot for "1 month" rode the whole remaining term for one
--    month's price; adding one slot for 12 months moved the shared expiry and
--    extended every location while only the new slot was billed. A new slot now
--    joins the term already paid for, is priced on the months that are actually
--    left, and the expiry does not move. The month count is derived, never picked,
--    and the yearly discount follows the length of that derived term.
--
-- 3. Renewal billed the paid slot count, so spare capacity could never be
--    released: closing a branch meant paying for it forever. Renewal now bills
--    the live locations, and capacity may drop to them when the term is extended.
--
-- Every count of "how many locations does this tenant run" goes through
-- `app.live_store_count`, so the write gate, the capacity check and the operator
-- roster can never disagree about what an archived location occupies.
-- ============================================================================

-- ---------- 1. Archive, never delete -------------------------------------
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.stores.archived_at IS
  'Set when a location stops trading. Archived locations keep all history, are excluded from the paid-slot count and from every picker, and come back with restore.';

CREATE INDEX IF NOT EXISTS stores_live_idx
  ON public.stores (business_id, created_at) WHERE archived_at IS NULL;

-- One definition of the count every rule below shares.
CREATE OR REPLACE FUNCTION app.live_store_count(p_business uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.stores
   WHERE business_id = p_business AND archived_at IS NULL
$$;

REVOKE ALL ON FUNCTION app.live_store_count(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 2. The write gate reads live locations ------------------------
-- Verbatim `subscription_active()` with `app.live_store_count` in both branches.
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
    AND ((s.paid_until + interval '3 days' > now() AND s.paid_store_limit >= app.live_store_count(p_business))
      -- Trial branch with a 1-day grace, still on a single location, and only while
      -- no paid term is running (a payment takes over the day it lands).
      OR (s.trial_ends_at + interval '1 day' > now() AND coalesce(s.paid_until,'-infinity') <= now()
          AND app.live_store_count(p_business) <= 1)))
$function$;

-- ---------- 3. Capacity is counted in live locations ----------------------
-- The add-location guard inside `app.save_store` must ignore archived rows, or a
-- closed branch would keep occupying a slot forever. Rewritten from the stored
-- definition so the rest of the body (validation, methods, VAT default) cannot
-- drift; the match is asserted, because a silent miss would reintroduce the
-- permanent-charge bug this migration exists to remove. The pattern tolerates
-- case and whitespace so a formatting change upstream cannot slip past it.
DO $$
DECLARE d text; patched text;
BEGIN
  SELECT pg_get_functiondef(
    'app.save_store(uuid,uuid,text,text,text,text,text,text,numeric,boolean,text[])'::regprocedure
  ) INTO d;

  patched := regexp_replace(
    d,
    'from\s+public\.stores\s+where\s+business_id\s*=\s*me\.business_id\s*;',
    'from public.stores where business_id = me.business_id and archived_at is null;',
    'i'
  );

  IF patched = d THEN
    -- Already live-counted (a re-run, or a definition written with the filter).
    IF position('archived_at is null' in d) = 0 THEN
      RAISE EXCEPTION 'app.save_store no longer counts stores in the expected shape';
    END IF;
  ELSE
    EXECUTE patched;
  END IF;
END $$;

-- ---------- 4. Archive and restore ---------------------------------------
-- Archiving is the only way out of a slot. It keeps the row (and therefore every
-- sale, shift, movement and stock line that points at it), refuses to leave the
-- tenant with no location, refuses while the store's drawer is open, and refuses
-- while anyone still works there un-bound from another store. Capacity is not
-- touched: the paid term runs on, and the next renewal prices what is left.
CREATE OR REPLACE FUNCTION app.archive_store(p_token uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.staff;
  s  public.subscriptions;
  st public.stores;
  live int;
  bound int;
  open_shift int;
BEGIN
  -- `require_perm_nosub`, not `require_perm`: a tenant holding more locations than
  -- it paid for is exactly when a branch has to go, and that same condition makes
  -- `subscription_active()` false. Checking the write gate here would lock the only
  -- door out of over-capacity. The `locations` capability is still verified.
  me := app.require_perm_nosub(p_token, ARRAY['locations']);

  -- Same serialization point as save_store and every payment: capacity, the live
  -- count and the archive itself are read and written under one lock.
  SELECT * INTO s FROM public.subscriptions WHERE business_id = me.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;

  SELECT * INTO st FROM public.stores WHERE id = p_id AND business_id = me.business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF st.archived_at IS NOT NULL THEN RAISE EXCEPTION 'That location is already archived'; END IF;

  live := app.live_store_count(me.business_id);
  IF live <= 1 THEN
    RAISE EXCEPTION 'A business needs at least one location. Add the new one before archiving this one';
  END IF;

  SELECT count(*) INTO open_shift FROM public.cash_shifts
   WHERE store_id = p_id AND business_id = me.business_id AND status = 'open';
  IF open_shift > 0 THEN
    RAISE EXCEPTION 'Close the cash shift at this location first';
  END IF;

  SELECT count(*) INTO bound FROM public.staff
   WHERE business_id = me.business_id AND store_id = p_id AND active;
  IF bound > 0 THEN
    RAISE EXCEPTION 'Move the % person(s) who work at this location to another one first', bound;
  END IF;

  -- A departed person's assignment would otherwise pin the store to a branch
  -- nobody trades at. Live people were refused above, so this only clears ghosts.
  UPDATE public.staff SET store_id = NULL
   WHERE business_id = me.business_id AND store_id = p_id AND NOT active;

  UPDATE public.stores SET archived_at = now() WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', p_id,
    'archived_at', now(),
    'live_stores', live - 1,
    'paid_store_limit', s.paid_store_limit,
    'paid_until', s.paid_until
  );
END $$;

CREATE OR REPLACE FUNCTION app.restore_store(p_token uuid, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me public.staff;
  s  public.subscriptions;
  st public.stores;
  live int;
BEGIN
  -- Loosened for the same reason: a lapsed tenant must still be able to put a
  -- location back once they have paid, and the branch checks below decide that.
  me := app.require_perm_nosub(p_token, ARRAY['locations']);

  SELECT * INTO s FROM public.subscriptions WHERE business_id = me.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing: open Billing'; END IF;

  SELECT * INTO st FROM public.stores WHERE id = p_id AND business_id = me.business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF st.archived_at IS NULL THEN RAISE EXCEPTION 'That location is already open'; END IF;

  live := app.live_store_count(me.business_id);
  -- Bringing a location back consumes a slot again, so it obeys the same three
  -- branches as adding one: a running term (or its grace) needs a free paid slot,
  -- a trial covers one location, and a lapsed account has to pay first.
  IF s.paid_until + interval '3 days' > now() THEN
    IF s.paid_store_limit > 0 AND live >= s.paid_store_limit THEN
      RAISE EXCEPTION 'All paid location slots are in use. Buy capacity on Billing, or archive another location';
    END IF;
  ELSIF s.trial_ends_at + interval '1 day' > now() AND coalesce(s.paid_until,'-infinity') <= now() THEN
    IF live >= 1 THEN
      RAISE EXCEPTION 'The free trial covers one location. Pay on Billing to reopen more';
    END IF;
  ELSE
    RAISE EXCEPTION 'Subscription expired: open Billing';
  END IF;

  UPDATE public.stores SET archived_at = NULL WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'live_stores', live + 1);
END $$;

REVOKE ALL ON FUNCTION app.archive_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.archive_store(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app.restore_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.restore_store(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.archive_store(p_token uuid, p_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path = public AS $$
  SELECT app.archive_store($1, $2)
$$;

CREATE OR REPLACE FUNCTION public.restore_store(p_token uuid, p_id uuid)
RETURNS jsonb LANGUAGE sql SET search_path = public AS $$
  SELECT app.restore_store($1, $2)
$$;

REVOKE ALL ON FUNCTION public.archive_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_store(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.restore_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_store(uuid, uuid) TO authenticated;

-- ---------- 5. What a payment row remembers ------------------------------
-- The rate and discount are snapshotted when the intent is minted. Re-deriving
-- them from today's price list would strand a charge that landed across a price
-- change: the money is already with the provider, and the shop would get nothing
-- for it. Backfilled on existing rows from the same constants that priced them.
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS unit_rate numeric;
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS discount numeric;

UPDATE public.subscription_payments p
   SET unit_rate = coalesce(p.unit_rate,
         CASE p.currency WHEN 'MWK' THEN 60000 WHEN 'USD' THEN 35 ELSE 60000 END),
       discount = coalesce(p.discount,
         CASE WHEN (CASE
                      WHEN p.period = 'monthly' THEN 1
                      WHEN p.period = 'yearly'  THEN 12
                      WHEN p.period ~ '^[0-9]+$' THEN p.period::int
                      ELSE 1
                    END) >= 12 THEN 0.85 ELSE 1.0 END)
 WHERE p.unit_rate IS NULL OR p.discount IS NULL;

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS sub_payments_rate_positive,
  DROP CONSTRAINT IF EXISTS sub_payments_discount_range;

ALTER TABLE public.subscription_payments
  ADD CONSTRAINT sub_payments_rate_positive CHECK (unit_rate IS NULL OR unit_rate > 0),
  ADD CONSTRAINT sub_payments_discount_range CHECK (discount IS NULL OR (discount > 0 AND discount <= 1));

-- ---------- 6. One payable intent per shape of purchase -------------------
-- `p_months` is the caller's choice only for a term. A capacity purchase joins
-- the term already bought, so the months are derived from `paid_until` and the
-- expiry is left alone. The same rate card applies to both shapes: 15% off when
-- the months being paid for are twelve or more, so a shop that prepaid a year is
-- not charged the undiscounted rate for the remainder of that same year.
-- A matching pending intent younger than 30 minutes is handed back instead of
-- minting a second charge that could be paid twice.
CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token uuid, p_months integer, p_currency text, p_stores integer
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st        public.staff;
  s         public.subscriptions;
  live      integer;
  amt       numeric;
  ref       text;
  rate      numeric;
  disc      numeric;
  paid_slots integer;
  billed    integer;
  months_to_bill integer;
  capacity_purchase boolean;
  existing  public.subscription_payments;
  projected timestamptz;
BEGIN
  st := public.require_staff_nosub(p_token, ARRAY['admin','manager']);
  SELECT * INTO s FROM public.subscriptions WHERE business_id = st.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;
  IF s.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account is closed. Contact Storq to reopen it.';
  END IF;

  IF p_months IS NULL OR p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Months must be between 1 and 24';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid currency';
  END IF;

  live := app.live_store_count(st.business_id);
  IF p_stores IS NULL OR p_stores < greatest(live, 1) OR p_stores > 1000 THEN
    RAISE EXCEPTION 'Store capacity must cover every live location (maximum 1000)';
  END IF;

  -- Slots already covered by a payment. An expired subscription owes nothing, so a
  -- reactivation is again priced on the full capacity.
  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  capacity_purchase := paid_slots > 0 AND p_stores > paid_slots;

  IF capacity_purchase THEN
    billed := p_stores - paid_slots;
    -- Whole months left on the term the new slots join, rounded up. 2 629 800 is a
    -- mean Gregorian month in seconds; the client mirrors this constant.
    months_to_bill := greatest(ceil(extract(epoch FROM (s.paid_until - now())) / 2629800.0)::int, 1);
    -- Derived, not picked, so the discount can only be the one that term earned.
    disc := CASE WHEN months_to_bill >= 12 THEN 0.85 ELSE 1.0 END;
  ELSE
    billed := p_stores;
    months_to_bill := p_months;
    disc := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
    -- The same horizon the operator console respects, refused before any money
    -- moves rather than after: prepaid time stops at 24 months ahead.
    projected := greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => p_months);
    IF projected > now() + interval '24 months' THEN
      RAISE EXCEPTION 'That would put your expiry more than 24 months out';
    END IF;
  END IF;

  rate := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END;
  amt := round(rate * billed * months_to_bill * disc, 2);

  SELECT * INTO existing
    FROM public.subscription_payments p
   WHERE p.business_id = st.business_id
     AND p.status = 'pending'
     AND p.stores = p_stores
     AND p.currency = p_currency
     AND p.billed_stores = billed
     AND p.period = months_to_bill::text
     AND p.amount = amt
     AND p.created_at > now() - interval '30 minutes'
   ORDER BY p.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN json_build_object(
      'tx_ref', existing.tx_ref, 'amount', existing.amount, 'currency', existing.currency,
      'stores', existing.stores, 'billed_stores', existing.billed_stores,
      'months', months_to_bill, 'reused', true
    );
  END IF;

  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_payments
    (tx_ref, business_id, period, currency, amount, stores, billed_stores, unit_rate, discount, created_by)
  VALUES
    (ref, st.business_id, months_to_bill::text, p_currency, amt, p_stores, billed, rate, disc, st.id);

  RETURN json_build_object(
    'tx_ref', ref, 'amount', amt, 'currency', p_currency,
    'stores', p_stores, 'billed_stores', billed,
    'months', months_to_bill, 'reused', false
  );
END $$;

-- ---------- 7. Activation prices from the snapshot ------------------------
CREATE OR REPLACE FUNCTION public.complete_subscription_payment(p_tx_ref text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p           public.subscription_payments;
  s           public.subscriptions;
  target      integer;
  paid_slots  integer;
  billed      integer;
  p_months    integer;
  rate        numeric;
  disc        numeric;
  expected_amt numeric;
  new_until   timestamptz;
  capacity_purchase boolean;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;
  IF p.status <> 'pending' OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid subscription payment';
  END IF;

  p_months := CASE
    WHEN p.period = 'monthly' THEN 1
    WHEN p.period = 'yearly'  THEN 12
    ELSE p.period::integer
  END;
  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  billed := coalesce(p.billed_stores, p.stores);
  IF billed < 1 OR billed > p.stores THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;

  -- Snapshot first, current constants only for rows written before it existed.
  rate := coalesce(p.unit_rate, CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END);
  disc := coalesce(p.discount, CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END);
  expected_amt := round(rate * billed * p_months * disc, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  capacity_purchase := billed < p.stores;

  -- Capacity may never shrink what is already paid for (a second intent may have
  -- landed in between). A term purchase is the caller's chosen count, including a
  -- renewal that releases spare slots down to the live locations.
  target := CASE WHEN capacity_purchase THEN greatest(p.stores, paid_slots) ELSE p.stores END;

  IF capacity_purchase THEN
    -- The new slots join the term already bought; only a lapsed account needs a
    -- fresh one, because there is nothing left to join.
    new_until := CASE WHEN s.paid_until > now() THEN s.paid_until
                      ELSE now() + make_interval(months => p_months) END;
  ELSE
    new_until := greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => p_months);
  END IF;

  UPDATE public.subscriptions
     SET paid_until       = new_until,
         paid_store_limit = target,
         -- A capacity purchase is a partial term, so it never relabels the plan.
         plan             = CASE WHEN capacity_purchase THEN s.plan
                                 WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END,
         suspended_at     = NULL
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;

-- ---------- 8. Operator: slots are counted live, grace has a name ---------
-- Verbatim `ops_update_subscription` body with the live count and a refusal that
-- can now be followed: archiving a location is the way to free a slot.
DO $$
DECLARE d text; patched text;
BEGIN
  SELECT pg_get_functiondef(
    'public.ops_update_subscription(uuid,integer,integer,timestamp with time zone,integer,text,text)'::regprocedure
  ) INTO d;

  patched := regexp_replace(
    d,
    'SELECT\s+count\(\*\)\s+INTO\s+live\s+FROM\s+public\.stores\s+WHERE\s+business_id\s*=\s*p_business_id\s*;',
    'live := app.live_store_count(p_business_id);',
    'i'
  );
  patched := replace(
    patched,
    'remove those before lowering capacity',
    'archive one before lowering capacity'
  );

  IF position('archive one before lowering capacity' in patched) = 0 THEN
    RAISE EXCEPTION 'ops_update_subscription no longer has the expected slots refusal';
  END IF;

  IF patched = d THEN
    RAISE NOTICE 'ops_update_subscription already counts live stores';
  END IF;

  EXECUTE patched;
END $$;

-- The roster reads the same count, and a tenant inside the paid grace window is
-- still selling — so it gets its own state instead of reading "expired" for three
-- days. Verbatim roster body, four changes.
CREATE OR REPLACE FUNCTION public.ops_business_roster(
  p_q text,
  p_state text,
  p_limit integer,
  p_offset integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE term text; page_rows jsonb; page_total bigint;
BEGIN
  PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);

  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Page size must be between 1 and 100';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid roster page offset';
  END IF;
  IF p_state IS NULL OR p_state NOT IN
     ('all', 'trial', 'active', 'grace', 'expired', 'over_capacity', 'suspended', 'closed') THEN
    RAISE EXCEPTION 'Unknown roster filter';
  END IF;
  IF p_q IS NOT NULL AND char_length(btrim(p_q)) > 120 THEN
    RAISE EXCEPTION 'Search is too long (max 120 characters)';
  END IF;
  term := nullif(lower(btrim(coalesce(p_q, ''))), '');

  SELECT coalesce(jsonb_agg(obj ORDER BY rn), '[]'::jsonb), coalesce(max(tt), 0)
    INTO page_rows, page_total
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY CASE scoped.state
                   WHEN 'over_capacity' THEN 0
                   WHEN 'grace' THEN 1
                   WHEN 'expired' THEN 2
                   WHEN 'suspended' THEN 3
                   WHEN 'trial' THEN 4
                   WHEN 'closed' THEN 5
                   ELSE 6
                 END,
                 scoped.name
      ) AS rn,
      count(*) OVER () AS tt,
      jsonb_build_object(
        'id', scoped.id,
        'name', scoped.name,
        'currency', scoped.currency,
        'owner_email', scoped.owner_email,
        'store_count', scoped.store_count,
        'staff_count', scoped.staff_count,
        'plan', scoped.plan,
        'paid_store_limit', scoped.paid_store_limit,
        'paid_until', scoped.paid_until,
        'trial_ends_at', scoped.trial_ends_at,
        'suspended_at', scoped.suspended_at,
        'closed_at', scoped.closed_at,
        'state', scoped.state,
        'last_sale_at', scoped.last_sale_at,
        'created_at', scoped.created_at
      ) AS obj
    FROM (
      SELECT base.*,
             CASE
               WHEN base.closed_at IS NOT NULL THEN 'closed'
               WHEN base.suspended_at IS NOT NULL THEN 'suspended'
               WHEN base.paid_until > now() AND base.paid_store_limit >= base.store_count THEN 'active'
               WHEN base.paid_until > now() THEN 'over_capacity'
               -- Inside the 3-day window `subscription_active()` still accepts: the
               -- tills are open, so the label must not say expired.
               WHEN base.paid_until + interval '3 days' > now()
                    AND base.paid_store_limit >= base.store_count THEN 'grace'
               WHEN base.paid_until + interval '3 days' > now() THEN 'over_capacity'
               -- The trial's single grace day counts as trial time, as before.
               WHEN base.trial_ends_at + interval '1 day' > now() THEN 'trial'
               ELSE 'expired'
             END AS state
      FROM (
        SELECT b.id, b.name, b.currency, b.created_at,
               u.email AS owner_email,
               s.trial_ends_at, s.paid_until, s.plan, s.paid_store_limit,
               s.suspended_at, s.closed_at,
               app.live_store_count(b.id) AS store_count,
               (SELECT count(*) FROM public.staff x WHERE x.business_id = b.id AND x.active) AS staff_count,
               (SELECT max(y.created_at) FROM public.sales y WHERE y.business_id = b.id) AS last_sale_at
        FROM public.businesses b
        JOIN public.subscriptions s ON s.business_id = b.id
        LEFT JOIN auth.users u ON u.id = b.owner_id
      ) base
      WHERE term IS NULL
         OR lower(base.name) LIKE '%' || term || '%'
         OR lower(coalesce(base.owner_email, '')) LIKE '%' || term || '%'
         OR EXISTS (
           SELECT 1 FROM public.stores z
            WHERE z.business_id = base.id AND lower(z.name) LIKE '%' || term || '%'
         )
    ) scoped
    WHERE p_state = 'all' OR scoped.state = p_state
    ORDER BY rn
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('rows', page_rows, 'total', page_total);
END $$;

-- ---------- 9. Proof ------------------------------------------------------
-- Structural only: no fixtures, so this is safe on a fresh database and on the
-- live one. Behaviour is covered by the client tests and the archived migration
-- guards that already exercise the pricing path.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'archived_at';
  IF n <> 1 THEN RAISE EXCEPTION 'stores.archived_at is missing'; END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'subscription_payments'
     AND column_name IN ('unit_rate', 'discount');
  IF n <> 2 THEN RAISE EXCEPTION 'subscription_payments is missing its rate snapshot'; END IF;

  IF has_function_privilege('anon', 'public.archive_store(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'archive_store is reachable before signing in';
  END IF;
  IF has_function_privilege('anon', 'public.restore_store(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'restore_store is reachable before signing in';
  END IF;

  -- The gate must read the live count, not every row: an archived location that
  -- still counted would lock a paid tenant out for closing a branch.
  IF position('app.live_store_count' in
      pg_get_functiondef('public.subscription_active(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'subscription_active still counts archived stores';
  END IF;

  IF position('app.live_store_count' in
      pg_get_functiondef('public.ops_business_roster(text,text,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the roster still counts archived stores';
  END IF;

  IF position('archive one before lowering capacity' in
      pg_get_functiondef(
        'public.ops_update_subscription(uuid,integer,integer,timestamp with time zone,integer,text,text)'::regprocedure
      )) = 0 THEN
    RAISE EXCEPTION 'the slots refusal still asks for a removal that does not exist';
  END IF;
END $$;
