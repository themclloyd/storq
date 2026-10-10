import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useDeferredValue } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaffNames } from "@/lib/sales";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useProducts, useStock, type Product } from "@/lib/products";
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
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { downloadCsv, downloadPdf, fileStamp, parseCsv } from "@/lib/pdf";
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

function Inventory() {
  const { store, money, can, business } = usePos();
  const { t } = useI18n();
  const [imp, setImp] = useState<ImportRow[] | null>(null);
  const products = useProducts({ withCost: true });
  const stock = useStock(store?.id);
  const cols = useCollections();
  const colName = (pid: string) =>
    (cols.data?.byProduct[pid] ?? [])
      .map((id) => cols.data?.list.find((c) => c.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [adj, setAdj] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const low = useLowStock(store?.id);
  // The filter and stock-value total scan the whole cached catalog, so memoize
  // them (unrelated re-renders no longer re-scan every product) and defer the
  // search term to keep typing responsive on large stores. These derive from
  // hooks, so they stay above the role guard to keep hook order unconditional.
  const dq = useDeferredValue(q);
  const rows = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const lowIds = new Set((low.data ?? []).map((r) => r.product_id));
    return (products.data ?? []).filter(
      (p) =>
        (!needle ||
          p.name.toLowerCase().includes(needle) ||
          p.sku?.toLowerCase().includes(needle)) &&
        (!lowOnly || lowIds.has(p.id)),
    );
  }, [products.data, low.data, lowOnly, dq]);
  const value = useMemo(
    () => rows.reduce((a, p) => a + (stock.data?.[p.id] ?? 0) * Number(p.cost), 0),
    [rows, stock.data],
  );
  if (!can("admin", "manager"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
        {t("inv.noAccess")}
      </Card>
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("inv.title")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {`${store?.name} · ${t("inv.stockValueCost")} ${money(value)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
            <span className="inline-flex h-9 cursor-pointer items-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-secondary">
              {t("inv.importCsv")}
            </span>
          </label>
          <Button
            variant="outline"
            onClick={() => {
              const all = products.data ?? [];
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
            }}
          >
            {t("inv.exportCsv")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const all = products.data ?? [];
              const units = all.reduce((a, p) => a + (stock.data?.[p.id] ?? 0), 0);
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
                  [t("inv.kpiUnits"), String(units)],
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
                      const q = stock.data?.[p.id] ?? 0;
                      return [
                        p.name + (p.active ? "" : t("inv.hiddenSuffix")),
                        p.sku ?? "",
                        colName(p.id),
                        money(p.cost),
                        money(p.price),
                        q,
                        money(q * Number(p.cost)),
                      ];
                    }),
                    foot: [t("common.total"), "", "", "", "", units, money(atCost)],
                  },
                ],
              });
            }}
          >
            {t("inv.exportPdf")}
          </Button>
          <Button variant="accent" onClick={() => setEdit({ active: true, price: 0, cost: 0 })}>
            <HugeiconsIcon icon={PlusSignIcon} /> {t("inv.newItem")}
          </Button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs bg-card"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button
          size="sm"
          variant={lowOnly ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setLowOnly((v) => !v)}
        >
          {t("inv.lowStock")}
          {(low.data?.length ?? 0) > 0 ? ` (${low.data!.length})` : ""}
        </Button>
      </div>
      {rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
          {t("inv.noItemsYet")}
        </Card>
      ) : (
        <Card className="shadow-none">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-2 text-[11px] uppercase tracking-wide">
                  {t("doc.item")}
                </TableHead>
                <TableHead className="py-2 text-[11px] uppercase tracking-wide">SKU</TableHead>
                <TableHead className="py-2 text-[11px] uppercase tracking-wide">
                  {t("inv.thCollections")}
                </TableHead>
                <TableHead className="py-2 text-right text-[11px] uppercase tracking-wide">
                  {t("inv.cost")}
                </TableHead>
                <TableHead className="py-2 text-right text-[11px] uppercase tracking-wide">
                  {t("inv.price")}
                </TableHead>
                <TableHead className="py-2 text-right text-[11px] uppercase tracking-wide">
                  {t("inv.inStock")}
                </TableHead>
                <TableHead className="px-4 py-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const s = stock.data?.[p.id] ?? 0;
                return (
                  <TableRow key={p.id} className={cn(!p.active && "opacity-50")}>
                    <TableCell className="px-4 py-2 font-semibold">{p.name}</TableCell>
                    <TableCell className="py-2 text-muted-foreground">{p.sku}</TableCell>
                    <TableCell className="max-w-40 truncate py-2 text-muted-foreground">
                      {colName(p.id)}
                    </TableCell>
                    <TableCell className="tabular py-2 text-right">{money(p.cost)}</TableCell>
                    <TableCell className="tabular py-2 text-right font-semibold">
                      {money(p.price)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular py-2 text-right font-bold",
                        s <= 0 && "text-destructive",
                      )}
                    >
                      {s}
                    </TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap px-4 py-2 text-right">
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
      )}
      {edit && (
        <ProductDialog
          p={edit}
          currentQty={stock.data?.[edit.id!] ?? 0}
          onClose={() => setEdit(null)}
        />
      )}
      {adj && <StockDialog p={adj} onClose={() => setAdj(null)} />}
      {imp && <ImportDialog rows={imp} stock={stock.data ?? {}} onClose={() => setImp(null)} />}
    </>
  );
}

function ProductDialog({
  p,
  currentQty,
  onClose,
}: {
  p: Partial<Product>;
  currentQty: number;
  onClose: () => void;
}) {
  const { rpc, store, can } = usePos();
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
  async function save() {
    // Mirror the save_product / adjust_stock_reason RPC bounds client-side first.
    const err = firstError(
      requireText(f.name, t("common.name"), LIMITS.productName),
      validateSku(f.sku),
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
          p_sku: f.sku.trim() || null,
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
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("inv.skuBarcode")}
            </span>
            <Input
              maxLength={LIMITS.sku}
              value={f.sku}
              onChange={(e) => setF({ ...f, sku: e.target.value.slice(0, LIMITS.sku) })}
            />
          </Label>
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
          <Card className="bg-muted/40 p-2.5 shadow-none">
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
  const [n, setN] = useState("");
  const [mode, setMode] = useState<"in" | "out">("in");
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
        min: 0.01,
        max: 1_200_000,
      }),
      optionalText(note, t("inv.noteField"), LIMITS.note),
    );
    if (err) {
      toast.error(err);
      return;
    }
    try {
      await rpc("adjust_stock_reason", {
        p_store: store!.id,
        p_product: p.id,
        p_delta: (mode === "in" ? 1 : -1) * Number(n),
        p_reason: reason,
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
            <div className="grid grid-cols-2 gap-2">
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
                  {reasons[mode].map(([code, labelKey]) => (
                    <SelectItem key={code} value={code}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("inv.quantity")}
              </span>
              <Input
                inputMode="decimal"
                maxLength={9}
                value={n}
                onChange={(e) => setN(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </Label>
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
            <Button disabled={!Number(n)} onClick={save}>
              {t("common.save")}
            </Button>
          </>
        ) : (
          <Card className="max-h-80 overflow-y-auto shadow-none">
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
  sku: string | null;
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
    sku: col("sku", "barcode", "sku / barcode"),
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
    const sku = ci.sku >= 0 ? (r[ci.sku] ?? "").trim() || null : null;
    const existing =
      products.find((p) => (sku && p.sku === sku) || p.name.toLowerCase() === name.toLowerCase()) ??
      null;
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
            p_sku: r.sku,
            p_category: null,
            p_price: r.price,
            p_cost: r.cost,
            p_active: r.active,
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
        <Card className="max-h-80 overflow-y-auto shadow-none">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-3">{t("doc.item")}</TableHead>
                <TableHead>SKU</TableHead>
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
