---
kind: error_handling
name: Error Handling in Storq POS — h3 Capture, Root Error Boundary & Lovable Telemetry
category: error_handling
scope:
    - '**'
source_files:
    - src/lib/error-capture.ts
    - src/lib/error-page.ts
    - src/lib/lovable-error-reporting.ts
    - src/server.ts
    - src/routes/__root.tsx
    - src/integrations/supabase/auth-middleware.ts
---

## Overview

Storq (a TanStack Start + Supabase retail POS app) uses three cooperating layers to handle errors:

1. **Server-side capture** (`src/lib/error-capture.ts`) intercepts `console.error`, global `error` / `unhandledrejection` events, and stores the last thrown error so the server entry can recover it after h3 swallows it into a generic 500 JSON response.
2. **SSR fallback page** (`src/lib/error-page.ts`) renders a minimal HTML "This page didn't load" page when h3 has already converted an unhandled throw into `{"unhandled":true,"message":"HTTPError"}`.
3. **Client-side root boundary** (`src/routes/__root.tsx`) catches React/TanStack route errors, logs them, reports them to Lovable telemetry, and offers a "Try again" / "Go home" UI.
4. **Lovable reporting helper** (`src/lib/lovable-error-reporting.ts`) forwards errors to the Lovable editor preview's runtime reporter (`window.__lovableReportRuntimeError`) and to its event pipeline via `window.__lovableEvents.captureException`.

There is no custom error class hierarchy, no sentinel error constants, and no centralized error-code enumeration. Errors are propagated as plain `Error` instances (and occasionally raw `Response` or plain objects from loaders/server functions).

## Key Files

- `src/lib/error-capture.ts` — console.error wrapper, cause-chain serializer, global `error` / `unhandledrejection` listeners, `consumeLastCapturedError()` export.
- `src/lib/error-page.ts` — `renderErrorPage()` returns a self-contained HTML string with inline CSS.
- `src/lib/lovable-error-reporting.ts` — `reportLovableError(error, context)` and `describeThrown` for non-Error payloads.
- `src/server.ts` — top-level Cloudflare Worker / Nitro entry; imports `error-capture` for side effects, applies security headers, detects h3-swallowed SSR errors, falls back to `renderErrorPage()`.
- `src/routes/__root.tsx` — defines `ErrorComponent` as TanStack's `errorComponent`, calls `reportLovableError` on every caught error.
- `src/integrations/supabase/auth-middleware.ts` — throws `new Error("Unauthorized: …")` for missing env vars, malformed tokens, invalid JWT shape, and absent user claims.

## Architecture & Conventions

### Server-side: h3 swallowed-error workaround

h3 converts in-handler throws into a normal 200-ish `Response` whose body is JSON `{"unhandled":true,"message":"HTTPError"}`. A plain `try/catch` around the handler never fires for these. The fix is two-fold:

- `error-capture.ts` wraps `console.error` so any thrown `Error` gets serialized (including `.cause` chains up to depth 5, capped at 8000 chars) before being passed to the original logger. It also records the raw error object in a module-scoped `lastCapturedError` slot with a 5-second TTL.
- `server.ts` inspects every outgoing Response: if status ≥ 500 and content-type is JSON and the body matches the h3 signature, it logs `consumeLastCapturedError() ?? new Error(...)` and replaces the body with `renderErrorPage()`.

The comment in `error-capture.ts` explicitly states the intent: _"Captures the original Error out-of-band so server.ts can recover the stack when h3 has already swallowed the throw into a generic 500 Response."_

### Client-side: single root error boundary

TanStack's `createRootRouteWithContext` registers `errorComponent: ErrorComponent`. There is no per-route or per-feature error boundary; all route/component errors bubble to this one place. The component:

- Calls `console.error(error)`.
- Reports via `reportLovableError(error, { boundary: "tanstack_root_error_component" })`.
- Renders an i18n'd message with buttons that call `router.invalidate()` + `reset()` or navigate to `/`.

### Lovable telemetry integration

`reportLovableError` is a thin shim over two optional globals:

- `window.__lovableEvents.captureException` — the standard Lovable event pipeline, called with `mechanism: "react_error_boundary"`, `handled: false`, `severity: "error"`.
- `window.__lovableReportRuntimeError` — a direct hook used only inside the Lovable editor preview, because prod React does not rethrow boundary-caught errors to `window.onerror`.

`describeThrown` handles the fact that loaders and server functions may throw raw `Response` objects or plain `{ message, code, details }` objects (from Supabase), which `String()` would reduce to `[object ...]`.

### Auth middleware error style

`auth-middleware.ts` throws plain `Error`s with human-readable messages prefixed by the failure category (e.g. `"Missing Supabase environment variable(s): ..."`, `"Unauthorized: No authorization header provided"`, `"Unauthorized: Invalid token"`). These are not typed exceptions — they are just strings wrapped in `Error`.

### No custom error types

A search of the codebase finds no `class *Error extends Error`, no `ErrorCode` enum, no `Result<T, E>` type, and no shared error serialization utility beyond the helpers above. Domain modules (`billing.ts`, `sales.ts`, `products.ts`, etc.) do not define their own error classes; they rely on native `Error` and on Supabase client errors.

## Conventions Observed

- Unhandled server-side errors surface to users as the static `renderErrorPage()` HTML rather than leaking h3's `{"unhandled":true,"message":"HTTPError"}` payload.
- All logged errors go through the patched `console.error`, which expands Error-like values into a multi-line description including stack traces and cause chains.
- Global browser `error` and `unhandledrejection` events are captured and stored alongside `console.error` entries so the same `consumeLastCapturedError` path can retrieve them.
- Client-side errors are funneled through the single TanStack root `errorComponent`; feature components do not install their own boundaries.
- Errors reported to Lovable include the current `window.location.pathname` as route context and mark themselves as `mechanism: "react_error_boundary"` / `handled: false`.
- Authentication failures in `auth-middleware.ts` are expressed as `throw new Error("Unauthorized: …")` with a descriptive prefix, not as a typed exception.
- Security headers (CSP, X-Frame-Options, Permissions-Policy, HSTS) are applied uniformly to every response via `applySecurityHeaders` in `server.ts`, including error responses.

## Rules Enforced by Code

- **H3-swapped SSR errors must be replaced with the static error page.** `normalizeCatastrophicSsrResponse` checks for the exact `{ unhandled: true, message: "HTTPError" }` JSON body and swaps it for `renderErrorPage()` with status 500.
- **Captured errors expire after 5 seconds.** `consumeLastCapturedError` returns `undefined` if `Date.now() - lastCapturedError.at > 5000`, preventing stale error data from leaking across unrelated requests.
- **Cause chains are truncated at depth 5 and descriptions at 8000 characters.** Enforced by `CAUSE_DEPTH_LIMIT = 5` and `DESCRIPTION_LENGTH_LIMIT = 8_000` in `describeError`.
- **Lovable reporting is skipped outside the browser.** `reportLovableError` returns early when `typeof window === "undefined"`.
- **Only Bearer tokens are accepted by the auth middleware.** Any non-Bearer authorization header throws `"Unauthorized: Only Bearer tokens are supported"`.
- **Supabase keys must be present at startup.** Missing `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` throws immediately during middleware execution.