-- Free trial: one day, plus one day of grace.
--
-- Fourteen days of free stock was long enough to run a whole trading cycle and
-- never pay for it. The trial is now a single day, and the day it ends is
-- followed by one more day where the tills keep working — the same courtesy a
-- paid term gets, kept to a single day so a free account cannot quietly turn
-- into a free month.
--
-- Existing rows keep the trial they signed up for; only new businesses get the
-- shorter one. Nothing here touches `platform_deleted_tenants`, so a reopened
-- tenant still starts with no trial at all.

ALTER TABLE public.subscriptions
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '1 day');

-- The enforcement point. Everything else (screens, reports, the operator
-- console) is a mirror of this one truth.
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
    AND ((s.paid_until + interval '3 days' > now() AND s.paid_store_limit >= (SELECT count(*) FROM public.stores WHERE business_id = p_business))
      -- Trial branch with a 1-day grace, still on a single store, and only while
      -- no paid term is running (a payment takes over the day it lands).
      OR (s.trial_ends_at + interval '1 day' > now() AND coalesce(s.paid_until,'-infinity') <= now()
          AND (SELECT count(*) FROM public.stores WHERE business_id = p_business) <= 1)))
$function$;

-- The operator console derives its own state label, so it has to agree with the
-- function above or a tenant in grace looks locked while it is still selling.
-- Rewritten from the stored definition rather than retyped, so the rest of the
-- body cannot drift: only the trial line changes.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.ops_business_roster(text,text,integer,integer)'::regprocedure)
    INTO d;

  IF position('WHEN base.trial_ends_at > now() THEN ''trial''' in d) = 0 THEN
    RAISE EXCEPTION 'ops_business_roster no longer has the expected trial branch';
  END IF;

  d := replace(
    d,
    'WHEN base.trial_ends_at > now() THEN ''trial''',
    'WHEN base.trial_ends_at + interval ''1 day'' > now() THEN ''trial'''
  );

  IF position('base.trial_ends_at + interval ''1 day'' > now()' in d) = 0 THEN
    RAISE EXCEPTION 'ops_business_roster rewrite did not apply';
  END IF;

  EXECUTE d;
END $$;

-- Proof: the shape of the new clock, checked against a live row rather than by
-- reading the source back.
DO $$
DECLARE
  new_default text;
  ended_12h timestamptz := now() - interval '12 hours';
  ended_2d  timestamptz := now() - interval '2 days';
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO new_default
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.subscriptions'::regclass AND a.attname = 'trial_ends_at';
  IF new_default IS NULL OR position('1 day' in new_default) = 0 THEN
    RAISE EXCEPTION 'trial_ends_at default is still %', coalesce(new_default, 'missing');
  END IF;

  IF ended_2d + interval '1 day' > now() THEN
    RAISE EXCEPTION 'a trial that ended two days ago would still be selling';
  END IF;
  IF NOT (ended_12h + interval '1 day' > now()) THEN
    RAISE EXCEPTION 'a trial that ended twelve hours ago would already be locked';
  END IF;
END $$;
