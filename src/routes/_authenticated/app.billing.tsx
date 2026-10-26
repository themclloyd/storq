import { createFileRoute } from "@tanstack/react-router";
import { Billing } from "@/components/pos/Billing";

export const Route = createFileRoute("/_authenticated/app/billing")({
  // `?intent=add-stores` is the hand-off from a location that hit the paid
  // capacity: it opens the buy-slot flow directly instead of the renewal panel,
  // which would otherwise ask for a month count the buyer does not control.
  // Returning an empty object (rather than the key set to undefined) keeps the
  // search parameter genuinely optional, so every plain `to="/app/billing"`
  // link in the shell stays valid.
  validateSearch: (search: Record<string, unknown>): { intent?: "add-stores" } =>
    search["intent"] === "add-stores" ? { intent: "add-stores" } : {},
  head: () => ({
    meta: [
      { title: "Billing & subscription | Storq" },
      { name: "description", content: "Manage your Storq subscription, payments and invoices." },
      { property: "og:title", content: "Billing & subscription | Storq" },
      {
        property: "og:description",
        content: "Manage your Storq subscription, payments and invoices.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <Billing />,
});
