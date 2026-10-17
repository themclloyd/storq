import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useProducts } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackLink, Empty, PageHeader, Pager, Status, fmtDate } from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { pageSlice } from "@/lib/paging";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/stocktake")({
  head: () => ({
    meta: [
      { title: "Stock take — Storq" },
      { name: "description", content: "Count and reconcile store inventory with your staff." },
      { property: "og:title", content: "Stock take — Storq" },
      {
        property: "og:description",
        content: "Count and reconcile store inventory with your staff.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StockTake,
});

type Take = { id: string; status: string; created_at: string; closed_at: string | null };
type LineRow = { product_id: string; expected: number; counted: number | null };

function StockTake() {
  const { store, can, rpc } = usePos();
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const qc = useQueryClient();
  const takes = useQuery({
    queryKey: ["takes", store?.id],
    enabled: !!store,
    // Take list changes only on start/close, which invalidate ["takes"];
    // live per-line counts are polled separately on the active take.
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_takes")
        .select("id,status,created_at,closed_at")
        .eq("store_id", store!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as Take[];
    },
  });
  const open = takes.data?.find((tk) => tk.status === "open");
  const closed = (takes.data ?? []).filter((tk) => tk.status === "closed");
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(closed, page);

  async function start() {
    try {
      await rpc("start_stock_take", { p_store: store!.id });
      toast.success(t("stk.started"));
      invalidateKeys(qc, [["takes"], ["take-lines"]]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <BackLink to="/app/inventory" label={t("nav.items")} />
      <PageHeader
        breadcrumb={`${t("nav.inventory")} / ${t("nav.stocktakes")}`}
        title={t("stk.title")}
        sub={
          open
            ? t("stk.subCounting", { store: store?.name ?? "", date: fmtDate(open.created_at) })
            : t("stk.subIdle", { store: store?.name ?? "" })
        }
        actions={
          !open && can("admin", "manager") ? (
            <Button onClick={start}>{t("stk.start")}</Button>
          ) : undefined
        }
      />
      {open ? (
        <Counting take={open} />
      ) : (
        <>
          {!can("admin", "manager") && <Empty>{t("stk.noneOpen")}</Empty>}
          <div className="pos-card mt-4 divide-y text-[13px]">
            {pageRows.map((tk) => (
              <div key={tk.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <Status s={tk.status} />
                <span>
                  {t("stk.startedWord")} {fmtDate(tk.created_at)}
                </span>
                <span className="text-muted-foreground">
                  {t("stk.closedWord")} {tk.closed_at && fmtDate(tk.closed_at)}
                </span>
              </div>
            ))}
            {closed.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">{t("stk.noPast")}</p>
            )}
          </div>
          <Pager page={curPage} pageCount={pageCount} total={closed.length} onPage={setPage} />
        </>
      )}
    </>
  );
}

function Counting({ take }: { take: Take }) {
  const { can, rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const products = useProducts();
  const [q, setQ] = useState("");
  const [onlyLeft, setOnlyLeft] = useState(false);
  const lines = useQuery({
    queryKey: ["take-lines", take.id],
    refetchInterval: 15_000, // live team count; paused automatically when the tab is hidden
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_take_lines")
        .select("product_id,expected,counted")
        .eq("stock_take_id", take.id);
      if (error) throw error;
      return data as LineRow[];
    },
  });
  // Build an id→name map once instead of a linear .find() on every filter/sort
  // pass; memoize rows on a deferred term so typing over a large take stays smooth.
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of products.data ?? []) m[p.id] = p.name;
    return m;
  }, [products.data]);
  const name = (id: string) => names[id] ?? "…";
  const dq = useDebouncedValue(q);
  const rows = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    return (lines.data ?? [])
      .filter(
        (l) =>
          (!onlyLeft || l.counted === null) &&
          (!needle || (names[l.product_id] ?? "").toLowerCase().includes(needle)),
      )
      .sort((a, b) => (names[a.product_id] ?? "").localeCompare(names[b.product_id] ?? ""));
  }, [lines.data, onlyLeft, dq, names]);
  const counted = lines.data?.filter((l) => l.counted !== null).length ?? 0;

  async function save(pid: string, v: string) {
    if (v === "") return;
    try {
      await rpc("count_stock", { p_take: take.id, p_product: pid, p_counted: Number(v) });
      qc.invalidateQueries({ queryKey: ["take-lines", take.id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function close() {
    if (!confirm(t("stk.closeConfirm"))) return;
    try {
      await rpc("close_stock_take", { p_take: take.id });
      toast.success(t("stk.levelsUpdated"));
      invalidateKeys(qc, [["takes"], ["take-lines"], ["stock"], ["movements"], ["dash-alerts"]]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-56 bg-card"
          placeholder={t("stk.findItem")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button
          size="sm"
          variant={onlyLeft ? "default" : "outline"}
          onClick={() => setOnlyLeft(!onlyLeft)}
        >
          {t("stk.notCounted")}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {t("stk.countedStat", { counted, total: lines.data?.length ?? 0 })}
        </span>
        {can("admin", "manager") && (
          <Button size="sm" variant="success" className="ml-auto" onClick={close}>
            {t("stk.finish")}
          </Button>
        )}
      </div>
      <div className="pos-card divide-y">
        {rows.map((l) => {
          const diff = l.counted === null ? null : Number(l.counted) - Number(l.expected);
          return (
            <div key={l.product_id} className="flex items-center gap-3 px-4 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-semibold">{name(l.product_id)}</span>
              {can("admin", "manager") && (
                <span className="tabular w-20 shrink-0 text-right text-muted-foreground">
                  {t("stk.systemWord")} {Number(l.expected)}
                </span>
              )}
              <Input
                key={`${l.product_id}-${l.counted}`}
                className="tabular h-8 w-20 shrink-0 text-right"
                inputMode="decimal"
                defaultValue={l.counted ?? ""}
                placeholder={t("stk.countPh")}
                onBlur={(e) =>
                  e.target.value !== String(l.counted ?? "") && save(l.product_id, e.target.value)
                }
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {can("admin", "manager") && (
                <span
                  className={cn(
                    "tabular w-12 shrink-0 text-right font-medium",
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
                </span>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">{t("stk.nothing")}</p>
        )}
      </div>
    </>
  );
}
