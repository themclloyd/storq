---
kind: logging_system
name: Logging System — console.error interception and h3 error capture
category: logging_system
scope:
    - '**'
source_files:
    - src/lib/error-capture.ts
    - src/server.ts
    - src/start.ts
    - src/integrations/supabase/auth-middleware.ts
    - src/integrations/supabase/client.server.ts
    - src/integrations/supabase/client.ts
    - src/lib/billing.functions.ts
---

## What system/approach is used

The application has **no dedicated logging framework** (no winston, pino, bun.log, or similar). All output goes through the native `console` API (`console.error`, with a few `console.warn`/`console.info` usages in Supabase integration files). The only infrastructure around logging is a small custom module that intercepts `console.error` to expand Error objects and capture unhandled exceptions for later retrieval by the server entry.

## Key files and packages

- `src/lib/error-capture.ts` — the sole logging-related module; wraps `console.error`, serializes Error cause chains, and exposes a short-lived error store consumed by the server.
- `src/server.ts` — imports `error-capture` at the top of the file, then uses `consumeLastCapturedError()` when h3 swallows an SSR throw into a generic 500 JSON response.
- `src/start.ts` — catches startup errors and logs them via `console.error`.
- `src/integrations/supabase/*.ts` — use `console.error` directly with `[Supabase]`-prefixed messages for auth/client failures.
- `src/lib/billing.functions.ts` — uses `console.error` for PayChangu verification failures.

No other files import a logger; there is no `log/`, `logging/`, or `logger.*` directory.

## Architecture and conventions

1. **Single interception point.** `error-capture.ts` replaces `console.error` once on process start:
   ```ts
   const originalConsoleError = console.error.bind(console);
   console.error = (...args: unknown[]) => {
     const expanded = args.map((arg) => {
       if (!isErrorLike(arg)) return arg;
       record(arg);
       return describeError(arg);
     });
     originalConsoleError(...expanded);
   };
   ```
   Every `console.error` call is therefore funneled through this wrapper.

2. **Error expansion.** `describeError(error)` walks up to `CAUSE_DEPTH_LIMIT` (5) levels of `Error.cause`, concatenating stack traces and status annotations, capped at `DESCRIPTION_LENGTH_LIMIT` (8,000 chars). Non-Error arguments are passed through unchanged.

3. **Out-of-band error capture for h3.** Because h3 converts thrown HTTPErrors into a plain `{"unhandled":true,"message":"HTTPError"}` JSON body without a stack, the module records the last captured Error in a global variable with a 5-second TTL (`TTL_MS`). `server.ts` calls `consumeLastCapturedError()` inside `normalizeCatastrophicSsrResponse` to recover the full stack before rendering the HTML error page.

4. **Global event listeners.** The module also registers `globalThis.addEventListener("error")` and `globalThis.addEventListener("unhandledrejection")` to capture browser-side unhandled errors and promise rejections into the same store.

5. **No log levels, no structured fields, no sinks.** There is no concept of log level (debug/info/warn/error), no structured JSON payloads, no rotation, no remote sink, and no configuration file for logging. Output is always text written to the runtime's stderr/stdout via the native `console`.

6. **Prefix convention.** Where `console.error` is used directly (outside the interceptor path), messages are prefixed with a bracketed source tag, e.g. `[Supabase] ${message}` and `PayChangu verify failed`.

## Conventions and constraints

- **All logging goes through `console.error`.** No other logging library is imported anywhere in the codebase (verified by grep across `src/**/*`).
- **Error objects are never logged raw.** The wrapped `console.error` expands every Error argument via `describeError` before delegating to the original function, so downstream consumers (the runtime's stderr) receive a string containing the message, stack, and cause chain rather than a serialized object stripped by h3.
- **h3-swallowed SSR errors must be recovered via `consumeLastCapturedError`.** `server.ts` checks for h3's specific swallowed-error JSON body (`{"unhandled":true,"message":"HTTPError"}`) and falls back to the captured error or a synthetic `h3 swallowed SSR error: …` message.
- **Captured errors expire after 5 seconds.** `consumeLastCapturedError` returns `undefined` if `Date.now() - lastCapturedError.at > TTL_MS`, preventing stale error data from leaking across unrelated requests.
- **Cause chains are bounded to 5 levels and descriptions to 8,000 characters.** These limits are enforced in `describeError` to avoid runaway memory usage on deeply nested or extremely large error objects.
- **Browser-side unhandled errors and promise rejections are recorded** via `globalThis.addEventListener("error")` and `globalThis.addEventListener("unhandledrejection")` so they can be surfaced by the server's error recovery path.