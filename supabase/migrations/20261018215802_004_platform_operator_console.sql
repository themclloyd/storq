-- ============================================================================
-- 004 - Platform operator console and tenant lifecycle
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261018215802  platform_ops_console
--   20261018223519  ops_tenant_actions
--   20261019184820  ops_tenant_lifecycle
--   20261019205208  drop_shared_collection_rpc
-- ============================================================================

-- --- from 20261018215802_platform_ops_console.sql -------------------------------
-- ============================================================================
-- Platform operator console — v1: cross-tenant roster (read-only)
--
-- Every read policy here is `business_id = my_business_id()` and every write RPC
-- demands a staff PIN session, so Storq cannot see its own tenants: there is no
-- way to list businesses, tell how much trial runway one has left, or find the
-- store a customer is locked out of. This adds that surface.
--
-- Operators are deliberately NOT staff. An operator signs in as their own
-- Supabase user, holds no business row and no store access, and is checked by
-- require_platform_admin(), which mirrors require_staff's shape exactly:
-- identity resolved server-side from the JWT subject, the allowed roles supplied
-- by the caller, and a RAISE instead of a NULL on failure so a caller can never
-- forget the check and receive an empty-but-successful result. The rule that the
-- database decides what a session may see still holds; only the principal differs.
--
-- v1 is a roster and nothing else. No subscription mutation lives here — capacity
-- and expiry stay inside the existing payment flow. Granting an operator is a
-- hand-run service-role insert (see the bootstrap note at the bottom) so a
-- compromised console can never mint its own access.
-- ============================================================================

-- ---------- 1. Operator registry -------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  role text NOT NULL DEFAULT 'support' CHECK (role IN ('support', 'billing', 'owner')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_admins IS 'Cross-tenant platform operators. Separate namespace from staff: an operator is never a business member.';

GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- An operator may read only their own row. Cross-tenant visibility is granted
-- inside the definer roster function below, never by opening this table up.
CREATE POLICY "own operator row" ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- ---------- 2. Operator identity -------------------------------------------
-- Client-safe: NULL for an ordinary customer, which is all the sign-in page
-- needs to decide where to send a session. `active` is part of the match, so a
-- revoked operator stops resolving immediately rather than at token expiry.
CREATE OR REPLACE FUNCTION public.my_platform_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.platform_admins
   WHERE user_id = (select auth.uid()) AND active
$$;

-- Guard. Internal only (revoked below), exactly like require_staff.
CREATE OR REPLACE FUNCTION public.require_platform_admin(p_roles text[]) RETURNS public.platform_admins
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pa public.platform_admins;
BEGIN
  SELECT * INTO pa FROM public.platform_admins
   WHERE user_id = (select auth.uid()) AND active;
  IF pa.id IS NULL THEN RAISE EXCEPTION 'Not a platform operator'; END IF;
  IF NOT (pa.role = any(p_roles)) THEN
    RAISE EXCEPTION 'Your operator role (%) is not allowed to do this', pa.role;
  END IF;
  RETURN pa;
END $$;

-- ---------- 3. Cross-tenant roster -----------------------------------------
-- One call returns the page plus the filtered total, so the console never pulls
-- every tenant just to render "of N". The per-tenant aggregates are correlated
-- subqueries over existing FK indexes (stores/staff/sales by business_id, and
-- sales_business_created_idx serves the last-sale lookup), and the work is
-- bounded by p_limit. Owner email comes from auth.users, which only a definer
-- function running as the schema owner can read — that is why this is an RPC and
-- not a view granted to `authenticated`.
--
-- `state` is derived once and then filtered, so the badge a row shows and the
-- filter that selected it can never disagree.
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
  IF p_state IS NULL OR p_state NOT IN ('all', 'trial', 'active', 'expired', 'over_capacity') THEN
    RAISE EXCEPTION 'Unknown roster filter';
  END IF;
  IF p_q IS NOT NULL AND char_length(btrim(p_q)) > 120 THEN
    RAISE EXCEPTION 'Search is too long (max 120 characters)';
  END IF;
  -- Substring match, case-folded. `%`/`_` stay LIKE wildcards on purpose: this is
  -- an internal console, and a typed `MWK%` is a useful search, not an injection.
  term := nullif(lower(btrim(coalesce(p_q, ''))), '');

  SELECT coalesce(jsonb_agg(obj ORDER BY rn), '[]'::jsonb), coalesce(max(tt), 0)
    INTO page_rows, page_total
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY CASE scoped.state
                   WHEN 'over_capacity' THEN 0
                   WHEN 'expired' THEN 1
                   WHEN 'trial' THEN 2
                   ELSE 3
                 END,
                 scoped.name
      ) AS rn,
      -- Window count runs before LIMIT, so this is the filtered total.
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
        'state', scoped.state,
        'last_sale_at', scoped.last_sale_at,
        'created_at', scoped.created_at
      ) AS obj
    FROM (
      SELECT base.*,
             CASE
               WHEN base.paid_until > now() AND base.paid_store_limit >= base.store_count THEN 'active'
               -- Covered by a payment but holding more stores than paid for:
               -- exactly the condition subscription_active() refuses writes on.
               WHEN base.paid_until > now() THEN 'over_capacity'
               WHEN base.trial_ends_at > now() THEN 'trial'
               ELSE 'expired'
             END AS state
      FROM (
        SELECT b.id, b.name, b.currency, b.created_at,
               u.email AS owner_email,
               s.trial_ends_at, s.paid_until, s.plan, s.paid_store_limit,
               (SELECT count(*) FROM public.stores x WHERE x.business_id = b.id) AS store_count,
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

-- ---------- 4. Execute grants ----------------------------------------------
-- my_platform_role is public-to-authenticated because the sign-in flow must be
-- able to ask it. The guard stays internal (same treatment as require_staff),
-- so a client cannot probe which roles a function would accept. The roster is
-- callable by any signed-in principal but raises for non-operators.
REVOKE ALL ON FUNCTION public.my_platform_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_platform_role() TO authenticated;
REVOKE ALL ON FUNCTION public.require_platform_admin(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_business_roster(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_business_roster(text, text, integer, integer) TO authenticated;

-- ---------- 5. Rollback-only guard checks ----------------------------------
-- Same technique as the subscription guard migration: every fixture (the JWT
-- subject, the operator row, the mutated subscription) lives inside one
-- subtransaction that is deliberately aborted at the end, so the checks prove
-- real behaviour and still leave the database untouched.
DO $$
DECLARE b public.businesses; page jsonb; blocked boolean; st text;
BEGIN
  SELECT * INTO b FROM public.businesses LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No tenant available for operator guard checks'; END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', b.owner_id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b.owner_id, 'role', 'authenticated')::text, true);

    -- (a) A customer who is not an operator is refused, and resolves as nobody.
    IF public.my_platform_role() IS NOT NULL THEN
      RAISE EXCEPTION 'A non-operator resolved a platform role';
    END IF;
    blocked := false;
    BEGIN
      PERFORM public.ops_business_roster(NULL, 'all', 10, 0);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Not a platform operator%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Cross-tenant roster was not blocked for a customer'; END IF;

    -- (b) A granted operator reads the roster, including the owner email that
    -- plain `authenticated` can never reach.
    INSERT INTO public.platform_admins(user_id, name) VALUES (b.owner_id, 'Guard check operator');
    IF public.my_platform_role() IS DISTINCT FROM 'support' THEN
      RAISE EXCEPTION 'Operator identity did not resolve';
    END IF;
    page := public.ops_business_roster(NULL, 'all', 10, 0);
    IF (page->>'total')::int < 1 THEN RAISE EXCEPTION 'Roster returned no tenants for an operator'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(page->'rows') r
       WHERE r->>'id' = b.id::text
         AND coalesce(r->>'owner_email', '') <> ''
         AND r->>'state' IN ('trial', 'active', 'expired', 'over_capacity')
    ) THEN RAISE EXCEPTION 'Roster is missing the tenant or its owner email'; END IF;

    -- (c) Over-capacity is derived, not stored: a paid subscription holding more
    -- stores than it paid for must surface as its own state.
    UPDATE public.subscriptions
       SET paid_until = now() + interval '1 month',
           paid_store_limit = greatest(
             (SELECT count(*) FROM public.stores WHERE business_id = b.id) - 1, 0)
     WHERE business_id = b.id;
    SELECT s->>'state' INTO st FROM jsonb_array_elements(public.ops_business_roster(NULL, 'over_capacity', 10, 0)->'rows') s
     WHERE s->>'id' = b.id::text;
    IF st IS DISTINCT FROM 'over_capacity' THEN RAISE EXCEPTION 'Over-capacity tenant was not classified'; END IF;

    -- (d) The state filter and the row badge agree, and bad input is refused.
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.ops_business_roster(b.name, 'all', 10, 0)->'rows') s
       WHERE s->>'id' = b.id::text
    ) THEN RAISE EXCEPTION 'Search by business name did not match its own tenant'; END IF;
    blocked := false;
    BEGIN PERFORM public.ops_business_roster(NULL, 'nonsense', 10, 0);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Unknown roster filter%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Unknown roster filter was accepted'; END IF;
    blocked := false;
    BEGIN PERFORM public.ops_business_roster(NULL, 'all', 5000, 0);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Page size%' THEN blocked := true; ELSE RAISE; END IF;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Unbounded page size was accepted'; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'operator_guard_checks_passed_rollback';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'operator_guard_checks_passed_rollback' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: customer refused cross-tenant roster; operator reads tenants with owner email; over-capacity derived; filters and page bounds enforced; all fixtures rolled back';
  END;
