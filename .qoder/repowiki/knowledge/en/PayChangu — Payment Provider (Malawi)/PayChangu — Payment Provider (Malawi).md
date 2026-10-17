---
kind: external_dependency
name: PayChangu — Payment Provider (Malawi)
slug: paychangu
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
---

### PayChangu
- Role: Payment gateway used by the subscription billing flow; prices are quoted in MWK and USD (`src/lib/billing.ts`).
- Server secrets: `PAYCHANGU_PUBLIC_KEY` and `PAYCHANGU_SECRET_KEY` are declared in `.env.example` as server-only and must NOT be exposed to the browser.
- The stable integration shape is dynamic script injection of the popup SDK, not a direct REST call from the client.