import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BanknoteIcon,
  CreditCardIcon,
  Delete02Icon,
  FilterIcon,
  MoneyBag02Icon,
  PlusSignIcon,
  ReceiptIcon,
  SmartPhone01Icon,
  Wallet01Icon,
} from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { downloadCsv, downloadPdf, fileStamp } from "@/lib/pdf";
import { useStaffNames } from "@/lib/sales";
import { expenseCategories, rangeDays, sinceFor, useExpenses, type Expense } from "@/lib/expenses";
import { localDateKey } from "@/lib/trend";
import { pageSlice } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOnce } from "@/hooks/use-once";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DashIcon } from "@/components/dashboard";
import { ExportMenu } from "@/components/pos/ExportMenu";
import { Field, NativeSelect, NoAccess, PageHeader, Pager } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses | Storq" },
      { name: "description", content: "Record and review business expenses." },
      { property: "og:title", content: "Expenses | Storq" },
      { property: "og:description", content: "Record and review business expenses." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Expenses,
});

const today = () => localDateKey(new Date());

// Expense source is a stored code; only its display label is localized. Category names are
// business data (stored per tenant) and stay untranslated.
const SOURCE_KEYS: Record<Expense["source"], string> = {
  till: "exp.srcTill",
  bank: "exp.srcBank",
  mobile: "exp.srcMobile",
};
const SOURCE_CODES = Object.keys(SOURCE_KEYS) as Expense["source"][];
const SOURCE_ICONS: Record<Expense["source"], DashIcon> = {
  till: Wallet01Icon,
  bank: CreditCardIcon,
  mobile: SmartPhone01Icon,
};
// Soft tints only, matching the status badges. Till cash is the one source that moves the
// drawer, so it gets the brand tint; bank and mobile stay neutral to avoid reading as status.
const SOURCE_TONE: Record<Expense["source"], string> = {
  till: "bg-primary-soft text-primary-soft-foreground",
  bank: "bg-secondary text-secondary-foreground",
  mobile: "bg-secondary text-secondary-foreground",
};
const RANGE_KEYS: Record<keyof typeof rangeDays, string> = {
  today: "sales.rangeToday",
  "7 days": "sales.range7d",
  "30 days": "sales.range30d",
  "90 days": "exp.range90d",
};

// `spent_on` is a bare date column: read it as a local calendar day, never as UTC.
const fmtDay = (d: string) =>
  new Date(`${localDateKey(d)}T00:00:00`).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function Expenses() {
  const { can } = usePos();
  // Tills record what they spend; money access reads the whole ledger.
  if (!can("sell", "money", "view_money")) return <NoAccess />;
  return <ExpensesContent />;
}

