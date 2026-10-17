---
kind: configuration_system
name: Environment & Runtime Configuration (Vite/Supabase/Lovable)
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - src/integrations/supabase/client.ts
    - src/integrations/supabase/client.server.ts
    - src/integrations/supabase/auth-middleware.ts
    - src/lib/billing.functions.ts
    - src/lib/seo.ts
    - vite.config.ts
    - supabase/config.toml
    - bunfig.toml
    - components.json
---

## Approach

The application uses a **plain `.env` + Vite `VITE_*` prefix** configuration model, with no dedicated config library or schema validator. Supabase credentials are injected at build time for the browser and read from `process.env` on the server; PayChangu secrets are loaded only inside server functions.

## Key files

- `.env.example` — template of all required env vars (documented as "Copy to .env (never committed)").
- `src/integrations/supabase/client.ts` — public Supabase client; reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` via `import.meta.env`, falls back to `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` via `process.env` for SSR.
- `src/integrations/supabase/client.server.ts` — admin client using `SUPABASE_SERVICE_ROLE_KEY`; explicitly documented as bypassing RLS and only for trusted server-side operations.
- `src/integrations/supabase/auth-middleware.ts` — server-side auth middleware reading `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` from `process.env`.
- `src/lib/billing.functions.ts` — reads `PAYCHANGU_PUBLIC_KEY` / `PAYCHANGU_SECRET_KEY` exclusively from `process.env` inside server functions.
- `src/lib/seo.ts` — reads `VITE_SITE_URL` via `import.meta.env` for canonical / OG URL generation.
- `vite.config.ts` — delegates to `@lovable.dev/vite-tanstack-config`, which (per its own comment) handles `VITE_*` env injection and other defaults.
- `supabase/config.toml` — declares `project_id = "gtkfczmudhzhbdooftsa"` for the Supabase CLI.
- `bunfig.toml` — Bun install policy (`minimumReleaseAge = 86400`) plus an allowlist of excluded packages.
- `components.json` — shadcn/ui generator config (style, aliases, Tailwind settings).

## Architecture and conventions

1. **Two-tier env var naming.** Public-facing values use the `VITE_` prefix so Vite can bake them into the client bundle at build time; server-only secrets never carry that prefix. The `.env.example` header explicitly warns: "Server-only secrets. NEVER add these to a VITE_* variable and never commit them."

2. **Dual access pattern in shared code.** `client.ts` reads both `import.meta.env["VITE_*"]` (browser/build-time) and `process.env["SUPABASE_*"]` (SSR/runtime), allowing the same module to run in both contexts. Server-only modules (`client.server.ts`, `auth-middleware.ts`, `billing.functions.ts`) read directly from `process.env`.

3. **Fail-fast initialization.** Both `createSupabaseClient()` and `createSupabaseAdminClient()` validate that required variables exist before constructing the client; missing vars throw an error listing each missing key. This is enforced at import/first-use time, not lazily.

4. **Lazy singleton clients via Proxy.** Both exported clients (`supabase`, `supabaseAdmin`) are `new Proxy(...)` wrappers around a lazily-initialized instance, so environment validation runs only when the client is first accessed.

5. **Runtime URL rewriting for Supabase.** On the server, `serverSupabaseUrl()` rewrites outgoing requests from the public Supabase URL to the internal runtime URL when `SUPABASE_URL` differs from the public one, avoiding cross-origin calls from SSR.

6. **Service-role vs publishable-key separation.** Admin operations go through `client.server.ts` with `SUPABASE_SERVICE_ROLE_KEY` (RLS-bypassing); authenticated user queries go through the public client with the publishable key. Comments in `client.server.ts` enforce this distinction: "Use this for admin operations in server functions and server routes only. For user-authenticated queries (with RLS), use the auth middleware instead."

7. **PayChangu keys are server-function-scoped.** `PAYCHANGU_PUBLIC_KEY` and `PAYCHANGU_SECRET_KEY` are read inside `billing.functions.ts` (a `.functions.ts` file, which ships only to the server), keeping them out of the client bundle.

8. **Site origin via `VITE_SITE_URL`.** Optional public origin used for absolute canonical / OG tags; empty value falls back to relative URLs (safe on any domain), per the `.env.example` comment.

9. **Supabase project identity is pinned in `supabase/config.toml`**, not in env vars, so the Supabase CLI always targets the correct project.

## Conventions and constraints

- **Never commit `.env`.** Enforced by the `.env.example` header comment and by `.gitignore` (the example file exists but `.env` does not appear in the tree).
- **Do not put server secrets behind `VITE_*`.** Explicitly warned in `.env.example`: "Server-only secrets. NEVER add these to a VITE_* variable and never commit them."
- **Do not edit auto-generated Supabase client files.** Both `client.ts` and `client.server.ts` start with `// This file is automatically generated. Do not edit it directly.`
- **Admin client must not be imported at top level in route files.** `client.server.ts` comments state: "Top-level import is safe only in other `.server.ts` modules - route files and `*.functions.ts` ship to the client bundle."
- **Missing required env vars cause a hard error at startup.** Both client factories throw after logging `[Supabase] Missing Supabase environment variable(s): ... Connect Supabase in Lovable Cloud.`
- **Bun package versions published less than 24 hours ago are rejected.** Enforced by `bunfig.toml` `minimumReleaseAge = 86400`, with an explicit allowlist under `minimumReleaseAgeExcludes`.
- **Vite config should not duplicate plugins from `@lovable.dev/vite-tanstack-config`.** `vite.config.ts` comments state: "do NOT add them manually or the app will break with duplicate plugins."