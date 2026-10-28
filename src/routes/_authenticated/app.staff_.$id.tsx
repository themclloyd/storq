import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { usePos } from "@/lib/pos";
import { StaffForm } from "@/components/pos/staff-form";
import { staffQuery } from "@/lib/staff";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/pos/skeletons";

export const Route = createFileRoute("/_authenticated/app/staff_/$id")({
  head: () => ({
    meta: [
      { title: "Edit staff | Storq" },
      { name: "description", content: "Change a team member's access and PIN." },
      { property: "og:title", content: "Edit staff | Storq" },
      { property: "og:description", content: "Change a team member's access and PIN." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EditPerson,
});

function EditPerson() {
  const { id } = Route.useParams();
  const { can } = usePos();
  const { t } = useI18n();
  const roster = useQuery(staffQuery);
  if (!can("staff"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("staff.onlyAdmins")}</Card>
    );
  const person = roster.data?.find((s) => s.id === id);
  if (!person) {
    if (roster.isPending) return <DetailSkeleton />;
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("staff.notFound")}</Card>
    );
  }
  // Keyed so a refreshed roster row resets the draft once the query returns.
  return <StaffForm key={person.id} person={person} />;
}
