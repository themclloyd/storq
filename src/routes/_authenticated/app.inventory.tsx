import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/sales";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download01Icon,
  FileExportIcon,
  FileImportIcon,
  FilterIcon,
  MoreHorizontalIcon,
  NoteEditIcon,
  PackageIcon,
  Pdf01Icon,
  PlusSignIcon,
  QrCode01Icon,
  Search01Icon,
  Settings01Icon,
} from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useProducts, useStock, type Product } from "@/lib/products";
import { normalizeCode } from "@/lib/item-codes";
import { useLowStock } from "@/lib/transfers";
import {
  LIMITS,
  csvFileIssue,
  firstError,
  optionalText,
  parseAmountCell,
  payloadKind,
  sanitizeText,
  validateAmount,
  validateCsvFile,
} from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, Pager, Stat, StatRow } from "@/components/pos/bits";
import { RowsSkeleton, TableSkeleton } from "@/components/pos/skeletons";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { ItemQrDialog } from "@/components/pos/ItemQr";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useCollections } from "@/lib/collections";
import { pageSlice } from "@/lib/paging";
import {
  parseView,
  sameSearch,
  viewOnly,
  viewSearch,
  type InventorySort,
  type InventoryView,
} from "@/lib/inventory-view";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useOnce } from "@/hooks/use-once";
import { visibleWorkspacePages } from "@/lib/workspace-navigation";
import {
  downloadCsv,
  downloadLabelSheet,
  downloadPdf,
  fileStamp,
  parseCsv,
  readCsvText,
} from "@/lib/pdf";
import { t as tt, useI18n } from "@/lib/i18n";
import { useScannerWedge } from "@/components/pos/use-scanner";
import { pageIcons } from "@/components/pos/nav-icons";

