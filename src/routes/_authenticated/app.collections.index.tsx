import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { useCollections } from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { BackLink, Empty, PageHeader, Pager } from "@/components/pos/bits";
import { pageSlice } from "@/lib/paging";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/collections/")({
  head: () => ({
    meta: [
      { title: "Collections | Storq" },
      {
        name: "description",
        content: "Manage shared product collections and collection discounts.",
      },
      { property: "og:title", content: "Collections | Storq" },
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
  const [page, setPage] = useState(0);
  const cols = useCollections();
  if (!can("admin", "manager")) return <Empty>{t("col.onlyAdmins")}</Empty>;
  const list = cols.data?.list ?? [];
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(list, page);
  const count = (id: string) =>
    Object.values(cols.data?.byProduct ?? {}).filter((ids) => ids.includes(id)).length;

  return (
    <>
      <BackLink to="/app/inventory" label={t("nav.items")} />
      <PageHeader
        breadcrumb={`${t("nav.inventory")} / ${t("nav.collections")}`}
        title={t("col.title")}
        sub={t("col.listSub")}
        actions={
          <Button asChild>
            <Link to="/app/collections/$id" params={{ id: "new" }}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("col.newCollection")}
            </Link>
          </Button>
        }
      />
      {list.length === 0 ? (
        <Empty>{t("col.noneYet")}</Empty>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {pageRows.map((c) => (
              <div key={c.id} className="pos-card flex min-w-0 flex-col gap-2 p-3">
                <Link
                  to="/app/collections/$id"
                  params={{ id: c.id }}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium hover:underline">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("col.itemsCount", { count: count(c.id) })}
                    </div>
                  </div>
                  {c.discount_pct > 0 && (
                    <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
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
                </div>
              </div>
            ))}
          </div>
          <Pager page={curPage} pageCount={pageCount} total={list.length} onPage={setPage} />
        </>
      )}
    </>
  );
}
