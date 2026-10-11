import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useDeferredValue } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/sales";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PackageIcon, PlusSignIcon, QrCode01Icon, Refresh01Icon, Search01Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useProducts, useStock, type Product } from "@/lib/products";
import {
  findCodeClash,
  isAutoCode,
  normalizeCode,
  suggestCode,
  takenCodes,
} from "@/lib/item-codes";
import { useLowStock } from "@/lib/transfers";
import {
  LIMITS,
  firstError,
  optionalText,
  requireText,
  sanitizeText,
  validateAmount,
  validateSku,
} from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/pos/bits";
import { ExportMenu } from "@/components/pos/ExportMenu";
import { ItemCodeCard, ItemQrDialog } from "@/components/pos/ItemQr";
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
import { downloadCsv, downloadLabelSheet, downloadPdf, fileStamp, parseCsv } from "@/lib/pdf";
import { t as tt, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Storq" },
      { name: "description", content: "Manage Storq items, buying costs and store stock." },
      { property: "og:title", content: "Inventory — Storq" },
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
const PAGE_SIZE = 50;

function Inventory() {
  const { store, money, can, business } = usePos();
  const { t } = useI18n();
  const [imp, setImp] = useState<ImportRow[] | null>(null);
  const products = useProducts({ withCost: true });
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
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [adj, setAdj] = useState<Product | null>(null);
  // Code / QR: one item at a time, and the multi-select for a label sheet.
  const [qr, setQr] = useState<Product | null>(null);
  const [sheet, setSheet] = useState<Product[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [colFilter, setColFilter] = useState("all");
  const [sort, setSort] = useState<"name" | "price" | "stock">("name");
  const [page, setPage] = useState(0);
  const low = useLowStock(store?.id);
  // The filter, sort and stock-value total scan the whole cached catalog, so
  // memoize them (unrelated re-renders no longer re-scan every product) and
  // defer the search term to keep typing responsive on large stores. These
  // derive from hooks, so they stay above the role guard to keep hook order
  // unconditional.
  const dq = useDeferredValue(q);
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
  // Paginate beyond PAGE_SIZE rows (spec §4). Clamp when filters shrink `rows`.
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  if (!can("admin", "manager"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("inv.noAccess")}</Card>
    );

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.inventory")} / ${t("nav.items")}`}
        title={t("inv.title")}
        sub={
          <>
            {store?.name} · {t("inv.stockValueCost")}{" "}
            <span className="font-medium text-secondary-foreground">{money(value)}</span>
          </>
        }
        actions={
          <>
            <label className="inline-flex">
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    setImp(readImport(await f.text(), products.data ?? []));
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              />
              <span className="inline-flex h-9 cursor-pointer items-center rounded-xl border border-input bg-card px-3 text-sm font-semibold hover:bg-muted">
                {t("inv.importCsv")}
              </span>
            </label>
            <ExportMenu
              onExport={(kind) => {
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
                const retail = all.reduce(
                  (a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.price),
                  0,
                );
                const atCost = all.reduce(
                  (a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.cost),
                  0,
                );
                void downloadPdf({
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
              }}
            />
            <Button onClick={() => setEdit({ active: true, price: 0, cost: 0 })}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("inv.newItem")}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="w-56 bg-card pl-9"
            placeholder={t("inv.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
            lowOnly
              ? "border-transparent bg-destructive-soft text-destructive"
              : "border-input bg-card hover:bg-muted",
          )}
        >
          {t("inv.lowStock")}
          {lowCount > 0 ? ` · ${lowCount}` : ""}
        </button>
        <Select value={colFilter} onValueChange={setColFilter}>
          <SelectTrigger className="h-9 w-auto bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("inv.allCollections")}</SelectItem>
            {(cols.data?.list ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as "name" | "price" | "stock")}>
          <SelectTrigger className="h-9 w-auto bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{t("inv.sortName")}</SelectItem>
            <SelectItem value="price">{t("inv.sortPrice")}</SelectItem>
            <SelectItem value="stock">{t("inv.sortStock")}</SelectItem>
          </SelectContent>
        </Select>
        {pickedRows.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setSheet(pickedRows)}>
            <HugeiconsIcon icon={QrCode01Icon} /> {t("code.printLabelSheet")} · {pickedRows.length}
          </Button>
        )}
        {pickedRows.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setPicked({})}
          >
            {t("code.clearSelection")}
          </Button>
        )}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("inv.totalItems")}</p>
          <p className="font-display tabular mt-1 text-2xl">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("inv.unitsInStock")}</p>
          <p className="font-display tabular mt-1 text-2xl">{units}</p>
        </Card>
        <Card
          className={cn("p-4", lowOnly && "ring-2 ring-primary/30")}
          role="button"
          tabIndex={0}
          onClick={() => setLowOnly(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLowOnly(true);
            }
          }}
        >
          <p className="text-xs text-muted-foreground">{t("inv.lowStock")}</p>
          <p className="font-display tabular mt-1 text-2xl text-destructive">{lowCount}</p>
        </Card>
      </div>
      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
              <HugeiconsIcon icon={PackageIcon} />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">
              {q || lowOnly || colFilter !== "all" ? t("common.none") : t("inv.noItemsYet")}
            </p>
            <Button onClick={() => setEdit({ active: true, price: 0, cost: 0 })}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("inv.newItem")}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow>
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
                  <TableHead className="pl-4">{t("doc.item")}</TableHead>
                  <TableHead>{t("inv.codeColumn")}</TableHead>
                  <TableHead>{t("inv.thCollections")}</TableHead>
                  <TableHead className="text-right">{t("inv.cost")}</TableHead>
                  <TableHead className="text-right">{t("inv.price")}</TableHead>
                  <TableHead className="text-right">{t("inv.inStock")}</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((p) => {
                  const s = stock.data?.[p.id] ?? 0;
                  const threshold = p.reorder_point ?? 5;
                  const isLow = s > 0 && s <= threshold;
                  const costAbove = Number(p.cost) > Number(p.price);
                  return (
                    <TableRow key={p.id} className={cn(!p.active && "opacity-[0.45]")}>
                      <TableCell className="w-8 pr-0">
                        <Checkbox
                          aria-label={t("code.selectItem", { name: p.name })}
                          checked={!!picked[p.id]}
                          onCheckedChange={(v) => setPicked((s) => ({ ...s, [p.id]: v === true }))}
                        />
                      </TableCell>
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
                      <TableCell className="max-w-40">
                        {colName(p.id) ? (
                          <Badge variant="secondary" className="max-w-full truncate">
                            {colName(p.id)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">{t("common.none")}</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">{money(p.cost)}</TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {money(p.price)}
                      </TableCell>
                      <TableCell className="tabular py-3 text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span className={cn(s <= 0 && "text-destructive")}>{s}</span>
                          {isLow && <Badge variant="destructive">{t("inv.lowBadge")}</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap py-3 pr-4 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground hover:text-accent"
                          aria-label={t("code.showAria", { name: p.name })}
                          title={t("code.showTitle")}
                          onClick={() => setQr(p)}
                        >
                          <HugeiconsIcon icon={QrCode01Icon} />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAdj(p)}>
                          {t("inv.btnStock")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>
                          {t("common.edit")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          {rows.length > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t("common.of")} {rows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={curPage === 0}
                  onClick={() => setPage(curPage - 1)}
                >
                  {t("common.prev")}
                </Button>
                <span className="tabular text-xs text-muted-foreground">
                  {curPage + 1} / {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={curPage >= pageCount - 1}
                  onClick={() => setPage(curPage + 1)}
                >
                  {t("common.next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {edit && (
        <ProductDialog
          p={edit}
          currentQty={stock.data?.[edit.id!] ?? 0}
          codes={products.data ?? []}
          onClose={() => setEdit(null)}
        />
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
      {imp && <ImportDialog rows={imp} stock={stock.data ?? {}} onClose={() => setImp(null)} />}
    </>
  );
}

function ProductDialog({
  p,
  currentQty,
  codes,
  onClose,
}: {
  p: Partial<Product>;
  currentQty: number;
  codes: Product[];
  onClose: () => void;
}) {
  const { rpc, store, can, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const cols = useCollections();
  const [sel, setSel] = useState<string[] | null>(null);
  const chosen = sel ?? (p.id ? (cols.data?.byProduct[p.id] ?? []) : []);
  const [f, setF] = useState({
    name: p.name ?? "",
    sku: p.sku ?? "",
    category: p.category ?? "",
    price: String(p.price ?? ""),
    cost: String(p.cost ?? ""),
    qty: p.id ? String(currentQty) : "",
    reorder: p.reorder_point != null ? String(p.reorder_point) : "",
    active: p.active ?? true,
  });
  // One identifier for the whole item: typed here, printed as the QR, and what
  // the till matches a scan against. Blank on create means SQL generates it.
  const code = normalizeCode(f.sku);
  const clash = findCodeClash(codes, code, p.id);
  async function save() {
    // Mirror the save_product / adjust_stock_reason RPC bounds client-side first.
    const err = firstError(
      requireText(f.name, t("common.name"), LIMITS.productName),
      validateSku(code),
      clash ? t("inv.codeTaken", { name: clash.name }) : null,
      validateAmount(f.price, {
        label: t("inv.sellingPrice"),
        required: true,
        min: 0,
        max: 1_000_000_000,
      }),
      validateAmount(f.cost, { label: t("inv.buyingCost"), min: 0, max: 1_000_000_000 }),
      f.qty === ""
        ? null
        : validateAmount(f.qty, { label: t("inv.quantity"), min: 0, max: 1_200_000 }),
      f.reorder === ""
        ? null
        : validateAmount(f.reorder, {
            label: t("inv.reorderPointField"),
            min: 0,
            max: 1_000_000,
            integer: true,
          }),
    );
    if (err) {
      toast.error(err);
      return;
    }
    try {
      const pid =
        ((await rpc("save_product", {
          p_id: p.id ?? null,
          p_name: sanitizeText(f.name, LIMITS.productName),
          p_sku: code || null,
          p_category: null,
          p_price: Number(f.price || 0),
          p_cost: Number(f.cost || 0),
          p_active: f.active,
          p_reorder_point: f.reorder === "" ? null : Number(f.reorder),
        })) as string | null) ?? p.id;
      if (pid) await rpc("set_product_collections", { p_product: pid, p_collections: chosen });
      const qty = f.qty === "" ? null : Number(f.qty);
      if (pid && qty !== null && qty !== currentQty && store?.id) {
        await rpc("adjust_stock_reason", {
          p_store: store.id,
          p_product: pid,
          p_delta: qty - currentQty,
          p_reason: "correction",
          p_note: "Edited on item",
        });
      }
      toast.success(t("common.saved"));
      invalidateKeys(qc, [
        ["products"],
        ["stock"],
        ["movements"],
        ["collections"],
        ["dash-alerts"],
      ]);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const stockEditable = can("admin", "manager") && !!store;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p.id ? t("inv.editItem") : t("inv.newItem")}</DialogTitle>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("common.name")}</span>
          <Input
            maxLength={LIMITS.productName}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value.slice(0, LIMITS.productName) })}
          />
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("inv.itemCode")}
            </span>
            <div className="flex gap-1.5">
              <Input
                className="min-w-0 flex-1"
                maxLength={LIMITS.sku}
                placeholder={t("inv.codePlaceholder")}
                value={f.sku}
                onChange={(e) => setF({ ...f, sku: e.target.value.slice(0, LIMITS.sku) })}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                title={t("inv.generateCode")}
                aria-label={t("inv.generateCode")}
                onClick={() => setF({ ...f, sku: suggestCode(takenCodes(codes)) })}
              >
                <HugeiconsIcon icon={Refresh01Icon} />
              </Button>
            </div>
          </div>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("inv.costPrice")}
            </span>
            <Input
              inputMode="decimal"
              maxLength={14}
              value={f.cost}
              onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("inv.sellingPrice")}
            </span>
            <Input
              inputMode="decimal"
              maxLength={14}
              value={f.price}
              onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          </Label>
        </div>
        <Card className="space-y-2 bg-muted/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("inv.codePanel")}
            </span>
            {code && isAutoCode(code) && <Badge variant="secondary">{t("inv.autoTag")}</Badge>}
          </div>
          {clash ? (
            <p className="text-xs text-destructive">{t("inv.codeTaken", { name: clash.name })}</p>
          ) : code ? (
            <ItemCodeCard
              compact
              item={{ name: f.name || t("doc.item"), code, price: f.price ? money(f.price) : null }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {p.id ? t("inv.codeKeepHint") : t("inv.codeAutoHint")}
            </p>
          )}
        </Card>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("inv.collectionsLabel")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(cols.data?.list ?? []).map((c) => {
              const on = chosen.includes(c.id);
              return (
                <Button
                  type="button"
                  key={c.id}
                  size="sm"
                  variant={on ? "default" : "outline"}
                  onClick={() => setSel(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id])}
                  className="rounded-full"
                >
                  {c.name}
                  {c.discount_pct > 0 ? ` −${c.discount_pct}%` : ""}
                </Button>
              );
            })}
            {(cols.data?.list ?? []).length === 0 && (
              <span className="text-xs text-muted-foreground">{t("inv.noCollections")}</span>
            )}
          </div>
        </Label>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("inv.reorderPoint")}
          </span>
          <Input
            inputMode="numeric"
            maxLength={7}
            placeholder={t("inv.reorderPlaceholder")}
            value={f.reorder}
            onChange={(e) => setF({ ...f, reorder: e.target.value.replace(/[^0-9]/g, "") })}
          />
        </Label>
        {stockEditable && (
          <Card className="bg-muted/40 p-2.5">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("inv.quantity")} — {store?.name}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="max-w-32"
                inputMode="decimal"
                placeholder={p.id ? String(currentQty) : "0"}
                value={f.qty}
                onChange={(e) => setF({ ...f, qty: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                {p.id ? t("inv.currentlyInStock", { qty: currentQty }) : t("inv.startingStock")}
              </span>
            </div>
          </Card>
        )}
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={f.active}
            onCheckedChange={(v) => setF({ ...f, active: v === true })}
          />{" "}
          {t("inv.availableForSale")}
        </Label>
        <Button disabled={!f.name} onClick={save}>
          {t("inv.saveItem")}
        </Button>
      </DialogContent>
    </Dialog>
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
  const n = Math.min(60, Math.max(1, Math.trunc(Number(copies) || 1)));
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
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("code.copiesLabel")}
            </span>
            <Input
              className="max-w-24"
              inputMode="numeric"
              maxLength={2}
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
        max: 1_200_000,
      }),
      optionalText(note, t("inv.noteField"), LIMITS.note),
    );
    if (err) {
      toast.error(err);
      return;
    }
    const delta = mode === "set" ? Number(n) - current : (mode === "in" ? 1 : -1) * Number(n);
    try {
      await rpc("adjust_stock_reason", {
        p_store: store!.id,
        p_product: p.id,
        p_delta: delta,
        p_reason: mode === "set" ? "correction" : reason,
        p_note: note ? sanitizeText(note, LIMITS.note) : null,
      });
      toast.success(t("inv.stockUpdated"));
      invalidateKeys(qc, [["stock"], ["movements"], ["dash-alerts"]]);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {p.name} — {store?.name}
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
              <span className="text-[11px] font-medium text-muted-foreground">
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
              <span className="text-[11px] font-medium text-muted-foreground">
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
              <span className="text-[11px] font-medium text-muted-foreground">
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
              <p className="p-3 text-[13px] text-muted-foreground">
                {hist.isLoading ? t("common.loading") : t("inv.noMovements")}
              </p>
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
  error?: string | undefined;
};

/** Names pasted from a spreadsheet must not carry markup or control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CELL = /[\u0000-\u001f\u007f-\u009f<>`]/;

function readImport(text: string, products: Product[]): ImportRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(tt("inv.errNoRows"));
  const h = rows[0]!.map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const ci = {
    name: col("name", "item", "product"),
    sku: col("sku", "barcode", "code", "item code", "sku / barcode"),
    cost: col("cost", "cost price", "buying price"),
    price: col("price", "selling price"),
    qty: col("quantity", "qty", "stock", "in stock"),
    active: col("active", "available"),
  };
  if (ci.name < 0) throw new Error(tt("inv.errNeedName"));
  const num = (v: string | undefined) => {
    // eslint-disable-next-line no-useless-escape
    const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  return rows.slice(1).map((r) => {
    const name = (r[ci.name] ?? "").trim();
    // Codes match the catalog the same way the till matches a scan: trimmed and
    // case-insensitive, so "abc-1" and "ABC-1" update one item instead of duplicating it.
    const sku = ci.sku >= 0 ? normalizeCode(r[ci.sku]) : "";
    const needle = sku.toLowerCase();
    const existing =
      products.find(
        (p) =>
          (needle && normalizeCode(p.sku).toLowerCase() === needle) ||
          p.name.toLowerCase() === name.toLowerCase(),
      ) ?? null;
    const cost = ci.cost >= 0 && r[ci.cost]?.trim() ? num(r[ci.cost]) : Number(existing?.cost ?? 0);
    const price =
      ci.price >= 0 && r[ci.price]?.trim() ? num(r[ci.price]) : Number(existing?.price ?? 0);
    const qty = ci.qty >= 0 && r[ci.qty]?.trim() ? num(r[ci.qty]) : null;
    const a = ci.active >= 0 ? (r[ci.active] ?? "").trim().toLowerCase() : "";
    const active = a ? !["no", "false", "0", "n"].includes(a) : (existing?.active ?? true);
    // Reject over-limit / malformed cell values here so the preview matches the RPC.
    const error =
      !name || name.length > LIMITS.productName || UNSAFE_CELL.test(name)
        ? tt("inv.errName")
        : sku && !/^[A-Za-z0-9._\- ]{1,64}$/.test(sku)
          ? tt("inv.errSku")
          : [cost, price].some((v) => Number.isNaN(v) || v < 0 || v > 1_000_000_000) ||
              (qty !== null && (Number.isNaN(qty) || qty < 0 || qty > 1_200_000))
            ? tt("inv.errNumber")
            : undefined;
    return { name, sku, cost, price, qty, active, existing, error };
  });
}

function ImportDialog({
  rows,
  stock,
  onClose,
}: {
  rows: ImportRow[];
  stock: Record<string, number>;
  onClose: () => void;
}) {
  const { rpc, store, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const ok = rows.filter((r) => !r.error);
  const bad = rows.length - ok.length;
  async function run() {
    setBusy(true);
    let fails = 0;
    for (const r of ok) {
      try {
        const id =
          ((await rpc("save_product", {
            p_id: r.existing?.id ?? null,
            p_name: r.name,
            p_sku: r.sku || null,
            p_category: null,
            p_price: r.price,
            p_cost: r.cost,
            p_active: r.active,
            // The CSV has no reorder-point column, so carry the stored value
            // through the update instead of clearing it.
            p_reorder_point: r.existing?.reorder_point ?? null,
          })) as string | null) ?? r.existing?.id;
        const cur = r.existing ? (stock[r.existing.id] ?? 0) : 0;
        if (id && store && r.qty !== null && r.qty !== cur)
          await rpc("adjust_stock_reason", {
            p_store: store.id,
            p_product: id,
            p_delta: r.qty - cur,
            p_reason: "correction",
            p_note: "CSV import",
          });
      } catch {
        fails++;
      }
      setDone((d) => d + 1);
    }
    invalidateKeys(qc, [["products"], ["stock"], ["movements"], ["collections"], ["dash-alerts"]]);
    if (fails) toast.error(t("inv.importedFailed", { ok: ok.length - fails, fails }));
    else toast.success(t("inv.itemsImported", { count: ok.length }));
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("inv.importItemsTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {ok.filter((r) => !r.existing).length} {t("inv.newWord")} ·{" "}
          {ok.filter((r) => r.existing).length} {t("inv.updatesWord")}
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
                    {r.error ?? (r.existing ? t("inv.updateTag") : t("inv.newTag"))}
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