export const Route = createFileRoute("/_authenticated/app/inventory")({
  // The view lives in the URL as well as in state: an item page opened from this
  // table can hand it back, so Save returns to the same filter and the same page
  // instead of the top of the catalogue. Only the keys that narrow the list are
  // kept, or the router would rewrite every default into the address bar.
  validateSearch: (search: Record<string, unknown>): Partial<InventoryView> => viewOnly(search),
  head: () => ({
    meta: [
      { title: "Inventory | Storq" },
      { name: "description", content: "Manage Storq items, buying costs and store stock." },
      { property: "og:title", content: "Inventory | Storq" },
      { property: "og:description", content: "Manage Storq items, buying costs and store stock." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Inventory,
});

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// Pastel thumbnail tiles picked by hashing the item name (spec §4). Static
// class literals so the Tailwind scanner keeps them in the build.
const TILE_CLASS = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5", "bg-tile-6"];
const tileFor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TILE_CLASS[h % TILE_CLASS.length]!;
};
const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

/** Rows one bulk edit carries through the URL: a shelf, not a catalogue. */
const BULK_LIMIT = 100;

function Inventory() {
  const { store, money, can, business, staff } = usePos();
  const { t } = useI18n();
  const nav = useNavigate();
  // The shell hides its tab row here (`menuNavigationPages`), so this menu is
  // the switcher between this page and Transfers / Collections / Stock takes.
  const siblingPages = staff
    ? visibleWorkspacePages(staff, store?.store_type).filter(
        (p) => p.group === "inventory" && p.to !== "/app/inventory",
      )
    : [];
  const [imp, setImp] = useState<ImportRow[] | null>(null);
  const products = useProducts(store?.id, { withCost: true });
  const stock = useStock(store?.id);
  const cols = useCollections();
  const colName = useCallback(
    (pid: string) =>
      (cols.data?.byProduct[pid] ?? [])
        .map((id) => cols.data?.list.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join(", "),
    [cols.data],
  );
  const [adj, setAdj] = useState<Product | null>(null);
  // Code / QR: one item at a time, and the multi-select for a label sheet.
  const [qr, setQr] = useState<Product | null>(null);
  const [sheet, setSheet] = useState<Product[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  // Seeded from the URL once on mount; typing in the search box must not rewrite
  // the route on every keystroke. The mirror below keeps the address bar honest
  // afterwards, which is what makes Back land on the filtered page.
  const opened = Route.useSearch();
  // The route holds the URL's own spelling, where `?page=2` is the second page,
  // while the table works in zero-based indexes. Parsing once here is what stops
  // the address bar from counting a page the person never turned.
  const start = useMemo(() => parseView(opened as Record<string, unknown>), [opened]);
  const [q, setQ] = useState(start.q);
  const [lowOnly, setLowOnly] = useState(start.low);
  const [colFilter, setColFilter] = useState(start.col);
  const [sort, setSort] = useState<InventorySort>(start.sort);
  const [page, setPage] = useState(start.page);
  const fileRef = useRef<HTMLInputElement>(null);
  const low = useLowStock(store?.id);
  // Reading the catalog and changing it are separate grants: a viewer gets the
  // list, the codes and the exports, but no import, new-item or stock writes.
  const canEdit = can("stock");
  // A hardware scanner on the inventory page jumps to the matching item in the
  // table (by setting the search field), or opens the add page for a code the
  // catalog does not know yet, the same shortcuts as the till, without a sale.
  useScannerWedge(
    (code) => {
      // No dialogs open, only intercept when the page is idle.
      if (adj || qr || sheet || imp) return false;
      const hit = (products.data ?? []).find(
        (p) => normalizeCode(p.sku).toLowerCase() === normalizeCode(code).toLowerCase(),
      );
      if (hit) {
        setQ(normalizeCode(hit.sku));
        setPage(0);
        return true;
      }
      // Unknown code → the add page, its first row already carrying the scan.
      nav({ to: "/app/inventory/new", search: { ...back, code: normalizeCode(code) } });
      return true;
    },
    { enabled: canEdit && !adj && !qr && !sheet && !imp },
  );
  // The filter, sort and stock-value total scan the whole cached catalog, so
  // memoize them (unrelated re-renders no longer re-scan every product) and
  // debounce the search term so a large store filters once typing pauses. These
  // derive from hooks, so they stay above the role guard to keep hook order
  // unconditional.
  const dq = useDebouncedValue(q);
  // What the table is showing, as search params. Every item page receives this
  // and hands it back, and the debounced term is used so the link never promises
  // a filter the table has not drawn yet.
  const view = useMemo<InventoryView>(
    () => ({ q: dq, low: lowOnly, col: colFilter, sort, page }),
    [dq, lowOnly, colFilter, sort, page],
  );
  const back = useMemo(() => viewSearch(view), [view]);
  // State → URL, one way. The equality check is what keeps this from re-entering
  // the route for its own write.
  useEffect(() => {
    const next = viewSearch(view);
    if (sameSearch(next, viewOnly(opened))) return;
    void nav({ to: "/app/inventory", search: next, replace: true });
  }, [view, opened, nav]);
  const rows = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const lowIds = new Set((low.data ?? []).map((r) => r.product_id));
    const s = stock.data ?? {};
    const list = (products.data ?? []).filter((p) => {
      const hay =
        p.name.toLowerCase().includes(needle) ||
        normalizeCode(p.sku).toLowerCase().includes(needle) ||
        colName(p.id).toLowerCase().includes(needle);
      if (needle && !hay) return false;
      if (lowOnly && !lowIds.has(p.id)) return false;
      if (colFilter !== "all" && !(cols.data?.byProduct[p.id] ?? []).includes(colFilter))
        return false;
      return true;
    });
    list.sort((a, b) => {
      if (sort === "price") return Number(b.price) - Number(a.price);
      if (sort === "stock") return (s[a.id] ?? 0) - (s[b.id] ?? 0);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [products.data, low.data, cols.data, stock.data, lowOnly, colFilter, sort, dq, colName]);
  const units = useMemo(
    () => (products.data ?? []).reduce((a, p) => a + (stock.data?.[p.id] ?? 0), 0),
    [products.data, stock.data],
  );
  const value = useMemo(
    () => rows.reduce((a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.cost), 0),
    [rows, stock.data],
  );
  const lowCount = low.data?.length ?? 0;
  const pickedRows = useMemo(
    () => (products.data ?? []).filter((p) => picked[p.id]),
    [products.data, picked],
  );
  // Labels need a code on every line; blanks (legacy rows before the SQL
  // backfill) are reported instead of printing a half-empty sheet.
  const labelReady = (list: Product[]) => list.filter((p) => normalizeCode(p.sku));
  async function printLabels(list: Product[], copies: number) {
    const items = labelReady(list);
    if (!items.length) {
      toast.error(t("code.noCodeYet"));
      return;
    }
    if (items.length < list.length)
      toast.info(t("code.skipped", { count: list.length - items.length }));
    try {
      await downloadLabelSheet({
        business: business?.name,
        storeName: store?.name,
        labels: items.map((p) => ({
          name: p.name,
          code: normalizeCode(p.sku),
          price: money(p.price),
          copies,
        })),
      });
      toast.success(t("code.sheetReady", { count: items.length * copies }));
    } catch {
      toast.error(t("code.renderFailed"));
    }
  }
  // CSV rows and the printable PDF report come out of the same actions menu as
  // the CSV import, so the toolbar is one icon button plus New item.
  function exportInventory(kind: "csv" | "pdf") {
    const all = products.data ?? [];
    if (kind === "csv") {
      downloadCsv(`storq-inventory-${fileStamp()}.csv`, [
        ["name", "sku", "cost", "price", "quantity", "collections", "active"],
        ...all.map((p) => [
          p.name,
          p.sku ?? "",
          p.cost,
          p.price,
          stock.data?.[p.id] ?? 0,
          colName(p.id),
          p.active ? "yes" : "no",
        ]),
      ]);
      return;
    }
    const u = all.reduce((a, p) => a + (stock.data?.[p.id] ?? 0), 0);
    const retail = all.reduce((a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.price), 0);
    const atCost = all.reduce((a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.cost), 0);
    return downloadPdf({
      filename: `storq-inventory-${fileStamp()}`,
      title: t("inv.reportTitle"),
      business: business?.name,
      subtitle: `${store?.name ?? ""} · ${t("inv.reportSubtitle")}`,
      badge: t("inv.reportBadge"),
      kpis: [
        [t("inv.kpiItems"), String(all.length)],
        [t("inv.kpiUnits"), String(u)],
        [t("inv.kpiValueCost"), money(atCost)],
        [t("inv.kpiValueRetail"), money(retail)],
      ],
      orientation: "landscape",
      sections: [
        {
          type: "table",
          head: [
            t("doc.item"),
            "SKU",
            t("inv.thCollections"),
            t("inv.cost"),
            t("inv.price"),
            t("inv.inStock"),
            t("inv.thStockValue"),
          ],
          align: ["left", "left", "left", "right", "right", "right", "right"],
          body: all.map((p) => {
            const qty = stock.data?.[p.id] ?? 0;
            return [
              p.name + (p.active ? "" : t("inv.hiddenSuffix")),
              p.sku ?? "",
              colName(p.id),
              money(p.cost),
              money(p.price),
              qty,
              money(qty * Number(p.cost)),
            ];
          }),
          foot: [t("common.total"), "", "", "", "", u, money(atCost)],
        },
      ],
    });
  }
  // Collapse overlapping and rapid-repeat export clicks so a session cannot
  // pile up jsPDF builds (CPU DoS, blob leaks, browser download throttling).
  const { run: runExport, running: exporting } = useOnce((kind: "csv" | "pdf") => {
    void exportInventory(kind);
  });
  // Ten rows per page (spec §4). Clamp when filters shrink `rows`.
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(rows, page);
  // Filters that narrow the list (sorting is excluded) drive the trigger badge.
  const activeFilters = (lowOnly ? 1 : 0) + (colFilter !== "all" ? 1 : 0);
  if (!can("stock", "view_stock"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.noAccess")}</Card>
    );

  return (
    <>
      <PageHeader
        title={t("inv.title")}
        actions={
          <>
            {canEdit && (
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  // `accept` only filters the picker: a dragged, renamed or
                  // "All files" upload still arrives here. Check the file itself
                  // (size included) before reading it into memory.
                  const fileErr = validateCsvFile(f);
                  if (fileErr) {
                    toast.error(fileErr);
                    return;
                  }
                  try {
                    const text = await readCsvText(f);
                    // Contents, not just the name: a renamed workbook or a saved
                    // web page must not be parsed as item rows.
                    const shapeErr = csvFileIssue(text);
                    if (shapeErr) {
                      toast.error(shapeErr);
                      return;
                    }
                    setImp(readImport(text, products.data ?? []));
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              />
            )}
            <div className="relative w-full sm:w-56">
              <HugeiconsIcon
                icon={Search01Icon}
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="w-full bg-card pl-9 sm:pl-9"
                placeholder={t("inv.searchPlaceholder")}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 bg-card">
                  <HugeiconsIcon icon={FilterIcon} /> {t("inv.filter")}
                  {activeFilters > 0 && (
                    <Badge variant="secondary" className="ml-0.5 px-1.5">
                      {activeFilters}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuCheckboxItem
                  checked={lowOnly}
                  onCheckedChange={() => {
                    setLowOnly((v) => !v);
                    setPage(0);
                  }}
                >
                  {t("inv.lowStock")}
                  {lowCount > 0 ? ` · ${lowCount}` : ""}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("inv.thCollections")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-64 w-52 overflow-y-auto">
                    <DropdownMenuRadioGroup
                      value={colFilter}
                      onValueChange={(v) => {
                        setColFilter(v);
                        setPage(0);
                      }}
                    >
                      <DropdownMenuRadioItem value="all">
                        {t("inv.allCollections")}
                      </DropdownMenuRadioItem>
                      {(cols.data?.list ?? []).map((c) => (
                        <DropdownMenuRadioItem key={c.id} value={c.id}>
                          {c.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("inv.sort")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-40">
                    <DropdownMenuRadioGroup
                      value={sort}
                      onValueChange={(v) => {
                        setSort(v as "name" | "price" | "stock");
                        setPage(0);
                      }}
                    >
                      <DropdownMenuRadioItem value="name">
                        {t("inv.sortName")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="price">
                        {t("inv.sortPrice")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="stock">
                        {t("inv.sortStock")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("common.actions")}>
                  <HugeiconsIcon icon={MoreHorizontalIcon} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                    <HugeiconsIcon icon={FileImportIcon} className="size-4" />
                    {t("inv.importCsv")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() =>
                    downloadCsv(`storq-inventory-template.csv`, [
                      ["name", "sku", "cost", "price", "quantity", "active"],
                      ["Example Item", "ABC-001", "10.00", "25.00", "50", "yes"],
                    ])
                  }
                >
                  <HugeiconsIcon icon={Download01Icon} className="size-4" />
                  {t("inv.downloadTemplate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={exporting} onSelect={() => void runExport("csv")}>
                  <HugeiconsIcon icon={FileExportIcon} className="size-4" />
                  {t("inv.exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={exporting} onSelect={() => void runExport("pdf")}>
                  <HugeiconsIcon icon={Pdf01Icon} className="size-4" />
                  {t("inv.exportPdf")}
                </DropdownMenuItem>
                {siblingPages.length > 0 && <DropdownMenuSeparator />}
                {siblingPages.map((p) => (
                  <DropdownMenuItem key={p.to} asChild>
                    <Link to={p.to}>
                      <HugeiconsIcon icon={pageIcons[p.to] ?? PackageIcon} className="size-4" />
                      {t(p.labelKey)}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {canEdit && (
              <Button
                size="icon"
                aria-label={t("inv.newItem")}
                onClick={() => nav({ to: "/app/inventory/new", search: back })}
              >
                <HugeiconsIcon icon={PlusSignIcon} />
              </Button>
            )}
          </>
        }
      />
      {pickedRows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              size="sm"
              onClick={() => {
                // The ids travel in the URL, so the grid opens on the same rows
                // after a reload. Past one shelf it is a catalogue job, not a
                // bulk edit, so say so instead of building an enormous link.
                if (pickedRows.length > BULK_LIMIT) {
                  toast.error(t("inv.bulkLimit", { max: BULK_LIMIT }));
                  return;
                }
                nav({
                  to: "/app/inventory/bulk",
                  search: { ...back, ids: pickedRows.map((p) => p.id).join(",") },
                });
              }}
            >
              <HugeiconsIcon icon={NoteEditIcon} /> {t("inv.editSelected")} · {pickedRows.length}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setSheet(pickedRows)}>
            <HugeiconsIcon icon={QrCode01Icon} /> {t("code.printLabelSheet")} · {pickedRows.length}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setPicked({})}
          >
            {t("code.clearSelection")}
          </Button>
        </div>
      )}
      <StatRow className="mb-4 sm:grid-cols-3">
        <Stat
          label={t("inv.totalItems")}
          value={rows.length}
          loading={products.isPending}
          hint={
            <>
              {t("inv.stockValueHint")}{" "}
              <span className="tabular font-semibold text-secondary-foreground">
                {money(value)}
              </span>
            </>
          }
        />
        <Stat label={t("inv.unitsInStock")} value={units} loading={products.isPending} />
        {/* The low-stock figure is also the filter: a real button, so a tap and
            a keyboard press do the same thing. */}
        <button
          type="button"
          aria-pressed={lowOnly}
          onClick={() => {
            setLowOnly((v) => !v);
            setPage(0);
          }}
          className={cn(
            "rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-primary/30 focus-visible:outline-none",
            lowOnly && "ring-2 ring-primary/30",
          )}
        >
          <div className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {t("inv.lowStock")}
          </div>
          <div className="tabular mt-1 text-2xl leading-tight font-extrabold text-destructive">
            {products.isPending ? <Skeleton className="h-7 w-12" aria-hidden /> : lowCount}
          </div>
        </button>
      </StatRow>
      {products.isPending ? (
        <TableSkeleton rows={6} columns={canEdit ? 6 : 5} />
      ) : rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
              <HugeiconsIcon icon={PackageIcon} />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">
              {q || lowOnly || colFilter !== "all" ? t("common.none") : t("inv.noItemsYet")}
            </p>
            {canEdit && (
              <Button onClick={() => nav({ to: "/app/inventory/new", search: back })}>
                <HugeiconsIcon icon={PlusSignIcon} /> {t("inv.newItem")}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-8 pr-0">
                      <Checkbox
                        aria-label={t("code.selectAll")}
                        checked={pageRows.every((p) => picked[p.id])}
                        onCheckedChange={(v) =>
                          setPicked((s) => {
                            const next = { ...s };
                            for (const p of pageRows) next[p.id] = v === true;
                            return next;
                          })
                        }
                      />
                    </TableHead>
                  )}
                  <TableHead className="pl-4">{t("doc.item")}</TableHead>
                  <TableHead>{t("inv.codeColumn")}</TableHead>
                  <TableHead>{t("inv.price")}</TableHead>
                  <TableHead>{t("inv.inStock")}</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((p) => {
                  const s = stock.data?.[p.id] ?? 0;
                  const threshold = p.reorder_point ?? 5;
                  // The KPI above counts an empty shelf as low stock, so the row
                  // has to say so too: "Out" for zero, "Low" up to the point.
                  const out = s <= 0;
                  const isLow = !out && s <= threshold;
                  const costAbove = Number(p.cost) > Number(p.price);
                  return (
                    <TableRow key={p.id} className={cn(!p.active && "opacity-[0.45]")}>
                      {canEdit && (
                        <TableCell className="w-8 pr-0">
                          <Checkbox
                            aria-label={t("code.selectItem", { name: p.name })}
                            checked={!!picked[p.id]}
                            onCheckedChange={(v) =>
                              setPicked((s) => ({ ...s, [p.id]: v === true }))
                            }
                          />
                        </TableCell>
                      )}
                      <TableCell className="py-3 pl-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "font-display grid size-9 shrink-0 place-items-center rounded-lg text-sm text-tile-foreground",
                              tileFor(p.name),
                            )}
                          >
                            {initialsOf(p.name)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{p.name}</span>
                              {!p.active && <Badge variant="secondary">{t("inv.inactive")}</Badge>}
                            </div>
                            {costAbove && (
                              <Badge variant="warning" className="mt-1">
                                {t("inv.costAbovePrice")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground">
                        {normalizeCode(p.sku) || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="tabular font-medium">
                        <div>{money(p.price)}</div>
                        <div className="text-[11px] font-normal text-muted-foreground">
                          {t("inv.cost")} {money(p.cost)}
                        </div>
                      </TableCell>
                      <TableCell className="tabular py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn(out && "text-destructive")}>{s}</span>
                          {out ? (
                            <Badge variant="destructive">{t("inv.outBadge")}</Badge>
                          ) : isLow ? (
                            <Badge variant="warning">{t("inv.lowBadge")}</Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={t("common.actions")}>
                              <HugeiconsIcon icon={MoreHorizontalIcon} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuLabel className="space-y-1 font-normal">
                              <span className="flex items-baseline justify-between gap-3 text-xs">
                                <span className="text-muted-foreground">{t("inv.cost")}</span>
                                <span className="tabular font-medium text-foreground">
                                  {money(p.cost)}
                                </span>
                              </span>
                              <span className="flex items-baseline justify-between gap-3 text-xs">
                                <span className="text-muted-foreground">
                                  {t("inv.thCollections")}
                                </span>
                                <span className="max-w-36 truncate font-medium text-foreground">
                                  {colName(p.id) || t("common.none")}
                                </span>
                              </span>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setQr(p)}>
                              <HugeiconsIcon icon={QrCode01Icon} className="size-4" />
                              {t("code.showTitle")}
                            </DropdownMenuItem>
                            {canEdit && (
                              <>
                                <DropdownMenuItem onSelect={() => setAdj(p)}>
                                  <HugeiconsIcon icon={PackageIcon} className="size-4" />
                                  {t("inv.btnStock")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    nav({
                                      to: "/app/inventory/$id",
                                      params: { id: p.id },
                                      search: back,
                                    })
                                  }
                                >
                                  <HugeiconsIcon icon={Settings01Icon} className="size-4" />
                                  {t("common.edit")}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
      {adj && <StockDialog p={adj} onClose={() => setAdj(null)} />}
      {qr && (
        <ItemQrDialog
          item={{ name: qr.name, code: normalizeCode(qr.sku), price: money(qr.price) }}
          onClose={() => setQr(null)}
          onPrintLabels={(copies) => printLabels([qr], copies)}
        />
      )}
      {sheet && (
        <LabelSheetDialog
          rows={sheet}
          onClose={() => setSheet(null)}
          onPrint={(copies) => {
            printLabels(sheet, copies);
            setSheet(null);
            setPicked({});
          }}
        />
      )}
      {imp && <ImportDialog rows={imp} onClose={() => setImp(null)} />}
    </>
  );
}

/**
 * Label sheet for a multi-select: copies per item, the lines that will print,
 * and a warning for any row still without a code (they are skipped).
 */
function LabelSheetDialog({
  rows,
  onClose,
  onPrint,
}: {
  rows: Product[];
  onClose: () => void;
  onPrint: (copies: number) => void;
}) {
  const { t } = useI18n();
  const [copies, setCopies] = useState("2");
  const n = Math.min(240, Math.max(1, Math.trunc(Number(copies) || 1)));
  const missing = rows.filter((r) => !normalizeCode(r.sku)).length;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("code.printLabelSheet")}</DialogTitle>
          <DialogDescription>{t("code.sheetDesc", { count: rows.length })}</DialogDescription>
        </DialogHeader>
        <Card className="max-h-56 divide-y overflow-y-auto text-sm">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate">{r.name}</span>
              <span className="tabular shrink-0 text-xs text-muted-foreground">
                {normalizeCode(r.sku) || t("code.noneYet")}
              </span>
            </div>
          ))}
        </Card>
        {missing > 0 && (
          <p className="text-xs text-destructive">{t("code.skipped", { count: missing })}</p>
        )}
        <div className="flex items-end gap-2">
          <Label className="space-y-1">
            <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {t("code.copiesLabel")}
            </span>
            <Input
              className="max-w-24"
              inputMode="numeric"
              maxLength={3}
              value={copies}
              onChange={(e) => setCopies(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </Label>
          <Button className="flex-1" onClick={() => onPrint(n)}>
            <HugeiconsIcon icon={QrCode01Icon} /> {t("code.downloadPdf")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const reasons = {
  in: [
    ["supplier_intake", "reason.p_supplier_intake"],
    ["transfer_in", "reason.p_transfer_in"],
    ["correction", "reason.p_correction"],
  ],
  out: [
    ["damage", "reason.p_damage"],
    ["shrinkage", "reason.p_shrinkage"],
    ["return_to_supplier", "reason.p_return_to_supplier"],
    ["transfer_out", "reason.p_transfer_out"],
    ["correction", "reason.p_correction"],
  ],
} as const;
// Ledger reason codes: a known code renders a localized label via t("reason.<code>"); an unknown
// one falls back to the raw code instead of a broken translation key.
const LEDGER_REASONS = new Set([
  "sale",
  "sale_reversal",
  "refund_restock",
  "stocktake",
  "opening_balance",
  "adjustment",
  "supplier_intake",
  "transfer_in",
  "transfer_out",
  "correction",
  "damage",
  "shrinkage",
  "return_to_supplier",
]);

function StockDialog({ p, onClose }: { p: Product; onClose: () => void }) {
  const { rpc, store } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const names = useStaffNames();
  const stockQ = useStock(store?.id);
  const current = stockQ.data?.[p.id] ?? 0;
  const [n, setN] = useState("");
  const [mode, setMode] = useState<"in" | "out" | "set">("in");
  const [reason, setReason] = useState<string>("supplier_intake");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"adjust" | "history">("adjust");
  const hist = useQuery({
    queryKey: ["movements", store?.id, p.id],
    enabled: tab === "history" && !!store,
    // The ledger is append-only and every stock write invalidates ["movements"]
    // (product save, adjust, stocktake, sale, transfer), so it never goes stale.
    staleTime: 300_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("stock_movements")
        .select("*")
        .eq("store_id", store!.id)
        .eq("product_id", p.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as {
        id: string;
        delta: number;
        balance_after: number;
        reason: string;
        note: string | null;
        staff_id: string | null;
        created_at: string;
      }[];
    },
  });
  async function save() {
    const err = firstError(
      validateAmount(n, {
        label: t("inv.quantity"),
        required: true,
        min: mode === "set" ? 0 : 0.01,
        max: mode === "set" ? 1_200_000 : 1_000_000,
      }),
      optionalText(note, t("inv.noteField"), LIMITS.note),
    );
    if (err) {
      toast.error(err);
      return;
    }
    const noteCell = note ? sanitizeText(note, LIMITS.note) : null;
    try {
      if (mode === "set") {
        // Absolute target for the same reason as the item sheet and the CSV:
        // the server owns the delta, so this screen's `current` can be stale
        // without the balance landing anywhere wrong.
        await rpc("set_stock_qty", {
          p_store: store!.id,
          p_product: p.id,
          p_qty: Number(n),
          p_reason: "correction",
          p_note: noteCell,
        });
      } else {
        await rpc("adjust_stock_reason", {
          p_store: store!.id,
          p_product: p.id,
          p_delta: (mode === "in" ? 1 : -1) * Number(n),
          p_reason: reason,
          p_note: noteCell,
        });
      }
      toast.success(t("inv.stockUpdated"));
      onClose();
      invalidateKeys(qc, [["stock"], ["movements"], ["dash-alerts"]]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {p.name}, {store?.name}
          </DialogTitle>
        </DialogHeader>
        <ToggleGroup
          type="single"
          value={tab}
          onValueChange={(v) => {
            if (v) setTab(v as "adjust" | "history");
          }}
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem value="adjust" className="w-full">
            {t("inv.changeStock")}
          </ToggleGroupItem>
          <ToggleGroupItem value="history" className="w-full">
            {t("inv.historyTab")}
          </ToggleGroupItem>
        </ToggleGroup>
        {tab === "adjust" ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={mode === "in" ? "success" : "outline"}
                onClick={() => {
                  setMode("in");
                  setReason("supplier_intake");
                }}
              >
                {t("inv.addStock")}
              </Button>
              <Button
                variant={mode === "out" ? "destructive" : "outline"}
                onClick={() => {
                  setMode("out");
                  setReason("damage");
                }}
              >
                {t("inv.removeStock")}
              </Button>
              <Button
                variant={mode === "set" ? "secondary" : "outline"}
                onClick={() => {
                  setMode("set");
                  setReason("correction");
                }}
              >
                {t("inv.setCount")}
              </Button>
            </div>
            <Label className="block space-y-1">
              <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {t("inv.reasonLabel")}
              </span>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-9 bg-card text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(mode === "set"
                    ? ([["correction", "reason.p_correction"]] as const)
                    : reasons[mode]
                  ).map(([code, labelKey]) => (
                    <SelectItem key={code} value={code}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="block space-y-1">
              <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {mode === "set" ? t("inv.setCount") : t("inv.quantity")}
              </span>
              <Input
                inputMode="decimal"
                maxLength={9}
                value={n}
                onChange={(e) => setN(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("inv.inStock")}: <span className="tabular">{current}</span> · {t("inv.newTotal")}:{" "}
              <span className="tabular font-medium text-secondary-foreground">
                {mode === "set"
                  ? Number(n || 0)
                  : current + (mode === "in" ? Number(n || 0) : -Number(n || 0))}
              </span>
            </p>
            <Label className="block space-y-1">
              <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {t("inv.noteOptional")}
              </span>
              <Input
                maxLength={LIMITS.note}
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, LIMITS.note))}
                placeholder={t("inv.notePlaceholder")}
              />
            </Label>
            <Button disabled={n === "" || (mode !== "set" && Number(n) === 0)} onClick={save}>
              {t("common.save")}
            </Button>
          </>
        ) : (
          <Card className="max-h-80 overflow-y-auto">
            {(hist.data ?? []).length === 0 ? (
              hist.isLoading ? (
                <RowsSkeleton rows={3} className="p-3" />
              ) : (
                <p className="p-3 text-[13px] text-muted-foreground">{t("inv.noMovements")}</p>
              )
            ) : (
              <Table className="text-[13px]">
                <TableBody>
                  {hist.data!.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-semibold">
                          {LEDGER_REASONS.has(m.reason) ? t(`reason.${m.reason}`) : m.reason}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(m.created_at)}
                          {m.staff_id && ` · ${names.data?.[m.staff_id] ?? ""}`}
                          {m.note && ` · ${m.note}`}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular whitespace-nowrap text-right font-bold",
                          m.delta < 0 ? "text-destructive" : "text-success",
                        )}
                      >
                        {m.delta > 0 ? "+" : ""}
                        {m.delta}
                      </TableCell>
                      <TableCell className="tabular w-12 text-right text-muted-foreground">
                        {m.balance_after}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ImportRow = {
  name: string;
  sku: string;
  cost: number;
  price: number;
  qty: number | null;
  active: boolean;
  existing: Product | null;
  /** True when the row was matched by code but the name in the CSV differs from
   * the catalog name, the item will be renamed on import. */
  renamed: boolean;
  error?: string | undefined;
};

/** Names pasted from a spreadsheet must not carry markup or control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CELL = /[\u0000-\u001f\u007f-\u009f<>`]/;

function readImport(text: string, products: Product[]): ImportRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(tt("inv.errNoRows"));
  // Bound a single import to 5 000 data rows. Anything larger is either a
  // mistake or an abusive upload that would queue 5 000 sequential
  // `save_product` RPCs.
  if (rows.length - 1 > LIMITS.csvRows)
    throw new Error(tt("inv.errTooManyRows", { count: rows.length - 1, max: "5,000" }));
  const h = rows[0]!.map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const ci = {
    name: col("name", "item", "product"),
    // "Buying cost" / "SKU / code" are the headers our own store export
    // writes, so a downloaded sheet re-imports instead of silently losing
    // every cost cell and creating items without a code.
    sku: col("sku", "barcode", "code", "item code", "sku / barcode", "sku / code"),
    cost: col("cost", "cost price", "buying price", "buying cost"),
    price: col("price", "selling price"),
    qty: col("quantity", "qty", "stock", "in stock"),
    active: col("active", "available"),
  };
  if (ci.name < 0) throw new Error(tt("inv.errNeedName"));
  return rows.slice(1).map((r) => {
    const name = (r[ci.name] ?? "").trim();
    // Codes match the catalog the same way the till matches a scan: trimmed and
    // case-insensitive, so "abc-1" and "ABC-1" update one item instead of duplicating it.
    const sku = ci.sku >= 0 ? normalizeCode(r[ci.sku]) : "";
    const needle = sku.toLowerCase();
    // A row that carries a code may only match on that code. Falling back to a
    // name match let an edited spreadsheet move stock onto whichever item
    // happened to share the name, while the coded item kept its old quantity.
    const existing = sku
      ? (products.find((p) => normalizeCode(p.sku).toLowerCase() === needle) ?? null)
      : (products.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null);
    // Flag when a code match found a different display name, the item will be
    // renamed. This is intentional (e.g. correcting a typo) but we surface it
    // in the preview so the user isn't surprised.
    const renamed = !!sku && !!existing && existing.name.toLowerCase() !== name.toLowerCase();
    const cost =
      ci.cost >= 0 && r[ci.cost]?.trim()
        ? parseAmountCell(r[ci.cost])
        : Number(existing?.cost ?? 0);
    const price =
      ci.price >= 0 && r[ci.price]?.trim()
        ? parseAmountCell(r[ci.price])
        : Number(existing?.price ?? 0);
    const qty = ci.qty >= 0 && r[ci.qty]?.trim() ? parseAmountCell(r[ci.qty]) : null;
    const a = ci.active >= 0 ? (r[ci.active] ?? "").trim().toLowerCase() : "";
    const active = a ? !["no", "false", "0", "n"].includes(a) : (existing?.active ?? true);
    // Reject over-limit / malformed cell values here so the preview matches the RPC.
    const error =
      !name || name.length > LIMITS.productName || UNSAFE_CELL.test(name) || payloadKind(name)
        ? tt("inv.errName")
        : sku && !/^[A-Za-z0-9._\- ]{1,64}$/.test(sku)
          ? tt("inv.errSku")
          : [cost, price].some((v) => Number.isNaN(v) || v < 0 || v > 1_000_000_000) ||
              (qty !== null && (Number.isNaN(qty) || qty < 0 || qty > 1_200_000))
            ? tt("inv.errNumber")
            : cost > 0 && price <= cost
              ? tt("inv.errCostAbovePrice")
              : undefined;
    return { name, sku, cost, price, qty, active, existing, renamed, error };
  });
}

function ImportDialog({ rows, onClose }: { rows: ImportRow[]; onClose: () => void }) {
  const { rpc, store, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const ok = rows.filter((r) => !r.error);
  const bad = rows.length - ok.length;
  async function run() {
    setBusy(true);
    // Re-pull the catalog before applying anything. The preview matched rows
    // against a 30-minute cache, so an item created or renamed since then would
    // import as a duplicate instead of updating the real one.
    await Promise.all([
      qc.refetchQueries({ queryKey: ["products"] }),
      qc.refetchQueries({ queryKey: ["stock"] }),
    ]);
    const failed: string[] = [];
    for (const r of ok) {
      try {
        const id =
          ((await rpc("save_product", {
            p_store: store?.id ?? null,
            p_id: r.existing?.id ?? null,
            p_name: r.name,
            p_sku: r.sku || null,
            // Category is not a CSV column, preserve whatever is stored.
            p_category: r.existing?.category ?? null,
            p_price: r.price,
            p_cost: r.cost,
            p_active: r.active,
            // The CSV has no reorder-point column, so carry the stored value
            // through the update instead of clearing it.
            p_reorder_point: r.existing?.reorder_point ?? null,
          })) as string | null) ?? r.existing?.id;
        // The quantity column states what should be on the shelf, so it is sent
        // as an absolute value: SQL computes the movement against the live,
        // locked row. The old client-side `target - cached snapshot` delta went
        // wrong whenever stock moved after the page loaded, and the `target is
        // unchanged` guard skipped the write entirely while still reporting
        // success - which is how the till came to sell units that were never there.
        if (id && store && r.qty !== null)
          await rpc("set_stock_qty", {
            p_store: store.id,
            p_product: id,
            p_qty: r.qty,
            p_reason: "correction",
            p_note: "CSV import",
          });
      } catch (e) {
        failed.push(`${r.name}: ${(e as Error).message}`);
      }
      setDone((d) => d + 1);
    }
    // Every screen that reads a quantity or a price has to re-read the imported
    // numbers, including the till's own long-lived catalog and stock badge.
    // Close the dialog immediately so the user sees the updated table; refresh
    // happens in background without blocking the UI.
    onClose();
    invalidateKeys(qc, [["products"], ["stock"], ["movements"], ["collections"], ["dash-alerts"]]);
    if (failed.length) {
      const more = failed.length > 3 ? ` (+${failed.length - 3})` : "";
      const counts = t("inv.importedFailed", {
        ok: ok.length - failed.length,
        fails: failed.length,
      });
      toast.error(`${counts}, ${failed.slice(0, 3).join("; ")}${more}`, { duration: 9000 });
    } else toast.success(t("inv.itemsImported", { count: ok.length }));
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("inv.importItemsTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {ok.filter((r) => !r.existing).length} {t("inv.newWord")} ·{" "}
          {ok.filter((r) => r.existing && !r.renamed).length} {t("inv.updatesWord")}
          {ok.filter((r) => r.renamed).length > 0
            ? ` · ${ok.filter((r) => r.renamed).length} ${t("inv.renamedWord")}`
            : ""}
          {bad ? ` · ${bad} ${t("inv.skippedWord")}` : ""}.{" "}
          {t("inv.qtySetNote", { store: store?.name ?? "" })}
        </p>
        <Card className="max-h-80 overflow-y-auto">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3">{t("doc.item")}</TableHead>
                <TableHead>{t("inv.codeColumn")}</TableHead>
                <TableHead className="text-right">{t("inv.cost")}</TableHead>
                <TableHead className="text-right">{t("inv.price")}</TableHead>
                <TableHead className="text-right">{t("doc.qty")}</TableHead>
                <TableHead className="px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} className={cn(r.error && "text-destructive")}>
                  <TableCell className="px-3 font-medium">{r.name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                  <TableCell className="tabular text-right">{money(r.cost)}</TableCell>
                  <TableCell className="tabular text-right">{money(r.price)}</TableCell>
                  <TableCell className="tabular text-right">{r.qty ?? "—"}</TableCell>
                  <TableCell className="px-3 text-xs">
                    {r.error ??
                      (r.existing ? (
                        r.renamed ? (
                          <span>
                            {t("inv.renameTag")}{" "}
                            <span className="text-muted-foreground">← {r.existing.name}</span>
                          </span>
                        ) : (
                          t("inv.updateTag")
                        )
                      ) : (
                        t("inv.newTag")
                      ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">{t("inv.columnsHint")}</p>
        <Button disabled={busy || ok.length === 0} onClick={run}>
          {busy
            ? t("inv.importing", { done, total: ok.length })
            : t("inv.importItems", { count: ok.length })}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
