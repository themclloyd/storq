---
kind: external_dependency
name: Supabase — Database, Auth & Project Identity
slug: supabase
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
---

### Supabase
- Role: Postgres database, auth provider, and project identity for StockWise POS.
- Integration points:
  - `@supabase/supabase-js` client created in `src/integrations/supabase/client.ts`; server-side requests are proxied through a custom fetch that rewrites public URLs to the runtime URL when `SUPABASE_URL` differs from the public one.
  - Project ID pinned in `supabase/config.toml` (`gtkfczmudhzhbdooftsa`).
  - Migrations live under `supabase/migrations/`.
- Auth/signing: uses the new opaque API-key format (`sb_publishable_*`, `sb_secret_*`) via the `apikey` header rather than Bearer JWTs; old-style `Authorization: Bearer <key>` is stripped when detected.
- Secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (and `VITE_SUPABASE_*` variants) come from environment; server-only `SUPABASE_SERVICE_ROLE_KEY` is documented but not wired in `.env.example`.
- Verify exact env var names and Supabase JS client options against the official docs.