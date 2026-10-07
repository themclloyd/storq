import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getPaychanguKey = createServerFn({ method: "GET" }).handler(async () => {
  return { key: process.env["PAYCHANGU_PUBLIC_KEY"] ?? "" };
});

// Safe to call publicly: it only marks a payment paid after PayChangu confirms it
// succeeded for the exact amount and currency we recorded.
export const verifySubscriptionPayment = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ tx_ref: z.string().min(6).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const secret = process.env["PAYCHANGU_SECRET_KEY"];
    if (!secret) return { ok: false, message: "Payments are not configured yet." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pay } = await supabaseAdmin.from("subscription_payments").select("amount,currency,status").eq("tx_ref", data.tx_ref).maybeSingle();
    if (!pay) return { ok: false, message: "Payment not found." };
    if (pay.status === "paid") return { ok: true, message: "Already paid." };
    const res = await fetch(`https://api.paychangu.com/verify-payment/${encodeURIComponent(data.tx_ref)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${secret}` },
    });
    const body = (await res.json().catch(() => null)) as { data?: { status?: string; amount?: number | string; currency?: string } } | null;
    const t = body?.data;
    if (!res.ok || !t || t.status !== "success") {
      console.error("PayChangu verify failed", res.status, body);
      return { ok: false, message: "Payment not confirmed yet." };
    }
    if (!Number.isFinite(Number(t.amount)) || Number(t.amount) !== Number(pay.amount) || t.currency?.toUpperCase() !== pay.currency) {
      return { ok: false, message: "Payment amount does not match." };
    }
    const { error } = await supabaseAdmin.rpc("complete_subscription_payment" as never, { p_tx_ref: data.tx_ref } as never);
    if (error) { console.error(error); return { ok: false, message: "Could not activate subscription." }; }
    return { ok: true, message: "Subscription active." };
  });
