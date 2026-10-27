import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { useStaffNames } from "@/lib/sales";
import { invalidateKeys } from "@/lib/cache-invalidation";
import {
  downloadStockTakeReport,
  stockTakeSubtitle,
  useStockTake,
  useStockTakeLines,
  type StockTake,
  type StockTakeLine,
} from "@/lib/stock-take";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl, type SegmentOption } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, NoAccess, PageHeader, Pager, Stat, StatRow, Status } from "@/components/pos/bits";
import { ConfirmDialog } from "@/components/pos/ConfirmDialog";
import { ExportMenu } from "@/components/pos/ExportMenu";
import { cn } from "@/lib/utils";
import { pageSlice } from "@/lib/paging";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useOnce } from "@/hooks/use-once";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/stocktake_/$id")({
  head: () => ({
    meta: [
      { title: "Stock take | Storq" },
      {
        name: "description",
        content: "Count items and review the quantity differences of a stock take.",
      },
      { property: "og:title", content: "Stock take | Storq" },
      {
        property: "og:description",
        content: "Count items and review the quantity differences of a stock take.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StockTakeDetail,
});

type LineFilter = "all" | "diff" | "left";

/** The count currently shown: an edit on this screen outranks the polled row. */
function lineCount(l: StockTakeLine, drafts: Record<string, string>): number | null {
  if (l.product_id in drafts) {
    const raw = (drafts[l.product_id] ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return l.counted === null ? null : Number(l.counted);
}

function StockTakeDetail() {
  const { can } = usePos();
  if (!can("stock", "view_stock")) return <NoAccess />;
  return <StockTakeDetailContent />;
}

function StockTakeDetailContent() {
  const { id } = Route.useParams();
  const { store, stores, can, rpc, staff, business } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const names = useStaffNames();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<LineFilter>("all");
  const [page, setPage] = useState(0);
  // Per-item drafts double as the instant display value and the write source,
  // so a typed count and its variance never wait on the RPC.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const seesVariance = can("stock");

  const navigate = useNavigate();
  const takeQ = useStockTake(id);
  const take = takeQ.data;
  // The take's lines reference its own store's item copies, so the catalog is
  // scoped to that store (not whichever store the operator last switched to).
  const products = useProducts(take?.store_id);
  const open = take?.status === "open";
  const lines = useStockTakeLines(id, open);
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of products.data ?? []) m[p.id] = p.name;
    return m;
  }, [products.data]);
  const skuById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of products.data ?? []) if (p.sku) m[p.id] = p.sku;
    return m;
  }, [products.data]);
  const dq = useDebouncedValue(q);
  const rows = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const label = (pid: string) => nameById[pid] ?? "";
    return (
      (lines.data ?? [])
        // Visibility follows the saved rows so a row cannot vanish (and drop the
        // focused input's blur save) the moment a typed count fixes it.
        .filter((l) => {
          if (filter === "left" && l.counted !== null) return false;
          if (filter === "diff" && (l.counted === null || Number(l.counted) === Number(l.expected)))
            return false;
          return !needle || label(l.product_id).toLowerCase().includes(needle);
        })
        .sort((a, b) => label(a.product_id).localeCompare(label(b.product_id)))
    );
  }, [lines.data, filter, dq, nameById]);
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(rows, page);
  // Cards and variances read the drafts, so they move with every keystroke.
  const summary = useMemo(() => {
    let counted = 0;
    let diffs = 0;
    let net = 0;
    for (const l of lines.data ?? []) {
      const c = lineCount(l, drafts);
      if (c === null) continue;
      counted++;
      const d = c - Number(l.expected);
      if (d !== 0) diffs++;
      net += d;
    }
    return { counted, diffs, net: Math.round(net * 100) / 100 };
  }, [lines.data, drafts]);
  const total = lines.data?.length ?? 0;
  const { counted, diffs, net } = summary;

  function clearDraft(pid: string) {
    setDrafts((d) => {
      const next = { ...d };
      delete next[pid];
      return next;
    });
  }
  function patchLine(pid: string, counted: number | null, countedBy: string | null) {
    qc.setQueryData<StockTakeLine[]>(["take-lines", id], (old) =>
      old?.map((l) => (l.product_id === pid ? { ...l, counted, counted_by: countedBy } : l)),
    );
  }
  async function commit(pid: string, raw: string) {
    if (take?.status !== "open") return;
    const line = lines.data?.find((l) => l.product_id === pid);
    if (!line) return;
    const value = raw.trim() === "" ? null : Number(raw.trim());
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      clearDraft(pid);
      toast.error(t("stk.countInvalid"));
      return;
    }
    const before = line.counted === null ? null : Number(line.counted);
    if (before === value) {
      clearDraft(pid);
      return;
    }
    // Paint the row and its variance immediately; persistence follows.
    setDrafts((d) => ({ ...d, [pid]: value === null ? "" : String(value) }));
    patchLine(pid, value, staff?.id ?? null);
    try {
      await rpc("count_stock", { p_take: id, p_product: pid, p_counted: value });
      // Re-assert after the write: a poll that started before it must not roll
      // the row back until the next tick. The draft stays as the local truth.
      patchLine(pid, value, staff?.id ?? null);
    } catch (e) {
      patchLine(pid, before, line.counted_by);
      clearDraft(pid);
      toast.error((e as Error).message);
    }
  }
  async function finish() {
    if (!take) return;
    setClosing(true);
    try {
      await rpc("close_stock_take", { p_take: take.id });
      // Flip the session closed right away so the count inputs lock without
      // waiting for the refetch; invalidation reconciles the timestamps.
      qc.setQueryData<StockTake | null>(["take", id], (old) =>
        old
          ? {
              ...old,
              status: "closed",
              closed_at: new Date().toISOString(),
              closed_by: staff?.id ?? old.closed_by,
            }
          : old,
      );
      toast.success(t("stk.levelsUpdated"));
      setConfirmClose(false);
      invalidateKeys(qc, [
        ["takes"],
        ["take"],
        ["take-lines"],
        ["stock"],
        ["movements"],
        ["dash-alerts"],
      ]);
      // The list owns the post-close flow and asks whether to export the report.
      navigate({ to: "/app/stocktake", search: { export: take.id }, replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClosing(false);
    }
  }
  const { run: runExport, running: exporting } = useOnce(async (kind: "csv" | "pdf") => {
    if (!take) return;
    try {
      await downloadStockTakeReport(kind, {
        take,
        // Unsaved edits are part of what the screen shows, so export them too.
        lines: (lines.data ?? []).map((l) => ({ ...l, counted: lineCount(l, drafts) })),
        nameById,
        skuById,
        staffNames: names.data ?? {},
        storeName,
        businessName: business?.name,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  });

  const back = { to: "/app/stocktake" as const, label: t("nav.stocktakes") };
  if (takeQ.isPending)
    return (
      <>
        <PageHeader back={back} title={t("stk.title")} />
        <Empty>{t("common.loading")}</Empty>
      </>
    );
  if (!take)
    return (
      <>
        <PageHeader back={back} title={t("stk.title")} />
        <Empty>{t("stk.notFound")}</Empty>
      </>
    );

  const storeName = stores.find((s) => s.id === take.store_id)?.name ?? store?.name;
  const sub = stockTakeSubtitle(take, storeName, names.data ?? {});
  const filterOptions: SegmentOption<LineFilter>[] = [
    { value: "all", label: t("common.all") },
    ...(seesVariance ? [{ value: "diff" as LineFilter, label: t("stk.diffOnly") }] : []),
    { value: "left", label: t("stk.notCounted") },
  ];
  // Blind counting: everyone without stock access counts the shelf without
  // seeing the system figure or the variance.
  const cards: [string, string | number][] = seesVariance
    ? [
        [t("stk.itemsWord"), total],
        [t("stk.countedWord"), `${counted} / ${total}`],
        [t("stk.withDiff"), diffs],
        [t("stk.netVariance"), net > 0 ? `+${net}` : net],
      ]
    : [
        [t("stk.itemsWord"), total],
        [t("stk.countedWord"), `${counted} / ${total}`],
      ];

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {t("stk.title")} <Status s={take.status} />
          </span>
        }
        sub={sub}
        actions={
          seesVariance ? (
            <>
              {total > 0 && (
                <ExportMenu disabled={exporting} onExport={(kind) => void runExport(kind)} />
              )}
              {open && (
                <Button variant="success" onClick={() => setConfirmClose(true)}>
                  {t("stk.finish")}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <StatRow className="mb-4">
        {cards.map(([k, v]) => (
          <Stat key={k} label={k} value={v} />
        ))}
      </StatRow>
      {!open && total > counted && (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("stk.notCountedNote", { n: total - counted })}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-full bg-card sm:w-56"
          placeholder={t("stk.findItem")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <SegmentedControl
          aria-label={t("stk.title")}
          size="sm"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(0);
          }}
          options={filterOptions}
        />
        <span className="text-[13px] text-muted-foreground sm:ml-auto">
          {t("stk.countedStat", { counted, total })}
        </span>
      </div>
      {lines.isPending ? (
        <Empty>{t("common.loading")}</Empty>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t("doc.item")}</TableHead>
                  {seesVariance && <TableHead>{t("stk.systemWord")}</TableHead>}
                  <TableHead className="w-28">{t("stk.countedWord")}</TableHead>
                  {seesVariance && <TableHead className="w-24">{t("stk.varianceCol")}</TableHead>}
                  {seesVariance && (
                    <TableHead className="hidden md:table-cell">{t("stk.countedByCol")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((l) => {
                  const countedValue = lineCount(l, drafts);
                  const diff = countedValue === null ? null : countedValue - Number(l.expected);
                  return (
                    <TableRow key={l.product_id}>
                      <TableCell className="pl-4 font-medium">
                        <span className="block max-w-[22rem] truncate">
                          {nameById[l.product_id] ?? "…"}
                        </span>
                      </TableCell>
                      {seesVariance && (
                        <TableCell className="tabular text-muted-foreground">
                          {Number(l.expected)}
                        </TableCell>
                      )}
                      <TableCell>
                        {open && can("stock") ? (
                          <Input
                            className="tabular h-8 w-24 text-right"
                            inputMode="decimal"
                            value={
                              drafts[l.product_id] ?? (l.counted === null ? "" : String(l.counted))
                            }
                            placeholder={t("stk.countPh")}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [l.product_id]: e.target.value }))
                            }
                            onBlur={(e) => void commit(l.product_id, e.target.value)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && (e.target as HTMLInputElement).blur()
                            }
                          />
                        ) : (
                          <span
                            className={cn(
                              "tabular",
                              countedValue === null && "text-muted-foreground",
                            )}
                          >
                            {countedValue === null ? "—" : countedValue}
                          </span>
                        )}
                      </TableCell>
                      {seesVariance && (
                        <TableCell
                          className={cn(
                            "tabular font-medium",
                            diff === null
                              ? "text-muted-foreground"
                              : diff < 0
                                ? "text-destructive"
                                : diff > 0
                                  ? "text-success"
                                  : "",
                          )}
                        >
                          {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                        </TableCell>
                      )}
                      {seesVariance && (
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {(l.counted_by && names.data?.[l.counted_by]) || "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {pageRows.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">{t("stk.nothing")}</p>
            )}
          </Card>
          <Pager page={curPage} pageCount={pageCount} total={rows.length} onPage={setPage} />
        </>
      )}
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t("stk.closeTitle")}
        description={t("stk.closeConfirm")}
        confirmLabel={t("stk.finish")}
        busy={closing}
        onConfirm={() => void finish()}
      >
        {/* What the finish is about to write, so the decision is made on
            numbers rather than on a promise. */}
        <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("stk.countedWord")}</dt>
            <dd className="tabular font-medium">
              {counted} / {total}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("stk.withDiff")}</dt>
            <dd className="tabular font-medium">{diffs}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("stk.netVariance")}</dt>
            <dd
              className={cn(
                "tabular font-medium",
                net < 0 && "text-destructive",
                net > 0 && "text-success",
              )}
            >
              {net > 0 ? `+${net}` : net}
            </dd>
          </div>
        </dl>
        {total > counted && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            {t("stk.notCountedNote", { n: total - counted })}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