END $$;

-- ---------- 6. Bootstrap (intentionally manual) ----------------------------
-- The first operator is granted by a human with dashboard/service-role access,
-- never by an RPC, so the console cannot escalate itself:
--
--   insert into public.platform_admins(user_id, name, role)
--   select id, 'Your Name', 'owner' from auth.users where email = 'you@example.com';
--
-- `active = false` revokes access instantly and keeps the audit trail.

-- --- from 20261018223519_ops_tenant_actions.sql ---------------------------------
-- Platform operator actions: change one tenant's entitlement, with provenance.
--
-- The roster shipped read-only. This adds the write path, and it deliberately keeps
-- the shape the customer-facing billing flow already has:
--   * capacity is never cheaper than the stores that exist (same floor as
--     app.start_store_subscription_payment),
--   * expiry never moves earlier on its own and never beyond 24 months ahead
--     (same rule complete_subscription_payment derives from a paid snapshot),
--   * a suspension (access ending in the past) is NOT available here at all —
--     that is a different decision with different consequences.
-- One call changes exactly one field, so an audit row always has one meaning.
--
-- `plan` is a label: terms are priced per payment from their month count, never
-- read back from this column, so switching it changes what the account says it is
-- on, not what it costs.
--
-- Every write also lands in `platform_audit_log`, which nothing is allowed to
-- update or delete — the record of who moved what, for which stated reason.

CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Snapshotted, not joined: the trail must outlive the operator account and the
  -- tenant it describes.
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text NOT NULL,
  actor_role text NOT NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  target_label text NOT NULL,
  action text NOT NULL CHECK (action IN ('slots', 'extend', 'until', 'trial', 'plan')),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_audit_log_business_idx
  ON public.platform_audit_log (business_id, created_at DESC);

ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;

-- Supabase grants public tables to anon/authenticated (and through PUBLIC) by
-- default, so the append-only guarantee has to be taken back: no session role reads
-- or writes this table at all. Only the definer functions below touch it, plus
-- service_role for a human operator. RLS is enabled as the second lock.
REVOKE ALL ON public.platform_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_audit_log TO service_role;

