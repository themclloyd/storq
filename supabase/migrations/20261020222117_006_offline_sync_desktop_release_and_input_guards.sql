-- ============================================================================
-- 006 - Offline sync, desktop release policy and input shape guards
--
-- Squashed baseline. This file is the ordered, verbatim concatenation of the
-- migrations listed below. Replaying it on an empty database produces the same
-- schema those files produced one at a time, in this exact order. Every
-- original is kept unedited in supabase/migration-archive/ for provenance.
--
--   20261020222117  offline_incremental_sync
--   20261021100128  desktop_release_policy
--   20261022122929  pin_throttle_commit_and_login_backstop
--   20261022122940  input_shape_guards
-- ============================================================================

-- --- from 20261020222117_offline_incremental_sync.sql ---------------------------
-- ============================================================================
-- Offline-first incremental sync (Phase 2) for the desktop tills.
--
-- Adds a row-level change watermark (updated_at), a delete ledger (tombstones),
-- and ONE read RPC (app.sync_pull) so an installed till can bootstrap its
-- reference data once, then pull only what changed while it was closed/offline.
--
-- Design notes:
--  * Every write already flows through SECURITY DEFINER RPCs; rather than edit
--    each one, a BEFORE UPDATE trigger stamps updated_at automatically, so no
--    existing function changes behaviour beyond gaining a maintenance column.
--  * sync_pull ships ONLY role-neutral reference data. Buying costs live in the
--    gated product_costs table and are never selected here — a cashier's offline
--    catalog therefore can't leak margin, matching the web app's snapshot rule.
--  * Collections + membership are tiny and always returned in full, so a cached
--    discount can never go stale between two partial pulls.
--
-- TARGET REPO: the mother web app (Desktop/storq) owns the Supabase schema.
-- Apply with `supabase db push` from that repo after review.
-- ============================================================================

-- ---------- 1. Change watermark on the syncable reference tables ------------
ALTER TABLE public.businesses  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.stores      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.products    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.store_stock ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS businesses_touch     ON public.businesses;
DROP TRIGGER IF EXISTS stores_touch         ON public.stores;
DROP TRIGGER IF EXISTS products_touch       ON public.products;
DROP TRIGGER IF EXISTS store_stock_touch    ON public.store_stock;
DROP TRIGGER IF EXISTS collections_touch    ON public.collections;
CREATE TRIGGER businesses_touch  BEFORE UPDATE ON public.businesses  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER stores_touch      BEFORE UPDATE ON public.stores      FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER products_touch    BEFORE UPDATE ON public.products    FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER store_stock_touch BEFORE UPDATE ON public.store_stock FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER collections_touch BEFORE UPDATE ON public.collections FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Partial-scan indexes for the incremental pull.
CREATE INDEX IF NOT EXISTS products_sync_idx    ON public.products    (business_id, updated_at);
CREATE INDEX IF NOT EXISTS store_stock_sync_idx ON public.store_stock (updated_at);
CREATE INDEX IF NOT EXISTS collections_sync_idx ON public.collections (business_id, updated_at);

-- ---------- 2. Delete ledger (tombstones) -----------------------------------
-- Products/collections soft-deactivate via `active`, but rows genuinely go
-- away when a store drops an item from its catalog or a collection is removed.
-- An offline register must learn about those deletions, so we journal them.
CREATE TABLE IF NOT EXISTS public.tombstones (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  table_name  text NOT NULL,
  row_key     text NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, table_name, row_key)
);
ALTER TABLE public.tombstones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access" ON public.tombstones;
CREATE POLICY "no direct access" ON public.tombstones FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.tombstones FROM public, anon, authenticated;
GRANT  ALL ON public.tombstones TO service_role;
COMMENT ON TABLE public.tombstones IS 'Journal of deleted reference rows so offline tills can prune their cached catalog.';

CREATE INDEX IF NOT EXISTS tombstones_sync_idx ON public.tombstones (business_id, table_name, deleted_at);

