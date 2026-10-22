import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon } from "@/lib/icons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useStaffNames } from "@/lib/sales";
import { downloadStockTakeReport, useStockTake, useStockTakeLines } from "@/lib/stock-take";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, NoAccess, PageHeader, Pager, Status, fmtDate } from "@/components/pos/bits";
import { pageSlice } from "@/lib/paging";
import { useOnce } from "@/hooks/use-once";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/stocktake")({
  // The session screen sends the just-finished take back here as ?export=<id>
  // so the list can ask whether to download its report.
  validateSearch: (search: Record<string, unknown>): { export?: string | undefined } => ({
    export: typeof search["export"] === "string" && search["export"] ? search["export"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Stock takes | Storq" },
      {
        name: "description",
        content: "Review stock take sessions and reconcile store inventory.",
      },
      { property: "og:title", content: "Stock takes | Storq" },
      {
        property: "og:description",
        content: "Review stock take sessions and reconcile store inventory.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StockTakeList,
});

type Take = {
  id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  started_by: string | null;
  closed_by: string | null;
};
type TakeFilter = "all" | "open" | "closed";

function StockTakeList() {
  const { can } = usePos();
  if (!can("stock", "view_stock")) return <NoAccess />;
  return <StockTakeListContent />;
}

function StockTakeListContent() {
  const { store, stores, can, rpc, business } = usePos();
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const names = useStaffNames();
  const [filter, setFilter] = useState<TakeFilter>("all");
  const [page, setPage] = useState(0);
  // Blind counting: variance-bearing reports stay with admins and managers.
  const canExport = can("stock");
  const { export: exportId } = Route.useSearch();
  // The detail screen already cached the take, its lines and that store's
  // catalog, so the prompt opens with data in hand; a cold link fetches them.
  const reportTake = useStockTake(exportId);
  const reportLines = useStockTakeLines(exportId);
  const reportProducts = useProducts(reportTake.data?.store_id);
  const reportNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of reportProducts.data ?? []) m[p.id] = p.name;
    return m;
  }, [reportProducts.data]);
  const reportSkuById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of reportProducts.data ?? []) if (p.sku) m[p.id] = p.sku;
    return m;
  }, [reportProducts.data]);
  // Sessions change only on start/close, which invalidate ["takes"]; live
  // per-line counts are polled on the session screen instead.
  const takes = useQuery({
    queryKey: ["takes", store?.id],
    enabled: !!store,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_takes")
        .select("id,status,created_at,closed_at,started_by,closed_by")
        .eq("store_id", store!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as Take[];
    },
  });
  const open = takes.data?.find((tk) => tk.status === "open");
  const rows = useMemo(
    () => (takes.data ?? []).filter((tk) => filter === "all" || tk.status === filter),
    [takes.data, filter],
  );
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(rows, page);
  const person = (id: string | null) => (id ? names.data?.[id] : undefined);
  const go = (id: string) => navigate({ to: "/app/stocktake/$id", params: { id } });
  const closeExport = () => navigate({ to: "/app/stocktake", search: {}, replace: true });
  const { run: runExport, running: exporting } = useOnce(async (kind: "csv" | "pdf") => {
    const take = reportTake.data;
    if (!take || !canExport) return;
    try {
      await downloadStockTakeReport(kind, {
        take,
        lines: reportLines.data ?? [],
        nameById: reportNameById,
        skuById: reportSkuById,
        staffNames: names.data ?? {},
        storeName: stores.find((s) => s.id === take.store_id)?.name ?? store?.name,
        businessName: business?.name,
      });
      closeExport();
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  async function start() {
    if (!store) return;
    try {
      const id = await rpc<string>("start_stock_take", { p_store: store.id });
      toast.success(t("stk.started"));
      invalidateKeys(qc, [["takes"]]);
      if (id) go(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        back={{ to: "/app/inventory", label: t("nav.items") }}
        title={t("stk.title")}
        sub={
          open
            ? t("stk.subCounting", { store: store?.name ?? "", date: fmtDate(open.created_at) })
            : t("stk.subList", { store: store?.name ?? "" })
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 bg-card">
                  <HugeiconsIcon icon={FilterIcon} /> {t("common.filter")}
                  {filter !== "all" && (
                    <Badge variant="secondary" className="ml-0.5 rounded-full px-1.5">
                      1
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup
                  value={filter}
                  onValueChange={(v) => {
                    setFilter(v as TakeFilter);
                    setPage(0);
                  }}
                >
                  <DropdownMenuRadioItem value="all">{t("common.all")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="open">{t("status.open")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="closed">{t("status.closed")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {open ? (
              <Button onClick={() => go(open.id)}>{t("stk.resume")}</Button>
            ) : can("stock") ? (
              <Button onClick={() => void start()}>{t("stk.start")}</Button>
            ) : undefined}
          </>
        }
      />
      {takes.isPending ? (
        <Empty>{t("common.loading")}</Empty>
      ) : rows.length === 0 ? (
        <Empty>{filter === "all" ? t("stk.none") : t("stk.noneInFilter")}</Empty>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24 pl-4">{t("stk.statusCol")}</TableHead>
                  <TableHead className="w-1/3">{t("stk.startedWord")}</TableHead>
                  <TableHead className="hidden w-1/3 sm:table-cell">
                    {t("stk.closedWord")}
                  </TableHead>
                  <TableHead className="w-10 pr-4">
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((tk) => {
                  const startedBy = person(tk.started_by);
                  const closedBy = person(tk.closed_by);
                  return (
                    <TableRow
                      key={tk.id}
                      className="cursor-pointer text-[13px]"
                      onClick={() => go(tk.id)}
                    >
                      <TableCell className="pl-4">
                        <Status s={tk.status} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{fmtDate(tk.created_at)}</div>
                        {startedBy && (
                          <div className="text-xs text-muted-foreground">
                            {t("stk.by", { name: startedBy })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {tk.closed_at ? (
                          <>
                            <div>{fmtDate(tk.closed_at)}</div>
                            {closedBy && (
                              <div className="text-xs">{t("stk.by", { name: closedBy })}</div>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="pr-4">
                        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <Pager page={curPage} pageCount={pageCount} total={rows.length} onPage={setPage} />
        </>
      )}
      <Dialog open={!!exportId && canExport} onOpenChange={(open) => !open && closeExport()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("stk.doneTitle")}</DialogTitle>
            <DialogDescription>
              {reportTake.isPending || reportLines.isPending
                ? t("common.loading")
                : t("stk.doneExport")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={exporting} onClick={closeExport}>
              {t("stk.notNow")}
            </Button>
            <Button
              variant="outline"
              disabled={
                exporting || !reportTake.data || !reportLines.data || reportProducts.isPending
              }
              onClick={() => void runExport("csv")}
            >
              {t("common.exportCsv")}
            </Button>
            <Button
              disabled={
                exporting || !reportTake.data || !reportLines.data || reportProducts.isPending
              }
              onClick={() => void runExport("pdf")}
            >
              {t("common.exportPdf")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
