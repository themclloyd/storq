// Server-only payment reconciliation for PayChangu (Malawi).
//
// A charge is only ever marked paid after PayChangu itself confirms it for the
// exact amount and currency we recorded. Everything that can notice a payment
// funnels through `verifyAndComplete` here: the Billing screen asking about one
// reference, the provider's webhook, and the sweeper that retries every pending
// charge. Three callers, one decision, so a payment can never be activated on
// weaker evidence down one path than another.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type VerifyResult = {
  ok: boolean;
  message: string;
  /** The reference can never complete (no row): stop retrying it. */
  drop: boolean;
};

// Connecting to Supabase (Cloudflare) or PayChangu can transiently time out —
// most often on a cold start. These calls are all idempotent (the read is a
// no-op, verify is a GET, and complete_subscription_payment returns early once a
// row is paid), so a couple of quick retries stop a momentary blip from
// stranding a payment that really succeeded.
const TRANSIENT =
  /fetch failed|connect timeout|UND_ERR_|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network_error/i;
const isTransient = (err: unknown) =>
  TRANSIENT.test(
    `${(err as { message?: string })?.message ?? ""} ${(err as { code?: string })?.code ?? ""}`,
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Supabase builders are thenables, so every call site wraps them in an `async`
// thunk to get a real promise for the retry loop.
async function retryTransient<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: T;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
    } catch (e) {
      if (i === attempts - 1 || !isTransient(e)) throw e;
      await sleep(400 * (i + 1));
      continue;
    }
    const err = (last as { error?: unknown })?.error;
    if (!err || i === attempts - 1 || !isTransient(err)) return last;
    await sleep(400 * (i + 1));
  }
  return last!;
}

const fail = (message: string, drop = false): VerifyResult => ({ ok: false, message, drop });
const pass = (message: string): VerifyResult => ({ ok: true, message, drop: false });

/**
 * Confirm one reference with the provider and, if it really succeeded, let SQL
 * grant the time and capacity it paid for. Safe to call with any string: the
 * worst a forged reference can do is cost one provider lookup.
 */
export async function verifyAndComplete(txRef: string): Promise<VerifyResult> {
  const secret = process.env["PAYCHANGU_SECRET_KEY"];
  if (!secret) return fail("Payments are not configured yet.");
  const { data: pay, error: readErr } = await retryTransient(async () =>
    supabaseAdmin
      .from("subscription_payments")
      .select("amount,currency,status")
      .eq("tx_ref", txRef)
      .maybeSingle(),
  );
  if (readErr) {
    console.error(readErr);
    return fail("Payment not confirmed yet.");
  }
  if (!pay) return fail("Payment not found.", true);
  if (pay.status === "paid") return pass("Already paid.");

  const res = await retryTransient(() =>
    fetch(`https://api.paychangu.com/verify-payment/${encodeURIComponent(txRef)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${secret}` },
    }),
  ).catch((e) => {
    console.error("PayChangu verify fetch failed", e);
    return null;
  });
  if (!res) return fail("Payment not confirmed yet.");
  const body = (await res.json().catch(() => null)) as {
    data?: { status?: string; amount?: number | string; currency?: string };
  } | null;
  const verified = body?.data;
  if (!res.ok || !verified || verified.status !== "success") {
    console.error("PayChangu verify failed", res.status, body);
    return fail("Payment not confirmed yet.");
  }
  if (
    !Number.isFinite(Number(verified.amount)) ||
    Number(verified.amount) !== Number(pay.amount) ||
    verified.currency?.toUpperCase() !== pay.currency
  ) {
    return fail("Payment amount does not match.");
  }
  // Idempotent and service-role-only: a second confirmation is a no-op, and the
  // client can never reach it to grant itself time or slots.
  const { error } = await retryTransient(async () =>
    supabaseAdmin.rpc("complete_subscription_payment" as never, { p_tx_ref: txRef } as never),
  );
  if (error) {
    console.error(error);
    return fail("Could not activate subscription.");
  }
  return pass("Subscription active.");
}

/**
 * Settle every reference the client may have abandoned: the tab closed on the
 * return redirect, the phone lost signal mid-checkout, the payment went through
 * after the shop was already locked out. Two minutes of age keeps this off the
 * critical path of a checkout that is still in progress.
 */
export async function reconcilePending(
  limit = 50,
): Promise<{ checked: number; paid: number; failed: number }> {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("subscription_payments")
    .select("tx_ref")
    .eq("status", "pending")
    .gte("created_at", since)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error(error);
    return { checked: 0, paid: 0, failed: 0 };
  }
  let paid = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const result = await verifyAndComplete(row.tx_ref);
    if (result.ok) paid++;
    else failed++;
  }
  return { checked: data?.length ?? 0, paid, failed };
}

// ── HTTP surface ────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent compare, so a bad signature cannot be brute-forced by timing. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function pickTxRef(body: unknown): string | null {
  const walk = (v: unknown, depth = 0): string | null => {
    if (!v || typeof v !== "object" || depth > 4) return null;
    const rec = v as Record<string, unknown>;
    for (const key of ["tx_ref", "txRef", "reference"]) {
      if (typeof rec[key] === "string" && rec[key]) return rec[key] as string;
    }
    for (const value of Object.values(rec)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(body);
}

/**
 * PayChangu's completion callback. The payload only names the reference; the
 * decision still comes from `verifyAndComplete`, so a forged callback cannot
 * grant anything. When a webhook secret is configured the signature is required
 * as well, and a non-2xx makes the provider retry.
 */
async function handleWebhook(request: Request): Promise<Response> {
  const raw = await request.text();
  const secret = process.env["PAYCHANGU_WEBHOOK_SECRET"];
  if (secret) {
    const given = (
      request.headers.get("signature") ??
      request.headers.get("x-paychangu-signature") ??
      ""
    ).toLowerCase();
    const expected = await hmacHex(secret, raw);
    if (!sameSecret(given, expected)) return json({ ok: false, error: "bad signature" }, 401);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const txRef = pickTxRef(body);
  if (!txRef) return json({ ok: false, error: "missing tx_ref" }, 400);
  const result = await verifyAndComplete(txRef);
  if (!result.ok && !result.drop) return json({ ok: false, detail: result.message }, 502);
  return json({ ok: true, confirmed: result.ok });
}

/**
 * Sweeper for anything the webhook and the open tab both missed. Point a
 * scheduler at this (Cloudflare Cron, a GitHub Action, cron on a box) with
 * `Authorization: Bearer $CRON_SECRET`.
 */
async function handleReconcile(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"] ?? process.env["PAYCHANGU_WEBHOOK_SECRET"];
  if (!secret) return json({ ok: false, error: "not configured" }, 503);
  const given =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret") ??
    "";
  if (!sameSecret(given, secret)) return json({ ok: false, error: "unauthorized" }, 401);
  return json({ ok: true, ...(await reconcilePending()) });
}

/** Returns a response for our payment endpoints, or null to fall through to the app. */
export async function servePaymentsApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/paychangu/webhook") {
    if (request.method !== "POST") return json({ ok: false }, 405);
    return handleWebhook(request);
  }
  if (pathname === "/api/cron/reconcile") {
    if (request.method !== "GET" && request.method !== "POST") return json({ ok: false }, 405);
    return handleReconcile(request);
  }
  return null;
}
