import { createFileRoute } from "@tanstack/react-router";
import { Billing } from "@/components/pos/Billing";

export const Route = createFileRoute("/_authenticated/app/billing")({
  head: () => ({ meta: [{ title: "Billing & subscription — Storq" }, { name: "description", content: "Manage your Storq subscription, payments and invoices." }, { property: "og:title", content: "Billing & subscription — Storq" }, { property: "og:description", content: "Manage your Storq subscription, payments and invoices." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: () => <Billing />,
});
