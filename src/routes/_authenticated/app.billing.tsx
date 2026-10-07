import { createFileRoute } from "@tanstack/react-router";
import { Billing } from "@/components/pos/Billing";

export const Route = createFileRoute("/_authenticated/app/billing")({
  head: () => ({ meta: [{ title: "Subscription — Storq" }, { name: "description", content: "Manage your Storq subscription." }] }),
  component: () => <Billing />,
});
