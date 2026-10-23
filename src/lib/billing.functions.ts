import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getPaychanguKey = createServerFn({ method: "GET" }).handler(async () => {
  return { key: process.env["PAYCHANGU_PUBLIC_KEY"] ?? "" };
});

/**
 * Ask the server to settle one subscription reference.
 *
 * Safe to call publicly: it only marks a payment paid after PayChangu confirms
 * it for the exact amount and currency we recorded. `drop` tells the caller the
 * reference can never complete (so it should stop retrying it), as opposed to a
 * transient problem that is worth keeping.
 */
export const verifySubscriptionPayment = createServerFn({ method: "POST" })
  .validator((d) => z.object({ tx_ref: z.string().min(6).max(80) }).parse(d))
  .handler(async ({ data }) => {
    // Loaded inside the handler so the service-role client never reaches the
    // browser bundle.
    const { verifyAndComplete } = await import("@/lib/payments.server");
    return verifyAndComplete(data.tx_ref);
  });
