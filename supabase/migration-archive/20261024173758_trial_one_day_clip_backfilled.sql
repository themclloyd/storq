-- Shrink the trials the old fourteen-day default handed out.
--
-- `20261023221328_billing_and_account_lifecycle` backfilled every unpaid tenant to
-- `created_at + interval '14 days'`. The trial is now a single day, so those grants
-- are the one thing left that still sells for free for a fortnight.
--
-- The fingerprint is exact on purpose: `trial_ends_at = created_at + 14 days` is
-- only ever written by that backfill, so a trial an operator granted through
-- `ops_update_subscription` (which sets `now() + p_trial_days`) is left alone — a
-- support decision is not the default policy wearing a date. Nobody is cut off on
-- the spot either: the new end is at least a day away, and `subscription_active()`
-- adds its day of grace after that.
--
-- Rows already expired are not touched, so this can only ever shorten a trial that
-- still had time on it.

UPDATE public.subscriptions
   SET trial_ends_at = least(trial_ends_at, now() + interval '1 day')
 WHERE paid_until IS NULL
   AND closed_at IS NULL
   AND trial_ends_at = created_at + interval '14 days'
   AND trial_ends_at > now() + interval '1 day';

-- Proof: no backfilled trial outlives the rule any more. A row that still matches
-- the fingerprint must already be inside the last day (or lapsed), which is what
-- the UPDATE leaves behind.
DO $$
DECLARE
  offenders integer;
BEGIN
  SELECT count(*) INTO offenders
    FROM public.subscriptions
   WHERE paid_until IS NULL
     AND closed_at IS NULL
     AND trial_ends_at = created_at + interval '14 days'
     AND trial_ends_at > now() + interval '1 day';

  IF offenders > 0 THEN
    RAISE EXCEPTION '% backfilled trial(s) still run past the single day', offenders;
  END IF;
END $$;