-- ── 1. The one write path ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_update_subscription(
  p_business_id uuid,
  p_slots integer DEFAULT NULL,
  p_extend_days integer DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_trial_days integer DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  op      public.platform_admins;
  s       public.subscriptions;
  live    integer;
  intents integer;
  kind    text;
  before_ jsonb;
  after_  jsonb;
  new_slots integer;
  new_until timestamptz;
  new_trial timestamptz;
  new_plan  text;
BEGIN
  -- Support deliberately cannot reach this function: it can read the roster and the
  -- history, but only billing and owner roles move entitlements.
  op := public.require_platform_admin(ARRAY['billing', 'owner']);

  -- Count the intents that were actually supplied, not the ones left out.
  intents := (p_slots IS NOT NULL)::int + (p_extend_days IS NOT NULL)::int
           + (p_until IS NOT NULL)::int + (p_trial_days IS NOT NULL)::int
           + (p_plan IS NOT NULL)::int;
  IF intents <> 1 THEN
    RAISE EXCEPTION 'Change exactly one entitlement per action';
  END IF;
  kind := CASE
    WHEN p_slots IS NOT NULL THEN 'slots'
    WHEN p_extend_days IS NOT NULL THEN 'extend'
    WHEN p_until IS NOT NULL THEN 'until'
    WHEN p_trial_days IS NOT NULL THEN 'trial'
    ELSE 'plan'
  END;

  -- No reason, no change. Kept in the same range the client enforces so a stored
  -- reason is always the one the operator typed.
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 8 AND 300 THEN
    RAISE EXCEPTION 'Say why this changed (8 to 300 characters)';
  END IF;
  p_reason := btrim(p_reason);

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  IF kind = 'slots' THEN
    IF p_slots < 1 OR p_slots > 1000 THEN
      RAISE EXCEPTION 'Slots must be between 1 and 1000';
    END IF;
    SELECT count(*) INTO live FROM public.stores WHERE business_id = p_business_id;
    IF p_slots < live THEN
      RAISE EXCEPTION 'They already have % live stores — remove those before lowering capacity', live;
    END IF;
    IF p_slots = s.paid_store_limit THEN RAISE EXCEPTION 'That is already their capacity'; END IF;
    new_slots := p_slots;
    before_ := jsonb_build_object('slots', s.paid_store_limit);
    after_  := jsonb_build_object('slots', new_slots);
  ELSIF kind = 'extend' THEN
    IF p_extend_days IS NULL OR p_extend_days = 0 OR abs(p_extend_days) > 730 THEN
      RAISE EXCEPTION 'Days must be between 1 and 730, forward or back';
    END IF;
    -- Unpaid time counts from today, never from a date they already missed.
    new_until := greatest(coalesce(s.paid_until, now()), now())
                 + make_interval(days => p_extend_days);
    IF new_until <= now() THEN
      RAISE EXCEPTION 'That would leave them expired. Set an expiry date instead.';
    END IF;
    -- The same horizon the absolute expiry respects, so time cannot be pushed past
    -- 24 months by splitting it into several adjustments.
    IF new_until > now() + interval '24 months' THEN
      RAISE EXCEPTION 'That puts their expiry more than 24 months out';
    END IF;
    before_ := jsonb_build_object('until', s.paid_until);
    after_  := jsonb_build_object('until', new_until);
  ELSIF kind = 'until' THEN
    IF p_until <= now() THEN
      RAISE EXCEPTION 'An expiry in the past stops their tills — that is a suspension, not an entitlement change';
    END IF;
    IF p_until > now() + interval '24 months' THEN
      RAISE EXCEPTION 'Cannot grant more than 24 months ahead';
    END IF;
    IF coalesce(s.paid_until, s.trial_ends_at) IS NOT NULL
       AND abs(extract(epoch FROM p_until - coalesce(s.paid_until, s.trial_ends_at))) < 1 THEN
      RAISE EXCEPTION 'That is already their expiry';
    END IF;
    new_until := p_until;
    before_ := jsonb_build_object('until', s.paid_until);
    after_  := jsonb_build_object('until', new_until);
  ELSIF kind = 'trial' THEN
    IF p_trial_days IS NULL OR p_trial_days NOT BETWEEN 1 AND 90 THEN
      RAISE EXCEPTION 'A trial can be set 1 to 90 days out';
    END IF;
    -- Inert while a paid term is running (paid_until wins), which is exactly how
    -- subscription_active() reads it — useful when a tenant lapses back to trial.
    new_trial := now() + make_interval(days => p_trial_days);
    before_ := jsonb_build_object('trial', s.trial_ends_at);
    after_  := jsonb_build_object('trial', new_trial);
  ELSE
    IF p_plan IS NULL OR p_plan NOT IN ('monthly', 'yearly') THEN
      RAISE EXCEPTION 'Plan must be monthly or yearly';
    END IF;
    IF s.plan = p_plan THEN RAISE EXCEPTION 'They are already recorded as %', p_plan; END IF;
    new_plan := p_plan;
    before_ := jsonb_build_object('plan', s.plan);
    after_  := jsonb_build_object('plan', new_plan);
  END IF;

  UPDATE public.subscriptions
     SET paid_store_limit = CASE WHEN kind = 'slots' THEN new_slots ELSE paid_store_limit END,
         paid_until       = CASE WHEN kind IN ('extend', 'until') THEN new_until ELSE paid_until END,
         trial_ends_at    = CASE WHEN kind = 'trial' THEN new_trial ELSE trial_ends_at END,
         plan             = CASE WHEN kind = 'plan' THEN new_plan ELSE plan END
   WHERE business_id = p_business_id;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_label, actor_role, business_id, target_label,
     action, before_state, after_state, reason)
  SELECT op.user_id, op.name, op.role, p_business_id,
         (SELECT name FROM public.businesses WHERE id = p_business_id),
         kind, before_, after_, p_reason;

  -- Read back what the tenant is now, not what `s` held before the UPDATE.
  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'action', kind,
    'paid_store_limit', CASE WHEN kind = 'slots' THEN new_slots ELSE s.paid_store_limit END,
    'paid_until', CASE WHEN kind IN ('extend', 'until') THEN new_until ELSE s.paid_until END,
    'trial_ends_at', CASE WHEN kind = 'trial' THEN new_trial ELSE s.trial_ends_at END,
    'plan', CASE WHEN kind = 'plan' THEN new_plan ELSE s.plan END
  );
END $$;

