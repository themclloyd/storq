/**
 * Desktop stand-in for `billing.functions.ts`.
 *
 * A packaged till has no server to run the two server functions, so it asks the
 * deployed web app instead. Both desktop endpoints are public and idempotent in
 * exactly the same way as their server-function counterparts: the provider is
 * asked to confirm the charge, and only that confirmation lets SQL grant time or
 * capacity. Nothing here can activate a subscription on its own.
 *
 * The desktop Vite config aliases `@/lib/billing.functions` to this module, so
 * Billing and the ops console keep one call shape on both targets.
 */

type VerifyResult = { ok: boolean; message: string; drop: boolean };

const rawOrigin =
  (import.meta.env?.["VITE_DESKTOP_API_ORIGIN"] as string | undefined) ??
  (import.meta.env?.["VITE_SITE_URL"] as string | undefined) ??
  "";
// Fall back to the production site so a build without the variable still pays.
const ORIGIN = rawOrigin.trim().replace(/\/+$/, "") || "https://storq.xyz";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Payment service unavailable (${res.status})`);
  return (await res.json()) as T;
}

/** The publishable PayChangu key. Public by definition, so the web app hands it out. */
export async function getPaychanguKey(): Promise<{ key: string }> {
  try {
    const res = await fetch(`${ORIGIN}/api/desktop/config`, { cache: "no-store" });
    if (!res.ok) return { key: "" };
    const body = (await res.json()) as { paychangu?: unknown };
    return { key: typeof body.paychangu === "string" ? body.paychangu : "" };
  } catch {
    // Offline checkout is not a thing: the dialog says so instead of blanking.
    return { key: "" };
  }
}

/** Ask the deployed web app to settle one reference. Mirrors the server function. */
export async function verifySubscriptionPayment({
  data,
}: {
  data: { tx_ref: string };
}): Promise<VerifyResult> {
  return post<VerifyResult>("/api/desktop/verify", { tx_ref: data.tx_ref });
}
