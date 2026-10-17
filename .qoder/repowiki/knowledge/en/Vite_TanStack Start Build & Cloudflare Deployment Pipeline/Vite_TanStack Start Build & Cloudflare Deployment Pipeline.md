---
kind: build_system
name: Vite/TanStack Start Build & Cloudflare Deployment Pipeline
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - vite.config.ts
    - bunfig.toml
    - vitest.config.ts
    - .wrangler/deploy/config.json
    - supabase/config.toml
---

## Build System Overview

The Storq POS application is a TanStack Start project built with Vite and Bun. There is no Makefile, Dockerfile, or CI pipeline in the repository — build, test, lint, format, and preview are all npm/Bun scripts driven by `package.json`, with deployment targeting Cloudflare via Wrangler.

## Key Files

- `package.json` — defines the entire script surface (`dev`, `build`, `build:dev`, `preview`, `lint`, `format`, `test`, `test:watch`) and pins dependencies (React 19, TanStack Start 1.168, Vite 8.1.5, Nitro 3.0.260603-beta).
- `vite.config.ts` — thin wrapper around `@lovable.dev/vite-tanstack-config`; configures TanStack Start's server entry to `src/server.ts`, pre-bundles heavy route-lazy libraries (`@supabase/supabase-js`, `jspdf`, `recharts`, etc.), and warms up client/SSR module graphs on dev boot.
- `bunfig.toml` — Bun install configuration enforcing a 24-hour supply-chain guard (`minimumReleaseAge = 86400`) with explicit excludes for Lovable packages.
- `vitest.config.ts` — test runner config using jsdom, global test APIs, `src/test/setup.ts` as setup file, and `@` path alias resolution.
- `.wrangler/deploy/config.json` — points Wrangler at the generated output location `.output/server/wrangler.json` produced by the Nitro/Vite build.
- `supabase/config.toml` — declares the Supabase project ID used by migrations under `supabase/migrations/`.

## Architecture and Conventions

**Build toolchain**: Vite 8 + TanStack Start (which bundles Nitro as the server runtime). The app is not containerized; it is intended to be deployed to a Node-compatible host or Cloudflare Workers via Wrangler.

**Script conventions**:
- `npm run dev` / `npm run build` / `npm run preview` follow the standard Vite CLI contract.
- `build:dev` uses `--mode development` to produce an unminified build for debugging.
- `lint` runs ESLint over the whole repo; `format` runs Prettier in write mode.
- `test` runs Vitest once; `test:watch` starts the watcher.

**Dependency management**: Uses Bun (`bun.lock` present) with `saveTextLockfile = true`. A supply-chain guard in `bunfig.toml` rejects any package version published less than 24 hours ago, with only Lovable-owned packages whitelisted. This is enforced at install time by Bun itself.

**Dev ergonomics**: `vite.config.ts` pre-warms both the client graph (`./src/router.tsx`, `./src/routes/**/*.tsx`, `./src/components/**/*.tsx`) and the SSR graph (`./src/server.ts`, `./src/router.tsx`, `./src/routes/**/*.tsx`) so the first request does not trigger on-demand compilation.

**Testing**: Tests live alongside source files as `*.test.ts` / `*.test.tsx` under `src/`, discovered by Vitest's default include pattern. Test utilities live in `src/test/setup.ts`.

**Database migrations**: Managed through Supabase CLI against the project ID in `supabase/config.toml`; migration SQL files are timestamp-prefixed under `supabase/migrations/`.

**No CI / no containers**: No `.github/workflows`, no `Dockerfile`, no `docker-compose.yml`, no `Makefile`, and no shell-based build/deploy scripts were found. Release and deployment steps are therefore external to this repository (likely performed manually or via Lovable's hosted workflow).

## Constraints Enforced by Tooling

- **Supply-chain age gate**: Bun refuses to install packages published within the last 24 hours unless they appear in `minimumReleaseAgeExcludes` in `bunfig.toml` (enforced by Bun's installer).
- **TanStack Start server entry**: The server entry point is fixed to `server` (resolving to `src/server.ts`) via the `tanstackStart.server.entry` option in `vite.config.ts`; changing it requires updating that field.
- **Route/component warming**: The warm-up globs in `vite.config.ts` explicitly list `./src/routes/**/*.tsx` and `./src/components/**/*.tsx`; adding new top-level route or component directories outside these patterns will bypass the dev-time pre-warm.
- **Test discovery**: Vitest only picks up files matching `src/**/*.{test,spec}.{ts,tsx}` per its `include` pattern.