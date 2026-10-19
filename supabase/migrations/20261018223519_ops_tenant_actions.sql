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