CREATE OR REPLACE FUNCTION app.tombstone_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE biz uuid; rk text;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    biz := OLD.business_id; rk := OLD.id::text;
  ELSIF TG_TABLE_NAME = 'collections' THEN
    biz := OLD.business_id; rk := OLD.id::text;
  ELSIF TG_TABLE_NAME = 'store_stock' THEN
    SELECT business_id INTO biz FROM public.stores WHERE id = OLD.store_id;
    rk := OLD.store_id::text || ':' || OLD.product_id::text;
  ELSE
    RETURN OLD;
  END IF;
  IF biz IS NOT NULL THEN
    INSERT INTO public.tombstones (business_id, table_name, row_key, deleted_at)
    VALUES (biz, TG_TABLE_NAME, rk, now())
    ON CONFLICT (business_id, table_name, row_key) DO UPDATE SET deleted_at = excluded.deleted_at;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS products_tombstone    ON public.products;
DROP TRIGGER IF EXISTS collections_tombstone ON public.collections;
DROP TRIGGER IF EXISTS stock_tombstone       ON public.store_stock;
CREATE TRIGGER products_tombstone    AFTER DELETE ON public.products    FOR EACH ROW EXECUTE FUNCTION app.tombstone_delete();
CREATE TRIGGER collections_tombstone AFTER DELETE ON public.collections FOR EACH ROW EXECUTE FUNCTION app.tombstone_delete();
CREATE TRIGGER stock_tombstone       AFTER DELETE ON public.store_stock FOR EACH ROW EXECUTE FUNCTION app.tombstone_delete();

-- ---------- 3. The one pull RPC ---------------------------------------------
-- p_since NULL  -> full bootstrap snapshot (first launch / after a cache wipe).
-- p_since given -> only rows changed since that mark, plus deletes since then.
-- The high-water mark trails the clock by a few seconds so a transaction that
-- commits around this read is always caught by the NEXT pull (overlap is safe:
-- the desktop upserts by id). Never returns buying costs.
CREATE OR REPLACE FUNCTION app.sync_pull(p_token uuid, p_since timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  biz      uuid;
  v_high   timestamptz := now() - interval '5 seconds';
  res      jsonb;
BEGIN
  -- Authorize with any live PIN session for this device login (raises 'Locked'
  -- or a role error otherwise), then scope every read to the caller's business.
  PERFORM require_staff(p_token, array['admin', 'manager', 'cashier']);
  biz := my_business_id();
  IF biz IS NULL THEN RAISE EXCEPTION 'No business'; END IF;

  SELECT jsonb_build_object(
    'watermark', v_high,
    'business', (
      SELECT row_to_json(x) FROM (
        SELECT id, name, currency, tax_rate, tax_inclusive
        FROM public.businesses WHERE id = biz
      ) x
    ),
    'stores', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.name), '[]'::jsonb) FROM (
        SELECT id, name, store_type, phone, email, address, tax_number, tax_rate, tax_inclusive, updated_at
        FROM public.stores
        WHERE business_id = biz AND (p_since IS NULL OR updated_at > p_since)
      ) x
    ),
    'products', (
      SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.name), '[]'::jsonb) FROM (
        SELECT id, store_id, name, sku, category, price, active, reorder_point, updated_at
        FROM public.products
        WHERE business_id = biz AND (p_since IS NULL OR updated_at > p_since)
      ) x
    ),
    'stock', (
      SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT ss.store_id, ss.product_id, ss.qty, ss.updated_at
        FROM public.store_stock ss JOIN public.stores st ON st.id = ss.store_id
        WHERE st.business_id = biz AND (p_since IS NULL OR ss.updated_at > p_since)
      ) x
    ),
    -- Full sets: small, and guarantees a cached discount is never stale.
    'collections', (
      SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT id, name, discount_pct, is_shared FROM public.collections WHERE business_id = biz
      ) x
    ),
    'memberships', (
      SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT pc.collection_id, pc.product_id
        FROM public.product_collections pc JOIN public.products p ON p.id = pc.product_id
        WHERE p.business_id = biz
      ) x
    ),
    'tombstones', (
      SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT table_name, row_key FROM public.tombstones
        WHERE business_id = biz AND p_since IS NOT NULL AND deleted_at > p_since
      ) x
    )
  ) INTO res;

  RETURN res;
END $$;

REVOKE ALL ON FUNCTION app.sync_pull(uuid, timestamptz) FROM public, anon;
GRANT  EXECUTE ON FUNCTION app.sync_pull(uuid, timestamptz) TO authenticated, service_role;
COMMENT ON FUNCTION app.sync_pull(uuid, timestamptz) IS
  'Incremental pull of role-neutral reference data (no buying costs) for offline-first desktop tills; p_since NULL = full bootstrap.';