function ExpensesContent() {
  const { store, rpc, money, can, business } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const srcLabel = (s: Expense["source"]) => t(SOURCE_KEYS[s]);
  const canDelete = can("money");
  // Recording is the tills' job; a view-only money grant reads the ledger only.
  const canRecord = can("sell") || can("money");
  const [range, setRange] = useState<keyof typeof rangeDays>("7 days");
  const [source, setSource] = useState<"all" | Expense["source"]>("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const [recording, setRecording] = useState(false);
  const since = sinceFor(range);
  const rangeLabel = t(RANGE_KEYS[range]);
  const list = useExpenses({ storeId: store?.id, since });
  const names = useStaffNames();
  const rows = useMemo(() => list.data ?? [], [list.data]);

  // Filtering the cached period in memory keeps totals, chart and table on the same rows.
  const filtered = useMemo(
    () =>
      rows.filter(
        (e) =>
          (source === "all" || e.source === source) &&
          (category === "all" || e.category === category),
      ),
    [rows, source, category],
  );
  const total = filtered.reduce((a, e) => a + Number(e.amount), 0);
  const till = filtered
    .filter((e) => e.source === "till")
    .reduce((a, e) => a + Number(e.amount), 0);
  const other = total - till;
  const byCategory = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const e of filtered) acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount);
    return Object.entries(acc)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);
  const top = byCategory[0];
  const activeFilters = (source === "all" ? 0 : 1) + (category === "all" ? 0 : 1);
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(filtered, page);
  const entryLabel =
    filtered.length === 1 ? t("exp.oneEntry") : t("exp.entriesCount", { count: filtered.length });
  const share = total > 0 ? Math.round((till / total) * 100) : 0;

  function clearFilters() {
    setSource("all");
    setCategory("all");
    setPage(0);
  }

  async function remove(id: string) {
    if (!confirm(t("exp.deleteConfirm"))) return;
    try {
      await rpc("delete_expense", { p_id: id });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  // Exports follow the filters on screen, so a download always matches the table above it.
  function exportCsv() {
    downloadCsv(`storq-expenses-${fileStamp()}.csv`, [
      ["date", "category", "source", "amount", "note", "recorded_by"],
      ...filtered.map((e) => [
        e.spent_on,
        e.category,
        e.source,
        e.amount,
        e.note ?? "",
        names.data?.[e.created_by ?? ""] ?? "",
      ]),
    ]);
  }
  function exportPdf() {
    void downloadPdf({
      filename: `storq-expenses-${fileStamp()}`,
      title: t("exp.reportTitle"),
      business: business?.name,
      subtitle: `${store?.name ?? ""} · ${rangeLabel}`,
      kpis: [
        [t("exp.totalSpent"), money(total)],
        [t("exp.paidFromTill"), money(till)],
        [t("exp.entries"), String(filtered.length)],
      ],
      sections: [
        {
          type: "pairs",
          heading: t("exp.byCategory"),
          rows: byCategory.map((c): [string, string] => [c.name, money(c.value)]),
        },
        {
          type: "table",
          heading: t("exp.allExpenses"),
          head: [
            t("doc.date"),
            t("exp.category"),
            t("exp.paidFrom"),
            t("exp.note"),
            t("exp.byCol"),
            t("doc.amount"),
          ],
          align: ["left", "left", "left", "left", "left", "right"],
          body: filtered.map((e) => [
            e.spent_on,
            e.category,
            srcLabel(e.source),
            e.note ?? "",
            names.data?.[e.created_by ?? ""] ?? "",
            money(e.amount),
          ]),
          foot: [t("common.total"), "", "", "", "", money(total)],
        },
      ],
    });
  }

  // Collapse overlapping and rapid-repeat export clicks so a session cannot
  // pile up jsPDF builds (CPU DoS, blob leaks, browser download throttling).
  const { run: runExport, running: exporting } = useOnce((kind: "csv" | "pdf") => {
    if (kind === "csv") exportCsv();
    else exportPdf();
  });

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.finance")} / ${t("nav.expenses")}`}
        title={t("exp.title")}
        sub={store?.name ?? ""}
        actions={
          <>
            <SegmentedControl
              aria-label={t("exp.title")}
              size="sm"
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(0);
              }}
              options={(Object.keys(rangeDays) as (keyof typeof rangeDays)[]).map((r) => ({
                value: r,
                label: t(RANGE_KEYS[r]),
              }))}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 bg-card">
                  <HugeiconsIcon icon={FilterIcon} /> {t("common.filter")}
                  {activeFilters > 0 && (
                    <Badge variant="secondary" className="ml-0.5 rounded-full px-1.5">
                      {activeFilters}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{t("exp.paidFrom")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={source}
                  onValueChange={(v) => {
                    setSource(v as "all" | Expense["source"]);
                    setPage(0);
                  }}
                >
                  <DropdownMenuRadioItem value="all">{t("exp.allSources")}</DropdownMenuRadioItem>
                  {SOURCE_CODES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {srcLabel(s)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("exp.category")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-64 w-52 overflow-y-auto">
                    <DropdownMenuRadioGroup
                      value={category}
                      onValueChange={(v) => {
                        setCategory(v);
                        setPage(0);
                      }}
                    >
                      <DropdownMenuRadioItem value="all">
                        {t("exp.allCategories")}
                      </DropdownMenuRadioItem>
                      {expenseCategories.map((c) => (
                        <DropdownMenuRadioItem key={c} value={c}>
                          {c}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {activeFilters > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={clearFilters}>
                      {t("exp.clearFilters")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <ExportMenu disabled={exporting} onExport={(kind) => void runExport(kind)} />
            {canRecord && (
              <Button onClick={() => setRecording(true)} disabled={!store}>
                <HugeiconsIcon icon={PlusSignIcon} /> {t("exp.recordExpense")}
              </Button>
            )}
          </>
        }
      />
      <SummaryStrip
        cells={[
          {
            label: t("exp.totalSpent"),
            value: money(total),
            sub: entryLabel,
            icon: BanknoteIcon,
          },
          {
            label: t("exp.paidFromTill"),
            value: money(till),
            sub: t("exp.shareOfSpending", { pct: share }),
            icon: Wallet01Icon,
          },
          {
            label: t("exp.otherSources"),
            value: money(other),
            sub: t("exp.bankAndMobile"),
            icon: CreditCardIcon,
          },
          {
            label: t("exp.biggestCategory"),
            value: money(top?.value ?? 0),
            sub: top?.name ?? t("common.none"),
            icon: MoneyBag02Icon,
          },
        ]}
      />
      {list.isPending ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t("common.loading")}</Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
              <HugeiconsIcon icon={ReceiptIcon} />
            </span>
            <div>
              <p className="font-display text-lg">
                {activeFilters > 0 ? t("exp.emptyFilteredTitle") : t("exp.emptyTitle")}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                {activeFilters > 0 ? t("exp.emptyFilteredBody") : t("exp.emptyBody")}
              </p>
            </div>
            {activeFilters > 0 ? (
              <Button variant="outline" onClick={clearFilters}>
                {t("exp.clearFilters")}
              </Button>
            ) : (
              canRecord && (
                <Button onClick={() => setRecording(true)} disabled={!store}>
                  <HugeiconsIcon icon={PlusSignIcon} /> {t("exp.recordExpense")}
                </Button>
              )
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
              <h2 className="font-display text-sm font-medium">{t("exp.allExpenses")}</h2>
              <p className="text-xs text-muted-foreground">
                {entryLabel} ·{" "}
                <span className="tabular font-semibold text-foreground">{money(total)}</span>
              </p>
            </div>
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("doc.date")}</TableHead>
                  <TableHead>{t("exp.category")}</TableHead>
                  <TableHead>{t("exp.paidFrom")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("exp.note")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("exp.byCol")}</TableHead>
                  <TableHead>{t("doc.amount")}</TableHead>
                  {canDelete && (
                    <TableHead className="w-10 pr-4">
                      <span className="sr-only">{t("common.actions")}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDay(e.spent_on)}
                    </TableCell>
                    <TableCell className="font-medium">{e.category}</TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "gap-1 border-transparent px-2.5 py-0.5 font-medium",
                          SOURCE_TONE[e.source],
                        )}
                      >
                        <HugeiconsIcon icon={SOURCE_ICONS[e.source]} className="size-3.5" />
                        {srcLabel(e.source)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="block max-w-[18rem] truncate text-muted-foreground">
                        {e.note ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="block max-w-[12rem] truncate text-muted-foreground">
                        {names.data?.[e.created_by ?? ""] ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="tabular font-semibold whitespace-nowrap">
                      {money(e.amount)}
                    </TableCell>
                    {canDelete && (
                      <TableCell className="w-10 pr-4">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          aria-label={t("exp.deleteAria")}
                          onClick={() => void remove(e.id)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager page={curPage} pageCount={pageCount} total={filtered.length} onPage={setPage} />
        </>
      )}
      {recording && <RecordDialog onClose={() => setRecording(false)} />}
    </>
  );
}

/** One card, four numbers: the whole period at a glance instead of a wall of tiles. */
function SummaryStrip({
  cells,
}: {
  cells: { label: string; value: string; sub: string; icon: DashIcon }[];
}) {
  return (
    <Card className="mb-4 grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">{c.label}</p>
            <HugeiconsIcon icon={c.icon} className="size-4 shrink-0 text-primary" />
          </div>
          <p className="font-display tabular mt-1 truncate text-xl sm:text-2xl">{c.value}</p>
          <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
        </div>
      ))}
    </Card>
  );
}

/** Amount, category, source, date and note in one sheet instead of a permanent side form. */
function RecordDialog({ onClose }: { onClose: () => void }) {
  const { store, rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const srcLabel = (s: Expense["source"]) => t(SOURCE_KEYS[s]);
  const [f, setF] = useState({
    amount: "",
    category: expenseCategories[0]!,
    source: "till" as Expense["source"],
    note: "",
    date: today(),
  });
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    setBusy(true);
    try {
      await rpc("record_expense", {
        p_store: store.id,
        p_amount: Number(f.amount),
        p_category: f.category,
        p_source: f.source,
        p_note: f.note.trim() || null,
        p_date: f.date,
      });
      toast.success(t("exp.recorded"));
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{t("exp.recordExpense")}</DialogTitle>
          <DialogDescription>{store?.name ?? ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Field label={t("doc.amount")}>
            <Input
              required
              autoFocus
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              className="tabular h-12 text-2xl font-semibold md:text-2xl"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("exp.category")}>
              <NativeSelect
                value={f.category}
                onChange={(v) => setF({ ...f, category: v })}
                options={expenseCategories.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label={t("doc.date")}>
              <Input
                type="date"
                max={today()}
                value={f.date}
                onChange={(e) => setF({ ...f, date: e.target.value })}
              />
            </Field>
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("exp.paidFrom")}
            </span>
            <div
              role="group"
              aria-label={t("exp.paidFrom")}
              className="grid grid-cols-3 gap-0.5 rounded-xl bg-muted p-1"
            >
              {SOURCE_CODES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={f.source === s}
                  onClick={() => setF({ ...f, source: s })}
                  className={cn(
                    "flex min-h-9 items-center justify-center rounded-lg px-2 py-1.5 text-xs font-medium leading-tight transition-colors duration-150 ease-out",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
                    f.source === s
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {srcLabel(s)}
                </button>
              ))}
            </div>
          </div>
          <Field label={t("exp.noteOptional")}>
            <Input
              maxLength={500}
              value={f.note}
              placeholder={t("exp.notePlaceholder")}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("exp.saveExpense")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
