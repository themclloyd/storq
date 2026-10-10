import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, Share01Icon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useCollections, shareUrl, type Collection } from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/collections/")({
  head: () => ({
    meta: [
      { title: "Collections — Storq" },
      {
        name: "description",
        content: "Manage shared product collections and collection discounts.",
      },
      { property: "og:title", content: "Collections — Storq" },
      {
        property: "og:description",
        content: "Manage shared product collections and collection discounts.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Collections,
});

function Collections() {
  const { can } = usePos();
  const { t } = useI18n();
  const cols = useCollections();
  if (!can("admin", "manager")) return <Empty>{t("col.onlyAdmins")}</Empty>;
  const list = cols.data?.list ?? [];
  const count = (id: string) =>
    Object.values(cols.data?.byProduct ?? {}).filter((ids) => ids.includes(id)).length;

  async function share(c: Collection) {
    const url = shareUrl(c.share_slug);
    try {
      if (navigator.share) await navigator.share({ title: c.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t("col.linkCopied"));
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <>
      <PageHeader
        title={t("col.title")}
        sub={t("col.listSub")}
        actions={
          <Button variant="accent" asChild>
            <Link to="/app/collections/$id" params={{ id: "new" }}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("col.newCollection")}
            </Link>
          </Button>
        }
      />
      {list.length === 0 ? (
        <Empty>{t("col.noneYet")}</Empty>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <div key={c.id} className="pos-card flex min-w-0 flex-col gap-2 p-3">
              <Link
                to="/app/collections/$id"
                params={{ id: c.id }}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-bold hover:underline">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("col.itemsCount", { count: count(c.id) })}
                  </div>
                </div>
                {c.discount_pct > 0 && (
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">
                    −{c.discount_pct}%
                  </span>
                )}
              </Link>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/app/collections/$id" params={{ id: c.id }}>
                    {t("col.open")}
                  </Link>
                </Button>
                <Button size="sm" variant="ghost" disabled={!c.is_shared} onClick={() => share(c)}>
                  <HugeiconsIcon icon={Share01Icon} />{" "}
                  {c.is_shared ? t("col.share") : t("col.notShared")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