-- ---------- 4. public wrapper ----------------------------------------------
-- Only the `public` schema is exposed to PostgREST, so RPCs reach app.sync_pull
-- through this thin invoker-rights wrapper (mirrors public.checkout_ref).
CREATE OR REPLACE FUNCTION public.sync_pull(p_token uuid, p_since timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT app.sync_pull(p_token, p_since);
$$;
REVOKE ALL ON FUNCTION public.sync_pull(uuid, timestamptz) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.sync_pull(uuid, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.sync_pull(uuid, timestamptz) IS
  'Public entry point for app.sync_pull (offline-first desktop reference-data pull).';

-- --- from 20261021100128_desktop_release_policy.sql -----------------------------
-- ============================================================================
-- Desktop release policy — the server-side half of "this till is too old".
--
-- The desktop app can now update itself from a signed channel, but an update
-- only helps if the till is told WHEN it must take one. That floor lives here
-- rather than inside latest.json because what actually breaks is the DATA
-- contract: if app.sync_pull's payload shape or checkout_ref's arguments change,
-- a stale build keeps writing records the server no longer understands, and the
-- damage is silent. A version string in a JSON blob cannot stop that, because
-- the old build is the thing reading the blob.
--
-- Design notes:
--  * One row per platform holding the oldest build that may still trade.
--  * Read is public ON PURPOSE. A minimum version is not tenant data, and a till
--    must be able to check it BEFORE any staff PIN session exists — the same
--    moment it decides whether to ask for an offline unlock grant at all.
--  * Writes get no policy at all, so RLS denies INSERT/UPDATE/DELETE to anon and
--    authenticated. Only service_role can raise the floor.
--  * Seed is 0.1.1: the first bundle that carries the updater. Nothing older can
--    heal itself, so nothing older should be trusted with a sale.
--
-- TARGET REPO: the mother web app (Desktop/storq) owns the Supabase schema.
-- Apply with `supabase db push` from that repo after review.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.desktop_releases (
  platform    TEXT PRIMARY KEY CHECK (platform IN ('windows', 'macos', 'linux')),
  min_version TEXT NOT NULL CHECK (min_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.desktop_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desktop_releases_read" ON public.desktop_releases;
CREATE POLICY "desktop_releases_read" ON public.desktop_releases
  FOR SELECT USING (true);

-- PostgREST needs the table-level grant as well as the policy; Supabase's
-- default privileges do not always reach a role that connects as `anon`.
GRANT SELECT ON public.desktop_releases TO anon, authenticated;

-- Re-stamps updated_at when an operator raises the floor, reusing the watermark
-- helper added for the offline sync work instead of defining a second one.
DROP TRIGGER IF EXISTS desktop_releases_touch ON public.desktop_releases;
CREATE TRIGGER desktop_releases_touch BEFORE UPDATE ON public.desktop_releases
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO public.desktop_releases (platform, min_version, note)
VALUES ('windows', '0.1.1', 'First build that can update itself.')
ON CONFLICT (platform) DO NOTHING;

-- --- from 20261022122929_pin_throttle_commit_and_login_backstop.sql -------------
-- ============================================================================
-- Make the PIN throttle actually hold, and stop device-id rotation bypassing it.
--
-- The previous app.unlock_with_pin() incremented public.pin_throttle and then
-- RAISE EXCEPTION 'Wrong PIN'. Postgres rolls the whole statement back on an
-- exception, so the increment was erased every time: five wrong PINs never
-- locked anything, and every attempt still paid for a bcrypt compare per active
-- staff row. The function now RETURNS a small JSON verdict instead of raising:
--
--   {ok:true,  token, id, name, role, store_id, expires_at}
--   {ok:false, code:'wrong_pin',  attempts_left}
--   {ok:false, code:'throttled',  retry_after, attempts_left}
--
-- Two counters guard the pad:
--   * per (business, login, device): 5 wrong attempts -> 15 minutes, so one
--     counter cannot lock the other tills in the shop;
--   * per (business, login): 20 wrong attempts -> 15 minutes, so a caller that
--     rotates the client-supplied p_device_id cannot buy unlimited guesses.
-- A correct PIN clears both. Counters live in 15-minute windows so an occasional
-- fat finger yesterday never counts toward today's lock.
--
-- Deploy this migration together with the client that understands `ok:false`.
-- ============================================================================

-- ---------- 1. Login-wide backstop ------------------------------------------
CREATE TABLE IF NOT EXISTS public.pin_login_throttle (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  auth_uid uuid NOT NULL,
  fails integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, auth_uid)
);
ALTER TABLE public.pin_login_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access" ON public.pin_login_throttle;
CREATE POLICY "no direct access" ON public.pin_login_throttle
  FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.pin_login_throttle FROM public, anon, authenticated;
GRANT ALL ON public.pin_login_throttle TO service_role;
COMMENT ON TABLE public.pin_login_throttle IS
  'Login-wide PIN attempt backstop: catches a caller that rotates device ids to dodge the per-device counter.';

ALTER TABLE public.pin_throttle ADD COLUMN IF NOT EXISTS window_start timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.pin_login_throttle DROP CONSTRAINT IF EXISTS pin_login_throttle_fails;
ALTER TABLE public.pin_login_throttle ADD CONSTRAINT pin_login_throttle_fails CHECK (fails >= 0);

-- ---------- 2. unlock_with_pin: counted failures that survive the call ------
CREATE OR REPLACE FUNCTION app.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  uid uuid := auth.uid();
  b uuid;
  v_now timestamptz := now();
  -- A generated uuid or the client's `d-...` fallback; anything else collapses
  -- to the legacy empty bucket so a caller cannot address a shared sentinel.
  dev text := lower(btrim(coalesce(p_device_id, '')));
  v_window constant interval := interval '15 minutes';
  v_device_max constant integer := 5;
  v_login_max constant integer := 20;
  st public.staff;
  t uuid;
  v_exp timestamptz;
  v_dfails integer;
  v_dwin timestamptz;
  v_dlock timestamptz;
  v_lfails integer;
  v_lwin timestamptz;
  v_llock timestamptz;
  v_left integer;
  v_wait integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  b := app.my_business_id();
  IF b IS NULL THEN RAISE EXCEPTION 'No business for this account'; END IF;

  IF dev <> '' AND dev !~ '^[a-z0-9][a-z0-9._-]{7,63}$' THEN dev := ''; END IF;

  -- The login-wide row is the serialization point: every attempt for this
  -- business login locks it first, so two tills cannot race past the counter.
  INSERT INTO public.pin_login_throttle (business_id, auth_uid)
  VALUES (b, uid)
  ON CONFLICT (business_id, auth_uid) DO NOTHING;

  SELECT fails, window_start, locked_until
    INTO v_lfails, v_lwin, v_llock
    FROM public.pin_login_throttle
   WHERE business_id = b AND auth_uid = uid
   FOR UPDATE;

  SELECT fails, window_start, locked_until
    INTO v_dfails, v_dwin, v_dlock
    FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev
   FOR UPDATE;

  v_dfails := coalesce(v_dfails, 0);
  v_dwin := coalesce(v_dwin, v_now);
  v_lfails := coalesce(v_lfails, 0);
  v_lwin := coalesce(v_lwin, v_now);

  -- An active lock always wins, even when the supplied PIN is correct.
  IF (v_dlock IS NOT NULL AND v_dlock > v_now)
     OR (v_llock IS NOT NULL AND v_llock > v_now) THEN
    v_wait := greatest(1, ceil(extract(epoch FROM (
      greatest(coalesce(v_dlock, '-infinity'::timestamptz),
               coalesce(v_llock, '-infinity'::timestamptz)) - v_now)) / 60)::int);
    RETURN json_build_object('ok', false, 'code', 'throttled',
      'retry_after', v_wait * 60, 'attempts_left', 0);
  END IF;

  -- Windows restart after they expire; success clears both rows outright.
  IF v_now >= v_dwin + v_window THEN v_dfails := 0; v_dwin := v_now; END IF;
  IF v_now >= v_lwin + v_window THEN v_lfails := 0; v_lwin := v_now; END IF;

  IF p_pin IS NOT NULL AND p_pin ~ '^[0-9]{4,8}$' THEN
    SELECT * INTO st FROM public.staff
     WHERE business_id = b AND active
       AND pin_hash = extensions.crypt(p_pin, pin_hash)
     LIMIT 1;
  END IF;

  IF st.id IS NULL THEN
    v_dfails := v_dfails + 1;
    v_lfails := v_lfails + 1;

    -- Persist BEFORE returning: an exception would roll these increments back,
    -- which is exactly why the old throttle never locked anything.
    INSERT INTO public.pin_throttle
      (business_id, auth_uid, device_id, fails, window_start, locked_until, updated_at)
    VALUES
      (b, uid, dev, v_dfails, v_dwin,
       CASE WHEN v_dfails >= v_device_max THEN v_now + v_window END, v_now)
    ON CONFLICT (business_id, auth_uid, device_id) DO UPDATE
      SET fails = excluded.fails,
          window_start = excluded.window_start,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at;

    INSERT INTO public.pin_login_throttle
      (business_id, auth_uid, fails, window_start, locked_until, updated_at)
    VALUES
      (b, uid, v_lfails, v_lwin,
       CASE WHEN v_lfails >= v_login_max THEN v_now + v_window END, v_now)
    ON CONFLICT (business_id, auth_uid) DO UPDATE
      SET fails = excluded.fails,
          window_start = excluded.window_start,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at;

    -- Spoofed/rotated device ids create one row each; expired ones are junk.
    DELETE FROM public.pin_throttle
     WHERE business_id = b AND auth_uid = uid AND device_id <> dev
       AND updated_at < v_now - interval '1 day'
       AND (locked_until IS NULL OR locked_until < v_now);

    IF v_dfails >= v_device_max OR v_lfails >= v_login_max THEN
      RETURN json_build_object('ok', false, 'code', 'throttled',
        'retry_after', extract(epoch FROM v_window)::int, 'attempts_left', 0);
    END IF;

    v_left := greatest(0, v_device_max - v_dfails);
    RETURN json_build_object('ok', false, 'code', 'wrong_pin', 'attempts_left', v_left);
  END IF;

  -- A valid PIN proves the person, so both counters start clean.
  DELETE FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = dev;
  DELETE FROM public.pin_login_throttle
   WHERE business_id = b AND auth_uid = uid;
  DELETE FROM public.staff_sessions WHERE expires_at < v_now;
  -- Replace only this device's session; other counters keep their live session.
  DELETE FROM public.staff_sessions WHERE auth_uid = uid AND device_id = dev;

  v_exp := v_now + interval '8 hours';
  INSERT INTO public.staff_sessions (staff_id, auth_uid, device_id, expires_at)
  VALUES (st.id, uid, dev, v_exp)
  RETURNING token INTO t;

  RETURN json_build_object('ok', true, 'token', t, 'id', st.id, 'name', st.name,
    'role', st.role, 'store_id', st.store_id, 'expires_at', v_exp);
END $$;

-- ---------- 3. Lock/sign-out clears the new counter too ---------------------
CREATE OR REPLACE FUNCTION app.lock_session(p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id(); v_dev text;
BEGIN
  SELECT device_id INTO v_dev FROM public.staff_sessions WHERE token = p_token AND auth_uid = uid;
  DELETE FROM public.staff_sessions ss
   WHERE ss.token = p_token AND (ss.auth_uid = uid OR ss.auth_uid IS NULL
     OR ss.staff_id IN (SELECT id FROM public.staff WHERE business_id = b));
  IF v_dev IS NOT NULL THEN
    DELETE FROM public.pin_throttle
     WHERE auth_uid = uid AND device_id = v_dev AND business_id = b;
  ELSE
    DELETE FROM public.pin_throttle WHERE auth_uid = uid;
  END IF;
  DELETE FROM public.pin_login_throttle WHERE auth_uid = uid AND business_id = b;
END $$;

CREATE OR REPLACE FUNCTION app.lock_all_sessions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b uuid := app.my_business_id();
BEGIN
  DELETE FROM public.staff_sessions
   WHERE auth_uid = uid
      OR (b IS NOT NULL AND auth_uid IS NULL
          AND staff_id IN (SELECT id FROM public.staff WHERE business_id = b));
  DELETE FROM public.pin_throttle WHERE auth_uid = uid;
  DELETE FROM public.pin_login_throttle WHERE auth_uid = uid;
END $$;

-- ---------- 4. Reaffirm the RPC surface -------------------------------------
DROP FUNCTION IF EXISTS public.unlock_with_pin(text, text);
CREATE OR REPLACE FUNCTION public.unlock_with_pin(p_pin text, p_device_id text DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT app.unlock_with_pin(p_pin, p_device_id)
$$;

REVOKE ALL ON FUNCTION app.unlock_with_pin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app.unlock_with_pin(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unlock_with_pin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.unlock_with_pin(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app.lock_session(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app.lock_session(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION app.lock_all_sessions() FROM public, anon;
GRANT EXECUTE ON FUNCTION app.lock_all_sessions() TO authenticated, service_role;

-- ---------- 5. Proof (rollback only) ----------------------------------------
-- Five wrong PINs must persist a per-device lock; a different device keeps its
-- own budget; and a caller rotating device ids still hits the login backstop.
DO $$
DECLARE
  b uuid; uid uuid; st_id uuid;
  r json;
  n int;
  v_locked boolean;
BEGIN
  SELECT id, owner_id INTO b, uid FROM public.businesses ORDER BY created_at LIMIT 1;
  IF b IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'No tenant available for throttle checks'; END IF;

  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  INSERT INTO public.staff (business_id, name, role, pin_hash, active)
  VALUES (b, 'throttle proof', 'cashier',
          extensions.crypt('2468', extensions.gen_salt('bf')), true)
  RETURNING id INTO st_id;

  -- Four misses report a shrinking budget; the fifth locks THIS device.
  FOR n IN 1..5 LOOP
    r := app.unlock_with_pin('0000', 'proof-device-a');
    IF r->>'ok' <> 'false' THEN RAISE EXCEPTION 'Attempt % was not rejected', n; END IF;
    IF n < 5 AND (r->>'code' <> 'wrong_pin' OR (r->>'attempts_left')::int <> 5 - n) THEN
      RAISE EXCEPTION 'Attempt % reported the wrong budget: %', n, r;
    END IF;
  END LOOP;
  IF r->>'code' <> 'throttled' THEN RAISE EXCEPTION 'Fifth miss did not lock: %', r; END IF;

  SELECT fails, coalesce(locked_until > now(), false)
    INTO n, v_locked
    FROM public.pin_throttle
   WHERE business_id = b AND auth_uid = uid AND device_id = 'proof-device-a';
  IF n IS DISTINCT FROM 5 OR NOT v_locked THEN
    RAISE EXCEPTION 'Per-device counter was not persisted (fails=%, locked=%)', n, v_locked;
  END IF;

  -- A correct PIN on a different register is unaffected by that lock.
  r := app.unlock_with_pin('2468', 'proof-device-b');
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'A clean register was blocked: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.pin_throttle
              WHERE business_id = b AND auth_uid = uid AND device_id = 'proof-device-b') THEN
    RAISE EXCEPTION 'A successful unlock left a throttle row behind';
  END IF;

  -- Rotating device ids cannot buy more guesses: the login-wide counter wins.
  INSERT INTO public.pin_login_throttle (business_id, auth_uid, fails, window_start)
  VALUES (b, uid, 19, now())
  ON CONFLICT (business_id, auth_uid) DO UPDATE
    SET fails = 19, window_start = now(), locked_until = NULL;

  r := app.unlock_with_pin('0000', 'proof-device-rotated');
  IF r->>'code' <> 'throttled' THEN
    RAISE EXCEPTION 'Rotating the device id bypassed the login backstop: %', r;
  END IF;
  r := app.unlock_with_pin('2468', 'proof-device-rotated');
  IF r->>'code' <> 'throttled' THEN
    RAISE EXCEPTION 'The login backstop let a correct PIN through during a lock: %', r;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0002',
    MESSAGE = 'pin_throttle_checks_passed_rollback';
EXCEPTION WHEN no_data_found THEN
  IF SQLERRM <> 'pin_throttle_checks_passed_rollback' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: per-device and login-wide PIN throttles persist and release independently; fixtures rolled back';
END $$;

NOTIFY pgrst, 'reload schema';

-- --- from 20261022122940_input_shape_guards.sql ---------------------------------
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

