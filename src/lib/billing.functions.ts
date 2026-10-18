import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getPaychanguKey = createServerFn({ method: "GET" }).handler(async () => {
  return { key: process.env["PAYCHANGU_PUBLIC_KEY"] ?? "" };
});

// Connecting to Supabase (Cloudflare) or PayChangu can transiently time out —
// most often on a cold SSR start. These calls are all idempotent (the read is
// a no-op, PayChangu verify is a GET, and complete_subscription_payment returns
// early once a row is paid), so a couple of quick retries are safe and stop a
// momentary blip from stranding a payment that really succeeded.
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

// Safe to call publicly: it only marks a payment paid after PayChangu confirms it
// succeeded for the exact amount and currency we recorded. `drop` tells the caller
// the reference can never complete (so it should stop retrying it on every load),
// as opposed to a transient problem that is worth keeping.
const fail = (message: string, drop = false) => ({ ok: false as const, message, drop });
const pass = (message: string) => ({ ok: true as const, message, drop: false });

export const verifySubscriptionPayment = createServerFn({ method: "POST" })
  .validator((d) => z.object({ tx_ref: z.string().min(6).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const secret = process.env["PAYCHANGU_SECRET_KEY"];
    if (!secret) return fail("Payments are not configured yet.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pay, error: readErr } = await retryTransient(async () =>
      supabaseAdmin
        .from("subscription_payments")
        .select("amount,currency,status")
        .eq("tx_ref", data.tx_ref)
        .maybeSingle(),
    );
    if (readErr) {
      console.error(readErr);
      return fail("Payment not confirmed yet.");
    }
    if (!pay) return fail("Payment not found.", true);
    if (pay.status === "paid") return pass("Already paid.");
    const res = await retryTransient(() =>
      fetch(`https://api.paychangu.com/verify-payment/${encodeURIComponent(data.tx_ref)}`, {
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
    const t = body?.data;
    if (!res.ok || !t || t.status !== "success") {
      console.error("PayChangu verify failed", res.status, body);
      return fail("Payment not confirmed yet.");
    }
    if (
      !Number.isFinite(Number(t.amount)) ||
      Number(t.amount) !== Number(pay.amount) ||
      t.currency?.toUpperCase() !== pay.currency
    ) {
      return fail("Payment amount does not match.");
    }
    const { error } = await retryTransient(async () =>
      supabaseAdmin.rpc(
        "complete_subscription_payment" as never,
        { p_tx_ref: data.tx_ref } as never,
      ),
    );
    if (error) {
      console.error(error);
      return fail("Could not activate subscription.");
    }
    return pass("Subscription active.");
  });
