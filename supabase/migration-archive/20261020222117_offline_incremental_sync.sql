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

