-- Operator console: see a stuck payment and settle it in place.
--
-- Every other path to activation is automatic now (the Billing sweep, the
-- provider webhook, the scheduled reconciler), but support still had no verb for
-- the one case those cannot fix: a customer paid and the reference is stuck
-- because the amount, the currency or the response disagree. The console could
-- list tenants and move entitlements, but not say "I checked this charge".
--
-- The verification itself stays in the server function that owns the PayChangu
-- secret (`verifyAndComplete`), so this adds no second way to decide a payment
-- succeeded — only the operator's name and reason beside the outcome, which is
-- what makes granting time by hand auditable.

-- ---------------------------------------------------------------------------
-- 1. The journal accepts the new verb
-- ---------------------------------------------------------------------------

ALTER TABLE public.platform_audit_log
  DROP CONSTRAINT platform_audit_log_action_check;

ALTER TABLE public.platform_audit_log
  ADD CONSTRAINT platform_audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'slots', 'extend', 'until', 'trial', 'plan',
    'suspend', 'restore', 'close', 'reopen', 'purge',
    'verify_payment'
  ]));

-- ---------------------------------------------------------------------------
-- 2. What is still waiting
-- ---------------------------------------------------------------------------

-- Support may read this: the whole point is that the first responder can answer
-- "did my customer's money land?" without asking billing to look. Thirty days is
-- the same horizon the provider keeps for a reference.
CREATE OR REPLACE FUNCTION public.ops_pending_payments(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rows_ jsonb;
BEGIN
  PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);
  IF p_business_id IS NULL THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'tx_ref', p.tx_ref,
               'amount', p.amount,
               'currency', p.currency,
               'stores', p.stores,
               'billed_stores', p.billed_stores,
               'period', p.period,
               'created_at', p.created_at
             ) ORDER BY p.created_at DESC
           ),
           '[]'::jsonb
         )
    INTO rows_
    FROM public.subscription_payments p
   WHERE p.business_id = p_business_id
     AND p.status = 'pending'
     AND p.created_at > now() - interval '30 days';

  RETURN jsonb_build_object('rows', rows_);
END $$;

-- ---------------------------------------------------------------------------
-- 3. Record what the operator found
-- ---------------------------------------------------------------------------

-- Called after the verifier has run. It writes the journal row only: the time
-- and slots a paid charge buys are still granted by complete_subscription_payment
-- inside the server function, never from here, so an operator cannot credit an
-- account by calling this.
CREATE OR REPLACE FUNCTION public.ops_journal_payment_verification(
  p_business_id uuid,
  p_tx_ref text,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  op public.platform_admins;
  name_ text;
  before_ text;
BEGIN
  op := public.require_platform_admin(ARRAY['billing', 'owner']);

  IF p_tx_ref IS NULL OR char_length(btrim(p_tx_ref)) NOT BETWEEN 6 AND 80 THEN
    RAISE EXCEPTION 'Unknown payment reference';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('paid', 'unpaid') THEN
    RAISE EXCEPTION 'Unknown verification outcome';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 8 AND 300 THEN
    RAISE EXCEPTION 'Say why this changed (8 to 300 characters)';
  END IF;

  SELECT b.name INTO name_ FROM public.businesses b WHERE b.id = p_business_id;
  IF name_ IS NULL THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  SELECT p.status INTO before_
    FROM public.subscription_payments p
   WHERE p.tx_ref = btrim(p_tx_ref)
     AND p.business_id = p_business_id;
  IF before_ IS NULL THEN
    RAISE EXCEPTION 'That reference does not belong to this business';
  END IF;

  INSERT INTO public.platform_audit_log
    (actor_user_id, actor_label, actor_role, business_id, target_label,
     action, before_state, after_state, reason)
  VALUES
    (op.user_id, op.name, op.role, p_business_id, name_,
     'verify_payment',
     jsonb_build_object('status', before_, 'tx_ref', btrim(p_tx_ref)),
     jsonb_build_object('status', p_status, 'tx_ref', btrim(p_tx_ref)),
     btrim(p_reason));

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Proof
-- ---------------------------------------------------------------------------

-- A session with no operator row is refused by the guard the four functions
-- above all go through, so adding them opens no new door.
DO $$
BEGIN
  BEGIN
    PERFORM public.require_platform_admin(ARRAY['support', 'billing', 'owner']);
    RAISE EXCEPTION 'guard did not fire for a non-operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF sqlerrm <> 'Not a platform operator' THEN
        RAISE EXCEPTION 'Unexpected guard: %', sqlerrm;
      END IF;
  END;
END $$;