-- ── 2. Provenance for the tenant you are about to change ─────────────────
CREATE OR REPLACE FUNCTION public.ops_subscription_history(p_business_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_rows jsonb;
BEGIN
  PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'History length must be between 1 and 50';
  END IF;

  SELECT coalesce(jsonb_agg(obj ORDER BY rn), '[]'::jsonb) INTO page_rows
  FROM (
    SELECT row_number() OVER (ORDER BY created_at DESC) AS rn,
           jsonb_build_object(
             'id', a.id, 'action', a.action,
             'before', a.before_state, 'after', a.after_state,
             'reason', a.reason, 'actor', a.actor_label, 'role', a.actor_role,
             'created_at', a.created_at
           ) AS obj
    FROM public.platform_audit_log a
    WHERE a.business_id = p_business_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('rows', page_rows);
END $$;

-- ── 3. Grants ────────────────────────────────────────────────────────────
-- Postgres hands EXECUTE on new functions to PUBLIC, so that has to be taken back
-- explicitly; only the authenticated role reaches these two, and the role check
-- inside them is the gate. The audit table behind them stays closed to sessions.
REVOKE ALL ON FUNCTION public.ops_update_subscription(
  uuid, integer, integer, timestamptz, integer, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_update_subscription(
  uuid, integer, integer, timestamptz, integer, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.ops_subscription_history(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_subscription_history(uuid, integer) TO authenticated;

-- ── 4. Guard checks that always roll back ────────────────────────────────
-- The write path is only trustworthy if the validations and the audit trail are
-- proven against the real subscriptions row. Everything below runs inside one
-- transaction that is aborted at the end by the trailing RAISE, so the tenant,
-- the synthetic operator and every audit row built here are discarded; no customer
-- data and no entitlement survive it.
DO $$
DECLARE
  op     uuid;
  b      uuid;
  live   integer;
  n      integer;
  t0     timestamptz;
  t1     timestamptz;
  why    text;
  want   integer;
  wantp  text;
  plan2  text;
  bstate jsonb;
  astate jsonb;
  ok     boolean;
BEGIN
  SELECT id INTO b FROM public.businesses ORDER BY created_at LIMIT 1;
  SELECT id INTO op FROM auth.users ORDER BY created_at LIMIT 1;
  IF b IS NULL OR op IS NULL THEN
    -- An empty project has nothing to prove; the checks run as soon as there is a
    -- tenant and an account to act as, which is every real environment. A DO block
    -- cannot RETURN, so the skip leaves through the same caught abort as the pass.
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'operator_write_checks_skipped_no_tenant';
  END IF;

  -- Borrow any account as a billing operator for the length of this transaction. The
  -- write keeps an operator row unique per user, so an account that already operates
  -- is flipped for the probe and the trailing rollback restores its real row.
  INSERT INTO public.platform_admins (user_id, name, role)
    VALUES (op, 'Migration check', 'billing')
    ON CONFLICT (user_id) DO UPDATE
      SET name = 'Migration check', role = 'billing', active = true;
  PERFORM set_config('request.jwt.claim.sub', op::text, true);

  SELECT count(*) INTO live FROM public.stores WHERE business_id = b;
  SELECT paid_until INTO t0 FROM public.subscriptions WHERE business_id = b;

  -- Switching an operator off withdraws the write immediately (the revoke path).
  UPDATE public.platform_admins SET active = false WHERE user_id = op;
  ok := false;
  BEGIN
    PERFORM public.ops_update_subscription(
      b, p_slots => live + 5, p_reason => 'migration guard: revoked operator'
    );
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration check failed: a deactivated operator still changed capacity';
  END IF;
  UPDATE public.platform_admins SET active = true WHERE user_id = op;

  -- Capacity cannot fall below the stores that exist.
  ok := false;
  BEGIN
    PERFORM public.ops_update_subscription(
      b, p_slots => greatest(live - 1, 0), p_reason => 'below the live store count'
    );
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration check failed: capacity dropped below the % live stores', live;
  END IF;

  -- Raising capacity works, is stored, and is journalled with the reason it was given.
  -- Chosen against this tenant's own row so the check holds wherever it is replayed.
  SELECT paid_store_limit INTO want FROM public.subscriptions WHERE business_id = b;
  want := greatest(live + 1, want + 1);
  PERFORM public.ops_update_subscription(b, p_slots => want, p_reason => 'migration guard: capacity check');
  SELECT paid_store_limit INTO n FROM public.subscriptions WHERE business_id = b;
  IF n IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'Migration check failed: capacity did not become %', want;
  END IF;
  SELECT before_state, after_state, reason INTO bstate, astate, why
    FROM public.platform_audit_log
   WHERE business_id = b AND action = 'slots'
   ORDER BY created_at DESC
   LIMIT 1;
  IF bstate IS NULL
     OR astate ->> 'slots' IS DISTINCT FROM want::text
     OR why IS DISTINCT FROM 'migration guard: capacity check' THEN
    RAISE EXCEPTION 'Migration check failed: the capacity change was not journalled with its reason';
  END IF;

  -- The same value again is refused, so the log cannot fill itself with noise.
  ok := false;
  BEGIN
    PERFORM public.ops_update_subscription(b, p_slots => want, p_reason => 'migration guard: repeated value');
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration check failed: a no-op change was accepted';
  END IF;

  -- An expiry in the past is unreachable: stopping a till is a separate decision.
  ok := false;
  BEGIN
    PERFORM public.ops_update_subscription(
      b, p_until => now() - interval '1 day', p_reason => 'migration guard: past expiry'
    );
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration check failed: an expiry in the past was accepted';
  END IF;

  -- Forward time only, and it lands on paid_until exactly.
  PERFORM public.ops_update_subscription(b, p_extend_days => 7, p_reason => 'migration guard: extend check');
  SELECT paid_until INTO t1 FROM public.subscriptions WHERE business_id = b;
  IF t1 IS NULL OR t1 <= t0 THEN
    RAISE EXCEPTION 'Migration check failed: extending did not move the expiry forward';
  END IF;
  IF abs(extract(epoch FROM (t1 - t0)) - 7 * 86400) > 60 THEN
    RAISE EXCEPTION 'Migration check failed: the extension was not the 7 days asked for';
  END IF;

  -- The plan label switches, to whatever this tenant is not recorded as today.
  SELECT CASE WHEN plan = 'yearly' THEN 'monthly' ELSE 'yearly' END INTO wantp
    FROM public.subscriptions WHERE business_id = b;
  PERFORM public.ops_update_subscription(b, p_plan => wantp, p_reason => 'migration guard: plan label');
  SELECT plan INTO plan2 FROM public.subscriptions WHERE business_id = b;
  IF plan2 IS DISTINCT FROM wantp THEN
    RAISE EXCEPTION 'Migration check failed: the plan label did not become %', wantp;
  END IF;

  -- Two intents at once are refused, and so is a change without a real reason.
  ok := false;
  BEGIN
    PERFORM public.ops_update_subscription(
      b, p_slots => want + 1, p_plan => 'monthly', p_reason => 'migration guard: two intents'
    );
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration check failed: two entitlements changed in one call';
  END IF;

  ok := false;
  BEGIN
    PERFORM public.ops_update_subscription(b, p_slots => want + 1, p_reason => 'short');
  EXCEPTION WHEN others THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration check failed: a change without a real reason was accepted';
  END IF;

  -- History reads back what was journalled, to every operator role. Three writes
  -- succeeded above: capacity, the extension and the plan label.
  SELECT jsonb_array_length(public.ops_subscription_history(b, 20) -> 'rows') INTO n;
  IF n < 3 THEN
    RAISE EXCEPTION 'Migration check failed: history returned only % rows for the changes just made', n;
  END IF;

  -- Roll the whole probe back: real entitlements and audit rows must not survive.
  RAISE EXCEPTION USING
    ERRCODE = 'P0002',
    MESSAGE = 'operator_write_checks_passed_rollback';
EXCEPTION
  WHEN no_data_found THEN
    IF SQLERRM = 'operator_write_checks_passed_rollback' THEN
      RAISE NOTICE 'PASS: operator write path, entitlement guards and audit trail verified';
    ELSIF SQLERRM = 'operator_write_checks_skipped_no_tenant' THEN
      RAISE NOTICE 'SKIP: no tenant or auth user to validate the operator write path against';
    ELSE
      RAISE;
    END IF;
END
$$;

-- ── 5. Granting the first operator stays a deliberate manual act ─────────
-- No function in this schema can create or edit an operator row, so a compromised
-- app session cannot promote itself. As the service role:
--   insert into public.platform_admins (user_id, name, role)
--   select id, 'Name', 'owner' from auth.users where email = 'you@example.com';

-- --- from 20261019184820_ops_tenant_lifecycle.sql -------------------------------
-- ============================================================================
-- Platform operator console — tenant lifecycle: suspend, close, purge
--
-- The entitlement RPC can change what a tenant bought. This adds the verbs that
-- change whether a tenant may trade at all, following the ladder every admin
-- console uses (Google Workspace: suspend -> archive -> delete, with recover at
-- each step). Impersonation is deliberately absent: staff authority comes from a
-- PIN session verified by `require_staff`, so an operator session must never turn
-- into one, and an operator must never read a tenant's books.
--
-- Design notes:
-- * Suspension and closure are real states on `subscriptions`, not faked expiry
--   dates. Overwriting `paid_until` to represent an administrative decision would
--   destroy prepaid time the tenant paid for, and the money columns are the
--   ledger the billing rules protect.
-- * `subscription_active()` is the single write gate: `require_staff` calls it on
--   every business write, so one added condition stops tills store-wide while
--   leaving reads (and therefore the tenant's own Billing page) working.
-- * `require_staff_nosub` deliberately skips that gate, which is why a suspended
--   tenant can still pay themselves back to life — and why closure has to be
--   blocked in the payment funnel explicitly: money must not arrive against an
--   account an operator closed for abuse.
-- * Closure is reversible for 30 days. Purge is the only irreversible step, so it
--   demands the owner role, the waiting period, the tenant name retyped exactly,
--   and it first writes a tombstone: `setup_business` is open to anyone who can
--   sign up, so without the tombstone deleting a tenant hands the same account a
--   fresh free trial every time it comes back.
-- ============================================================================

-- ---------- 1. Lifecycle state on the subscription row ----------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Deliberately no CHECK keeping the two apart: closing a suspended tenant leaves
-- the suspension in place underneath, so reopening cannot silently hand back
-- access an operator had restricted. `closed` simply outranks `suspended` in every
-- state derivation, and only `restore` clears the suspension.

-- ---------- 2. The single write gate ---------------------------------------
-- Reads are untouched: a suspended shopkeeper can still open the app, look at
-- their history and pay. Verbatim `subscription_active()` plus the two guards.
CREATE OR REPLACE FUNCTION public.subscription_active(p_business uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.business_id = p_business
    AND s.suspended_at IS NULL AND s.closed_at IS NULL
    AND ((s.paid_until > now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id = p_business))
      OR (s.trial_ends_at > now() AND coalesce(s.paid_until,'-infinity') <= now()
          AND (SELECT count(*) FROM public.stores WHERE business_id = p_business) <= 1)))
$$;

-- ---------- 3. Payment paths around the two states -------------------------
-- A confirmed payment always lifts a suspension: the tenant has done the one thing
-- the state was asking for, and they should not need an operator to notice. A
-- closed account is NOT reopened here — closure is a judgement, not an invoice.
-- Verbatim `complete_subscription_payment` with `suspended_at = NULL` added.
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
  monthly_rate numeric;
  discount    numeric;
  expected_amt numeric;
  new_until   timestamptz;
BEGIN
  SELECT * INTO p FROM public.subscription_payments WHERE tx_ref = p_tx_ref FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status = 'paid' THEN RETURN; END IF;
  IF p.status <> 'pending' OR p.stores < 1 OR p.currency NOT IN ('MWK','USD') THEN
    RAISE EXCEPTION 'Invalid subscription payment';
  END IF;

  -- Resolve months from the period column (new integer-as-text, or legacy strings)
  p_months := CASE
    WHEN p.period = 'monthly' THEN 1
    WHEN p.period = 'yearly'  THEN 12
    ELSE p.period::integer
  END;

  IF p_months < 1 OR p_months > 24 THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  -- Re-derive expected amount server-side from the snapshot to prevent tampering.
  -- Rows written before billed_stores existed are validated on their full count.
  billed := coalesce(p.billed_stores, p.stores);
  IF billed < 1 OR billed > p.stores THEN RAISE EXCEPTION 'Invalid subscription payment'; END IF;

  monthly_rate := CASE WHEN p.currency = 'MWK' THEN 60000 ELSE 35 END;
  discount     := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  expected_amt := round(monthly_rate * billed * p_months * discount, 2);

  IF p.amount <> expected_amt THEN
    RAISE EXCEPTION 'Payment amount does not match expected amount';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  target     := greatest(p.stores, paid_slots);

  new_until := CASE
    -- Capacity purchase: the slots already paid for keep their full runway, and the
    -- new ones are active for the term they bought. Never moves the expiry earlier.
    WHEN billed < p.stores AND s.paid_until > now()
      THEN greatest(s.paid_until, now() + make_interval(months => p_months))
    -- Renewal / first payment / reactivation: add the term to the current expiry.
    ELSE greatest(coalesce(s.paid_until, now()), now()) + make_interval(months => p_months)
  END;

  UPDATE public.subscriptions
     SET paid_until       = new_until,
         paid_store_limit = target,
         plan             = CASE WHEN p_months >= 12 THEN 'yearly' ELSE 'monthly' END,
         suspended_at     = NULL
   WHERE business_id = p.business_id;

  UPDATE public.subscription_payments
     SET status = 'paid', paid_at = now()
   WHERE tx_ref = p_tx_ref;
END $$;

-- A closed tenant cannot buy their way back: `require_staff_nosub` skips the write
-- gate on purpose (a lapsed shop must always be able to pay), so closure is
-- enforced here, in the one funnel that mints payment intents. Verbatim body plus
-- the closed check, right after the row is already locked.
CREATE OR REPLACE FUNCTION app.start_store_subscription_payment(
  p_token uuid, p_months integer, p_currency text, p_stores integer
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st  public.staff;
  s   public.subscriptions;
  n   integer;
  amt numeric;
  ref text;
  monthly_rate numeric;
  discount numeric;
  paid_slots integer;
  billed     integer;
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

  SELECT greatest(count(*), 1) INTO n FROM public.stores WHERE business_id = st.business_id;
  IF p_stores IS NULL OR p_stores < n OR p_stores > 1000
     OR (s.paid_until > now() AND p_stores < s.paid_store_limit) THEN
    RAISE EXCEPTION 'Store capacity must cover existing stores and active paid slots (maximum 1000)';
  END IF;

  -- Slots already covered by a payment. An expired subscription owes nothing, so a
  -- reactivation is again priced on the full capacity.
  paid_slots := CASE WHEN s.paid_until > now() THEN s.paid_store_limit ELSE 0 END;
  billed := CASE WHEN paid_slots > 0 AND p_stores > paid_slots
                 THEN p_stores - paid_slots
                 ELSE p_stores END;

  monthly_rate := CASE WHEN p_currency = 'MWK' THEN 60000 ELSE 35 END;
  -- 15% discount for 12 or more months
  discount := CASE WHEN p_months >= 12 THEN 0.85 ELSE 1.0 END;
  amt := round(monthly_rate * billed * p_months * discount, 2);

  ref := 'storq-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.subscription_payments
    (tx_ref, business_id, period, currency, amount, stores, billed_stores, created_by)
  VALUES
    (ref, st.business_id, p_months::text, p_currency, amt, p_stores, billed, st.id);

  RETURN json_build_object(
    'tx_ref',        ref,
    'amount',        amt,
    'currency',      p_currency,
    'stores',        p_stores,
    'billed_stores', billed,
    'months',        p_months
  );
END $$;

-- ---------- 4. The journal grows up ---------------------------------------
-- Ten new verbs share the one trail. `business_ref` is the dead id kept as plain
-- text-in-a-uuid-column: `business_id` is ON DELETE SET NULL so the trail outlives
-- the tenant, and without this column the history of a purged business would no
-- longer be addressable by anyone.
ALTER TABLE public.platform_audit_log DROP CONSTRAINT IF EXISTS platform_audit_log_action_check;
ALTER TABLE public.platform_audit_log ADD CONSTRAINT platform_audit_log_action_check
  CHECK (action IN ('slots', 'extend', 'until', 'trial', 'plan',
                    'suspend', 'restore', 'close', 'reopen', 'purge'));

ALTER TABLE public.platform_audit_log ADD COLUMN IF NOT EXISTS business_ref uuid;
UPDATE public.platform_audit_log SET business_ref = business_id
 WHERE business_ref IS NULL AND business_id IS NOT NULL;

-- The reason is operator-typed free text stored in an audit record, so it is kept
-- single-line and markup-free in the table too, not only in the client. A newline
-- here is how log injection starts.
ALTER TABLE public.platform_audit_log DROP CONSTRAINT IF EXISTS platform_audit_log_reason_plain;
ALTER TABLE public.platform_audit_log ADD CONSTRAINT platform_audit_log_reason_plain
  CHECK (reason = translate(reason, E'\r\n\t<>' || '`', ''));

-- ---------- 5. The tombstone ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_deleted_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No FKs on purpose: this row must outlive both the business and the auth user.
  business_ref uuid NOT NULL,
  owner_id uuid,
  name text NOT NULL,
  currency text NOT NULL,
  store_count integer NOT NULL DEFAULT 0,
  staff_count integer NOT NULL DEFAULT 0,
  sale_count integer NOT NULL DEFAULT 0,
  paid_store_limit integer NOT NULL DEFAULT 0,
  paid_until timestamptz,
  plan text,
  business_created_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 300)
);

CREATE INDEX IF NOT EXISTS platform_deleted_tenants_owner_idx
  ON public.platform_deleted_tenants (owner_id, purged_at DESC);

ALTER TABLE public.platform_deleted_tenants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_deleted_tenants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_deleted_tenants TO service_role;

-- A closed-then-purged owner who signs up again gets no trial: they already had
-- one. This is the trigger every creation path funnels through, so it cannot be
-- stepped around by a new screen.
CREATE OR REPLACE FUNCTION public.on_business_created()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ever_closed boolean;
BEGIN
  INSERT INTO subscriptions (business_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  SELECT EXISTS (
    SELECT 1 FROM public.platform_deleted_tenants d WHERE d.owner_id = NEW.owner_id
  ) INTO ever_closed;
  IF ever_closed THEN
    UPDATE public.subscriptions SET trial_ends_at = now() WHERE business_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

-- ---------- 6. Suspend / restore / close / reopen -------------------------
-- One intent per call, one reason, one journal row — the same contract the
-- entitlement RPC keeps. Suspension is a collections action (billing may do it);
-- closing and reopening a business are judgement calls, so they are super admin
-- only. Suspension survives a close on purpose: reopening must never silently
-- drop a restriction an operator put in place.
CREATE OR REPLACE FUNCTION public.ops_set_tenant_state(
  p_business_id uuid,
  p_action text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.platform_admins; s public.subscriptions; why text; stamp timestamptz;
        before_ jsonb; after_ jsonb;
BEGIN
  op := public.require_platform_admin(ARRAY['billing', 'owner']);

  IF p_action IS NULL OR p_action NOT IN ('suspend', 'restore', 'close', 'reopen') THEN
    RAISE EXCEPTION 'Choose suspend, restore, close or reopen';
  END IF;
  IF p_action IN ('close', 'reopen') AND op.role <> 'owner' THEN
    RAISE EXCEPTION 'Only a super admin can close or reopen a business';
  END IF;

  -- Collapse the reason to one clean line here, not only in the client: whatever
  -- reaches the journal must satisfy its CHECK without help from the caller.
  why := btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]<>`]+', ' ', 'g'));
  why := regexp_replace(why, '[[:space:]]+', ' ', 'g');
  IF char_length(why) NOT BETWEEN 8 AND 300 THEN
    RAISE EXCEPTION 'Say why this changed (8 to 300 characters)';
  END IF;

  SELECT * INTO s FROM public.subscriptions WHERE business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;
  stamp := now();

  IF p_action = 'suspend' THEN
    IF s.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This tenant is closed — reopen it first';
    END IF;
    IF s.suspended_at IS NOT NULL THEN RAISE EXCEPTION 'They are already suspended'; END IF;
    before_ := jsonb_build_object('suspended', NULL);
    after_  := jsonb_build_object('suspended', stamp);
  ELSIF p_action = 'restore' THEN
    IF s.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This tenant is closed — reopen it instead';
    END IF;
    IF s.suspended_at IS NULL THEN RAISE EXCEPTION 'They are not suspended'; END IF;
    before_ := jsonb_build_object('suspended', s.suspended_at);
    after_  := jsonb_build_object('suspended', NULL);
  ELSIF p_action = 'close' THEN
    IF s.closed_at IS NOT NULL THEN RAISE EXCEPTION 'They are already closed'; END IF;
    before_ := jsonb_build_object('closed', NULL, 'suspended', s.suspended_at);
    after_  := jsonb_build_object('closed', stamp);
  ELSE
    IF s.closed_at IS NULL THEN RAISE EXCEPTION 'They are not closed'; END IF;
    before_ := jsonb_build_object('closed', s.closed_at);
    after_  := jsonb_build_object('closed', NULL);
  END IF;

  -- Each branch touches only its own clock, so two operators racing on different
  -- intents cannot undo each other's state.
  UPDATE public.subscriptions
     SET suspended_at = CASE WHEN p_action = 'suspend' THEN stamp
                             WHEN p_action = 'restore' THEN NULL
                             ELSE suspended_at END,
         closed_at    = CASE WHEN p_action = 'close' THEN stamp
                             WHEN p_action = 'reopen' THEN NULL
                             ELSE closed_at END
   WHERE business_id = p_business_id;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_label, actor_role, business_id, business_ref, target_label,
     action, before_state, after_state, reason)
  SELECT op.user_id, op.name, op.role, p_business_id, p_business_id,
         (SELECT name FROM public.businesses WHERE id = p_business_id),
         p_action, before_, after_, why;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'action', p_action,
    'suspended_at', CASE WHEN p_action = 'suspend' THEN stamp
                         WHEN p_action = 'restore' THEN NULL
                         ELSE s.suspended_at END,
    'closed_at', CASE WHEN p_action = 'close' THEN stamp
                      WHEN p_action = 'reopen' THEN NULL
                      ELSE s.closed_at END,
    'paid_until', s.paid_until,
    'paid_store_limit', s.paid_store_limit,
    'trial_ends_at', s.trial_ends_at,
    'plan', s.plan
  );
END $$;

-- ---------- 7. Purge: the one irreversible call ---------------------------
-- Everything an operator needs to make this mistake-proof is checked in SQL, not
-- in the dialog: the super admin role, the 30-day window measured from closure,
-- the exact business name retyped, a stated reason, and a tombstone written
-- before the cascade runs. Deleting a business cascades through stores, staff,
-- products, sales, the stock ledger, shifts, refunds and payments — there is no
-- undo in this function, only a waiting period and a record of who asked for it.
CREATE OR REPLACE FUNCTION public.ops_purge_tenant(
  p_business_id uuid,
  p_confirm_name text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.platform_admins; b public.businesses; s public.subscriptions;
        why text; n_stores integer; n_staff integer; n_sales integer;
BEGIN
  op := public.require_platform_admin(ARRAY['owner']);

  why := btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]<>`]+', ' ', 'g'));
  why := regexp_replace(why, '[[:space:]]+', ' ', 'g');
  IF char_length(why) NOT BETWEEN 8 AND 300 THEN
    RAISE EXCEPTION 'Say why this changed (8 to 300 characters)';
  END IF;

  SELECT * INTO b FROM public.businesses WHERE id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
  SELECT * INTO s FROM public.subscriptions WHERE business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF;

  IF s.closed_at IS NULL THEN
    RAISE EXCEPTION 'Purge only accepts a closed business — close it first';
  END IF;
  IF s.closed_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'The waiting period ends %',
      to_char(s.closed_at + interval '30 days', 'YYYY-MM-DD');
  END IF;
  IF p_confirm_name IS NULL OR btrim(p_confirm_name) <> b.name THEN
    RAISE EXCEPTION 'Type the business name exactly as it appears to confirm';
  END IF;

  SELECT count(*) INTO n_stores FROM public.stores WHERE business_id = p_business_id;
  SELECT count(*) INTO n_staff FROM public.staff WHERE business_id = p_business_id;
  SELECT count(*) INTO n_sales FROM public.sales WHERE business_id = p_business_id;

  -- Journal and tombstone first: after the cascade the business id exists nowhere
  -- but in these rows, and `business_id` here is nulled by the foreign key.
  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_label, actor_role, business_id, business_ref, target_label,
     action, before_state, after_state, reason)
  VALUES (op.user_id, op.name, op.role, p_business_id, p_business_id, b.name, 'purge',
          jsonb_build_object('stores', n_stores, 'staff', n_staff, 'sales', n_sales,
                             'closed_at', s.closed_at),
          jsonb_build_object('purged', true), why);

  INSERT INTO public.platform_deleted_tenants
    (business_ref, owner_id, name, currency, store_count, staff_count, sale_count,
     paid_store_limit, paid_until, plan, business_created_at, closed_at, reason)
  VALUES (p_business_id, b.owner_id, b.name, b.currency, n_stores, n_staff, n_sales,
          s.paid_store_limit, s.paid_until, s.plan, b.created_at, s.closed_at, why);

  DELETE FROM public.businesses WHERE id = p_business_id;

  RETURN jsonb_build_object(
    'purged', true, 'business_ref', p_business_id, 'name', b.name,
    'stores', n_stores, 'staff', n_staff, 'sales', n_sales
  );
END $$;

-- ---------- 8. Roster learns the two new states --------------------------
-- Same signature, so the existing grants hold. State precedence: a closed
-- business is closed whatever its clocks say; then suspension; then the money
-- rules the console already showed.
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
     ('all', 'trial', 'active', 'expired', 'over_capacity', 'suspended', 'closed') THEN
    RAISE EXCEPTION 'Unknown roster filter';
  END IF;
  IF p_q IS NOT NULL AND char_length(btrim(p_q)) > 120 THEN
    RAISE EXCEPTION 'Search is too long (max 120 characters)';
  END IF;
  -- Substring match, case-folded. `%`/`_` stay LIKE wildcards on purpose: this is
  -- an internal console, and a typed `MWK%` is a useful search, not an injection.
  term := nullif(lower(btrim(coalesce(p_q, ''))), '');

  SELECT coalesce(jsonb_agg(obj ORDER BY rn), '[]'::jsonb), coalesce(max(tt), 0)
    INTO page_rows, page_total
  FROM (
    SELECT
      row_number() OVER (
        ORDER BY CASE scoped.state
                   WHEN 'over_capacity' THEN 0
                   WHEN 'expired' THEN 1
                   WHEN 'suspended' THEN 2
                   WHEN 'trial' THEN 3
                   WHEN 'closed' THEN 4
                   ELSE 5
                 END,
                 scoped.name
      ) AS rn,
      -- Window count runs before LIMIT, so this is the filtered total.
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
               -- An operator decision outranks the money maths in both directions:
               -- a closed tenant with paid time left is still closed, and a
               -- suspended tenant whose term has run out is suspended, not expired.
               WHEN base.closed_at IS NOT NULL THEN 'closed'
               WHEN base.suspended_at IS NOT NULL THEN 'suspended'
               WHEN base.paid_until > now() AND base.paid_store_limit >= base.store_count THEN 'active'
               -- Covered by a payment but holding more stores than paid for:
               -- exactly the condition subscription_active() refuses writes on.
               WHEN base.paid_until > now() THEN 'over_capacity'
               WHEN base.trial_ends_at > now() THEN 'trial'
               ELSE 'expired'
             END AS state
      FROM (
        SELECT b.id, b.name, b.currency, b.created_at,
               u.email AS owner_email,
               s.trial_ends_at, s.paid_until, s.plan, s.paid_store_limit,
               s.suspended_at, s.closed_at,
               (SELECT count(*) FROM public.stores x WHERE x.business_id = b.id) AS store_count,
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

-- ---------- 9. Execute grants -------------------------------------------
-- Only the two new functions need granting: CREATE OR REPLACE keeps the existing
-- ACL of every function it redefines, and the roster already resolves to
-- `authenticated`. Default privileges hand PUBLIC execute on new functions in
-- this schema, so each new one is closed first, then opened to signed-in
-- principals — the guards inside still raise for a customer.
REVOKE ALL ON FUNCTION public.ops_set_tenant_state(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_set_tenant_state(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ops_purge_tenant(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_purge_tenant(uuid, text, text) TO authenticated;

-- ---------- 10. Rollback-only guard checks --------------------------------
-- Same technique as the operator console migration: every fixture (the JWT
-- subject, the operator row, the mutated clocks, the staff session, the
-- sacrificial businesses and a real purge) lives in a subtransaction that is
-- aborted at the end, so these checks prove real behaviour and leave the live
-- tenant untouched. A project with no tenant yet skips rather than fails, so
-- replaying this migration on a fresh database stays safe.
DO $$
DECLARE
  op uuid; alt uuid; sacr uuid;
  b public.businesses; st public.staff;
  token uuid := gen_random_uuid();
  page jsonb; pay json; blocked boolean; n integer;
BEGIN
  SELECT * INTO b FROM public.businesses ORDER BY created_at LIMIT 1;
  IF b.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'lifecycle_checks_skipped_no_tenant';
  END IF;
  SELECT * INTO st FROM public.staff
   WHERE business_id = b.id AND active AND role = 'admin' ORDER BY created_at LIMIT 1;
  IF st.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'lifecycle_checks_skipped_no_admin';
  END IF;
  SELECT id INTO op FROM auth.users WHERE id <> b.owner_id ORDER BY created_at LIMIT 1;
  IF op IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'lifecycle_checks_skipped_no_operator';
  END IF;

  -- Start from a covered, unrestricted tenant so suspension is the only thing
  -- standing between it and its tills.
  SELECT greatest(count(*), 1) INTO n FROM public.stores WHERE business_id = b.id;
  UPDATE public.subscriptions
     SET suspended_at = NULL, closed_at = NULL,
         paid_until = now() + interval '6 months', paid_store_limit = n
   WHERE business_id = b.id;

  PERFORM set_config('request.jwt.claim.sub', op::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', op, 'role', 'authenticated')::text, true);
  INSERT INTO public.platform_admins(user_id, name, role)
  VALUES (op, 'Migration check', 'billing')
    ON CONFLICT (user_id) DO UPDATE
      SET name = 'Migration check', role = 'billing', active = true;

  IF NOT public.subscription_active(b.id) THEN
    RAISE EXCEPTION 'Control failed: a covered tenant is not active';
  END IF;

  -- (a) Support cannot suspend, and a deactivated operator cannot either.
  UPDATE public.platform_admins SET role = 'support' WHERE user_id = op;
  blocked := false;
  BEGIN
    PERFORM public.ops_set_tenant_state(b.id, 'suspend', 'support tried to suspend');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not allowed%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Support was allowed to suspend a tenant'; END IF;
  UPDATE public.platform_admins SET role = 'billing' WHERE user_id = op;

  -- (b) Suspend stops the tills even with six months bought.
  page := public.ops_set_tenant_state(b.id, 'suspend', 'Cash dispute pending');
  IF page->>'suspended_at' IS NULL THEN RAISE EXCEPTION 'Suspend returned no timestamp'; END IF;
  IF public.subscription_active(b.id) THEN
    RAISE EXCEPTION 'A suspended tenant could still write';
  END IF;

  blocked := false;
  BEGIN
    PERFORM public.ops_set_tenant_state(b.id, 'suspend', 'suspending twice');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%already suspended%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'A repeat suspension was accepted'; END IF;

  -- (c) Closing is a super admin call, not a collections call.
  blocked := false;
  BEGIN
    PERFORM public.ops_set_tenant_state(b.id, 'close', 'billing tried to close');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%super admin%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Billing was allowed to close a tenant'; END IF;

  -- A bad intent and a bad reason are both refused before anything is written.
  -- (The reason below really is under the 8-character floor — do not lengthen it.)
  blocked := false;
  BEGIN
    PERFORM public.ops_set_tenant_state(b.id, 'retire', 'inventing a fourth verb');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%suspend, restore, close or reopen%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'An unknown lifecycle action was accepted'; END IF;
  blocked := false;
  BEGIN
    PERFORM public.ops_set_tenant_state(b.id, 'restore', 'nope');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%8 to 300 characters%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'A short reason was journalled anyway'; END IF;

  -- (d) Restore puts the same tenant back, and cannot be run twice.
  page := public.ops_set_tenant_state(b.id, 'restore', 'Payment confirmed offline');
  IF page->>'suspended_at' IS NOT NULL THEN RAISE EXCEPTION 'Restore left the flag set'; END IF;
  IF NOT public.subscription_active(b.id) THEN
    RAISE EXCEPTION 'A restored tenant is still blocked';
  END IF;
  blocked := false;
  BEGIN
    PERFORM public.ops_set_tenant_state(b.id, 'restore', 'restoring again');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%not suspended%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'A repeat restore was accepted'; END IF;

  -- (e) Purge: only a super admin, only closed, only after the window, only with
  -- the exact name. Checked on the real tenant, which is never purged.
  UPDATE public.platform_admins SET role = 'owner' WHERE user_id = op;
  blocked := false;
  BEGIN
    PERFORM public.ops_purge_tenant(b.id, b.name, 'purging an open tenant');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%closed business%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Purge accepted a business that was never closed'; END IF;

  PERFORM public.ops_set_tenant_state(b.id, 'close', 'Guard: checking the waiting period');
  IF public.subscription_active(b.id) THEN RAISE EXCEPTION 'A closed tenant could still write'; END IF;
  blocked := false;
  BEGIN
    PERFORM public.ops_purge_tenant(b.id, b.name, 'purging inside the window');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%waiting period%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Purge ran inside the 30-day window'; END IF;

  -- Closure must also stop the money path, which deliberately ignores expiry.
  -- `require_staff_nosub` binds a session to the signed-in user AND the owner's
  -- business, so the fixture must carry the owner's auth_uid to be accepted.
  INSERT INTO public.staff_sessions(token, staff_id, auth_uid, expires_at)
  VALUES (token, st.id, b.owner_id, now() + interval '5 minutes');
  PERFORM set_config('request.jwt.claim.sub', b.owner_id::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', b.owner_id, 'role', 'authenticated')::text, true);
  blocked := false;
  BEGIN
    PERFORM public.start_subscription_payment(token, 'monthly', b.currency);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%is closed%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'A closed tenant was allowed to start paying'; END IF;

  -- Reopen, and the identical call succeeds: the guard is closure, not a broken funnel.
  PERFORM set_config('request.jwt.claim.sub', op::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', op, 'role', 'authenticated')::text, true);
  PERFORM public.ops_set_tenant_state(b.id, 'reopen', 'Guard: reopening after the window check');
  PERFORM set_config('request.jwt.claim.sub', b.owner_id::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', b.owner_id, 'role', 'authenticated')::text, true);
  pay := public.start_subscription_payment(token, 'monthly', b.currency);
  IF pay->>'tx_ref' IS NULL THEN RAISE EXCEPTION 'A reopened tenant cannot pay'; END IF;
  DELETE FROM public.staff_sessions WHERE staff_id = st.id;
  PERFORM set_config('request.jwt.claim.sub', op::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', op, 'role', 'authenticated')::text, true);

  -- (f) A real purge, end to end, on a sacrificial tenant nobody can find again.
  INSERT INTO public.businesses(owner_id, name, currency)
  VALUES (op, 'Purge Guard Tenant', 'MWK') RETURNING id INTO sacr;
  UPDATE public.subscriptions SET closed_at = now() - interval '31 days' WHERE business_id = sacr;
  blocked := false;
  BEGIN
    PERFORM public.ops_purge_tenant(sacr, 'Purge Guard Tenent', 'guard: mistyped name');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%business name exactly%' THEN blocked := true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Purge accepted a mistyped business name'; END IF;

  page := public.ops_purge_tenant(sacr, 'Purge Guard Tenant', 'guard: purge path end to end');
  IF page->>'purged' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Purge said nothing'; END IF;
  IF EXISTS (SELECT 1 FROM public.businesses WHERE id = sacr) THEN
    RAISE EXCEPTION 'Purge left the business row behind';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_deleted_tenants WHERE business_ref = sacr) THEN
    RAISE EXCEPTION 'Purge wrote no tombstone';
  END IF;
  -- The trail must outlive the tenant: the FK nulls business_id, business_ref holds.
  SELECT count(*) INTO n FROM public.platform_audit_log
   WHERE business_ref = sacr AND action = 'purge' AND business_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'The purge journal row is not addressable after the cascade'; END IF;

  -- (g) A purged owner gets no second free trial; a clean owner still gets one.
  -- `businesses.owner_id` is UNIQUE, so the control case cannot be a second
  -- business for the live tenant — it is the same operator account with the
  -- tombstone removed, which isolates the denial to that one row.
  INSERT INTO public.businesses(owner_id, name, currency)
  VALUES (op, 'Second Attempt Ltd', 'MWK') RETURNING id INTO alt;
  IF NOT (SELECT trial_ends_at <= now() FROM public.subscriptions WHERE business_id = alt) THEN
    RAISE EXCEPTION 'A purged owner was granted another trial';
  END IF;
  DELETE FROM public.businesses WHERE id = alt;

  DELETE FROM public.platform_deleted_tenants WHERE owner_id = op;
  INSERT INTO public.businesses(owner_id, name, currency)
  VALUES (op, 'Clean Owner Ltd', 'MWK') RETURNING id INTO alt;
  IF NOT (SELECT trial_ends_at > now() FROM public.subscriptions WHERE business_id = alt) THEN
    RAISE EXCEPTION 'An owner with no tombstone lost their trial';
  END IF;
  DELETE FROM public.businesses WHERE id = alt;

  RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'lifecycle_checks_passed_rollback';

EXCEPTION
  WHEN no_data_found THEN
    IF SQLERRM = 'lifecycle_checks_passed_rollback' THEN
      RAISE NOTICE 'PASS lifecycle checks (all fixtures rolled back)';
    ELSIF SQLERRM IN ('lifecycle_checks_skipped_no_tenant',
                      'lifecycle_checks_skipped_no_admin',
                      'lifecycle_checks_skipped_no_operator') THEN
      RAISE NOTICE 'SKIP lifecycle checks: %', SQLERRM;
    ELSE
      RAISE;
    END IF;
END;
$$;

-- --- from 20261019205208_drop_shared_collection_rpc.sql -------------------------
-- Retire the public collection-sharing surface: the unauthenticated /c/:slug
-- storefront and its RPC are dropped to eliminate that attack surface.
DROP FUNCTION IF EXISTS public.get_shared_collection(text);
DROP FUNCTION IF EXISTS app.get_shared_collection(text);

NOTIFY pgrst, 'reload schema';

