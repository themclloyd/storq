import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Delete02Icon, PlusSignIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { useCollections } from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, NoAccess, PageHeader, Pager } from "@/components/pos/bits";
import { ConfirmDialog } from "@/components/pos/ConfirmDialog";
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
  const { can, rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cols = useCollections();
  const list = cols.data?.list ?? [];
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(list, page);
  const countByCollection = useMemo(() => {
    const out: Record<string, number> = {};
    for (const ids of Object.values(cols.data?.byProduct ?? {}))
      for (const id of ids) out[id] = (out[id] ?? 0) + 1;
    return out;
  }, [cols.data]);
  const pickedIds = Object.keys(picked).filter((id) => picked[id]);
  const pickedOnPage = pageRows.filter((c) => picked[c.id]).length;
  const allPicked = pageRows.length > 0 && pickedOnPage === pageRows.length;
  // Viewing a collection never needs the delete tools: bulk removal, row
  // selection and the New collection button follow the change grant.
  const canEdit = can("stock");

  if (!can("stock", "view_stock")) return <NoAccess />;

  // Collections are removed one RPC at a time; failures stay selected so a
  // retry targets only what is left. Items themselves are never touched.
  async function removePicked() {
    const ids = pickedIds;
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const failed: string[] = [];
      let firstError = "";
      for (const id of ids) {
        try {
          await rpc("delete_collection", { p_id: id });
        } catch (e) {
          failed.push(id);
          if (!firstError) firstError = (e as Error).message;
        }
      }
      await qc.invalidateQueries({ queryKey: ["collections"] });
      setPicked(Object.fromEntries(failed.map((id) => [id, true])));
      setConfirmOpen(false);
      const removed = ids.length - failed.length;
      if (removed === 1) toast.success(t("col.deleted"));
      else if (removed > 1) toast.success(t("col.deletedCount", { count: removed }));
      if (firstError) toast.error(firstError);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("col.title")}
        sub={t("col.listSub")}
        actions={
          canEdit ? (
            <Button asChild>
              <Link to="/app/collections/$id" params={{ id: "new" }}>
                <HugeiconsIcon icon={PlusSignIcon} /> {t("col.newCollection")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {list.length === 0 ? (
        <Empty>{t("col.noneYet")}</Empty>
      ) : (
        <>
          {canEdit && pickedIds.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
                <HugeiconsIcon icon={Delete02Icon} /> {t("common.delete")} · {pickedIds.length}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setPicked({})}
              >
                {t("col.clearSelection")}
              </Button>
            </div>
          )}
          <Card className="overflow-hidden">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-8 pr-0">
                      <Checkbox
                        aria-label={t("col.selectAll")}
                        checked={allPicked ? true : pickedOnPage > 0 ? "indeterminate" : false}
                        onCheckedChange={(v) =>
                          setPicked((s) => {
                            const next = { ...s };
                            for (const c of pageRows) next[c.id] = v === true;
                            return next;
                          })
                        }
                      />
                    </TableHead>
                  )}
                  <TableHead className="pl-4">{t("common.name")}</TableHead>
                  <TableHead className="w-24">{t("col.items")}</TableHead>
                  <TableHead className="w-24">{t("col.discount")}</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((c) => (
                  <TableRow key={c.id}>
                    {canEdit && (
                      <TableCell className="w-8 pr-0">
                        <Checkbox
                          aria-label={t("col.selectItem", { name: c.name })}
                          checked={!!picked[c.id]}
                          onCheckedChange={(v) => setPicked((s) => ({ ...s, [c.id]: v === true }))}
                        />
                      </TableCell>
                    )}
                    <TableCell className="py-3 pl-4">
                      <Link
                        to="/app/collections/$id"
                        params={{ id: c.id }}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {countByCollection[c.id] ?? 0}
                    </TableCell>
                    <TableCell>
                      {c.discount_pct > 0 ? (
                        <Badge className="border-transparent bg-success-soft text-success">
                          −{c.discount_pct}%
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      <Link
                        to="/app/collections/$id"
                        params={{ id: c.id }}
                        aria-label={t("col.open")}
                        className="flex justify-end text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager page={curPage} pageCount={pageCount} total={list.length} onPage={setPage} />
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          pickedIds.length === 1
            ? t("col.deleteTitle")
            : t("col.bulkDeleteTitle", { count: pickedIds.length })
        }
        description={pickedIds.length === 1 ? t("col.deleteConfirm") : t("col.bulkDeleteConfirm")}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onConfirm={removePicked}
      />
    </>
  );
}
