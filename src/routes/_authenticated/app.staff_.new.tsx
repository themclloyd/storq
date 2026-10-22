import { createFileRoute } from "@tanstack/react-router";
import { usePos } from "@/lib/pos";
import { StaffForm } from "@/components/pos/staff-form";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/app/staff_/new")({
  head: () => ({
    meta: [
      { title: "New staff | Storq" },
      { name: "description", content: "Add a team member and choose their access." },
      { property: "og:title", content: "New staff | Storq" },
      { property: "og:description", content: "Add a team member and choose their access." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: NewPerson,
});

function NewPerson() {
  const { can } = usePos();
  const { t } = useI18n();
  if (!can("staff"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("staff.onlyAdmins")}</Card>
    );
  // A new person starts able to sell: the one thing a shop hires for, and the
  // owner can widen it from here.
  return <StaffForm person={{ active: true, permissions: ["sell"] }} />;
}
