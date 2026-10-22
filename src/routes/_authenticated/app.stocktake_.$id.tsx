import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { useStaffNames } from "@/lib/sales";
import { invalidateKeys } from "@/lib/cache-invalidation";
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
import { Empty, PageHeader, Pager, Status, fmtDate } from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { pageSlice } from "@/lib/paging";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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

type Take = {
  id: string;
  store_id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  started_by: string | null;
  closed_by: string | null;
};
type LineRow = {
  product_id: string;
  expected: number;
  counted: number | null;
  counted_by: string | null;
};
type LineFilter = "all" | "diff" | "left";

function StockTakeDetail() {
  const { id } = Route.useParams();
  const { store, stores, can, rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const names = useStaffNames();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<LineFilter>("all");
  const [page, setPage] = useState(0);
  const isManager = can("admin", "manager");

  const takeQ = useQuery({
    queryKey: ["take", id],
    // Start/close invalidate ["take"]; a revisit inside the minute is instant.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_takes")
        .select("id,store_id,status,created_at,closed_at,started_by,closed_by")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Take | null;
    },
  });
  const take = takeQ.data;
  // The take's lines reference its own store's item copies, so the catalog is
  // scoped to that store (not whichever store the operator last switched to).
  const products = useProducts(take?.store_id);
  const open = take?.status === "open";
  const lines = useQuery({
    queryKey: ["take-lines", id],
    enabled: !!take,
    // Live team count while the session is open; a closed session never changes.
    refetchInterval: open ? 15_000 : false,
    // A background tab must not keep polling; the count re-syncs on visibility.
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_take_lines")
        .select("product_id,expected,counted,counted_by")
        .eq("stock_take_id", id);
      if (error) throw error;
      return data as unknown as LineRow[];
    },
  });
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of products.data ?? []) m[p.id] = p.name;
    return m;
  }, [products.data]);
  const dq = useDebouncedValue(q);
  const rows = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const label = (pid: string) => nameById[pid] ?? "";
    return (lines.data ?? [])
      .filter((l) => {
        if (filter === "left" && l.counted !== null) return false;
        if (filter === "diff" && (l.counted === null || Number(l.counted) === Number(l.expected)))
          return false;
        return !needle || label(l.product_id).toLowerCase().includes(needle);
      })
      .sort((a, b) => label(a.product_id).localeCompare(label(b.product_id)));
  }, [lines.data, filter, dq, nameById]);
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(rows, page);
  const total = lines.data?.length ?? 0;
  const counted = lines.data?.filter((l) => l.counted !== null).length ?? 0;
  const diffs = (lines.data ?? []).filter(
    (l) => l.counted !== null && Number(l.counted) !== Number(l.expected),
  );
  const net =
    Math.round(diffs.reduce((a, l) => a + Number(l.counted) - Number(l.expected), 0) * 100) / 100;

  async function save(pid: string, v: string) {
    if (v === "") return;
    try {
      await rpc("count_stock", { p_take: id, p_product: pid, p_counted: Number(v) });
      qc.invalidateQueries({ queryKey: ["take-lines", id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function close() {
    if (!take) return;
    if (!confirm(t("stk.closeConfirm"))) return;
    try {
      await rpc("close_stock_take", { p_take: take.id });
      toast.success(t("stk.levelsUpdated"));
      invalidateKeys(qc, [
        ["takes"],
        ["take"],
        ["take-lines"],
        ["stock"],
        ["movements"],
        ["dash-alerts"],
      ]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

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
  const startedBy = take.started_by ? names.data?.[take.started_by] : undefined;
  const closedBy = take.closed_by ? names.data?.[take.closed_by] : undefined;
  const sub = [
    storeName,
    startedBy
      ? t("stk.startedBy", { date: fmtDate(take.created_at), name: startedBy })
      : `${t("stk.startedWord")} ${fmtDate(take.created_at)}`,
    take.closed_at
      ? closedBy
        ? t("stk.closedBy", { date: fmtDate(take.closed_at), name: closedBy })
        : `${t("stk.closedWord")} ${fmtDate(take.closed_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const filterOptions: SegmentOption<LineFilter>[] = [
    { value: "all", label: t("common.all") },
    ...(isManager ? [{ value: "diff" as LineFilter, label: t("stk.diffOnly") }] : []),
    { value: "left", label: t("stk.notCounted") },
  ];
  // Cashiers count blind: system quantities and variances stay with managers.
  const cards: [string, string | number][] = isManager
    ? [
        [t("stk.itemsWord"), total],
        [t("stk.countedWord"), `${counted} / ${total}`],
        [t("stk.withDiff"), diffs.length],
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
          open && isManager ? (
            <Button variant="success" onClick={() => void close()}>
              {t("stk.finish")}
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {cards.map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="font-display tabular mt-1 text-2xl">{v}</p>
          </Card>
        ))}
      </div>
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
                  {isManager && <TableHead>{t("stk.systemWord")}</TableHead>}
                  <TableHead className="w-28">{t("stk.countedWord")}</TableHead>
                  {isManager && <TableHead className="w-24">{t("stk.varianceCol")}</TableHead>}
                  {isManager && (
                    <TableHead className="hidden md:table-cell">{t("stk.countedByCol")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((l) => {
                  const countedValue = l.counted === null ? null : Number(l.counted);
                  const diff = countedValue === null ? null : countedValue - Number(l.expected);
                  return (
                    <TableRow key={l.product_id}>
                      <TableCell className="pl-4 font-medium">
                        <span className="block max-w-[22rem] truncate">
                          {nameById[l.product_id] ?? "…"}
                        </span>
                      </TableCell>
                      {isManager && (
                        <TableCell className="tabular text-muted-foreground">
                          {Number(l.expected)}
                        </TableCell>
                      )}
                      <TableCell>
                        {open ? (
                          <Input
                            key={`${l.product_id}-${l.counted}`}
                            className="tabular h-8 w-24 text-right"
                            inputMode="decimal"
                            defaultValue={l.counted ?? ""}
                            placeholder={t("stk.countPh")}
                            onBlur={(e) =>
                              e.target.value !== String(l.counted ?? "") &&
                              save(l.product_id, e.target.value)
                            }
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
                      {isManager && (
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
                      {isManager && (
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
    </>
  );
}
