---
kind: external_dependency
name: Cloudflare Workers Runtime (via TanStack Start + Nitro + Wrangler)
slug: cloudflare-workers-wrangler
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### Cloudflare Workers / Wrangler
- Behavior: the app is built with Vite/TanStack Start and deployed as a Cloudflare Worker; the output path convention is `.output/server/wrangler.json`.
- This is the deployment/runtime layer, distinct from the Supabase data layer.