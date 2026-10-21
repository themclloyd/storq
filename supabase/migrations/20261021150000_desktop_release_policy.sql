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
