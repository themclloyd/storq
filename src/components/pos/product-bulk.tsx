import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Delete02Icon, PlusSignIcon, Refresh01Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { useCollections } from "@/lib/collections";
import { useProducts, useStock, type Product } from "@/lib/products";
import { normalizeCode, suggestCode, takenCodes } from "@/lib/item-codes";
import {
  changedDrafts,
  draftFromProduct,
  emptyDraft,
  isBlankDraft,
  validateDraft,
  type ProductDraft,
} from "@/lib/product-draft";
import type { InventoryView } from "@/lib/inventory-view";
import { LIMITS, sanitizeText } from "@/lib/validate";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import { Field, PageHeader } from "@/components/pos/bits";
import { RowsSkeleton } from "@/components/pos/skeletons";

/** Every quantity and price field on these pages strips anything but digits and a dot. */
const amount = (v: string) => v.replace(/[^0-9.]/g, "").slice(0, 14);

type Failures = { row: ProductDraft; message: string }[];

/** Two membership sets, whatever their order. */
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** One sentence for a partly successful batch, the same wording the CSV import uses. */
function reportFailures(
  t: (k: string, p?: Record<string, string | number>) => string,
  ok: number,
  failed: Failures,
) {
  const counts = t("inv.importedFailed", { ok: ok - failed.length, fails: failed.length });
  const more = failed.length > 3 ? ` (+${failed.length - 3})` : "";
  const first = failed
    .slice(0, 3)
    .map((f) => `${f.row.name}: ${f.message}`)
    .join("; ");
  toast.error(`${counts}, ${first}${more}`, { duration: 9000 });
}

/**
 * Adding several items in one pass. A shop fills a shelf, not a field: the page
 * opens with one row, `Add another row` appends, and one save writes them all in
 * the order they were typed. Everything the single-item sheet needs at creation
 * (name, code, cost, price, starting quantity) is here; collections and the
 * reorder point stay on the item's own page once it exists.
 */
export function ProductBulkAddForm({
  initialCode,
  back,
}: {
  initialCode?: string | undefined;
  /** The table's view: where Save and Cancel return to. */
  back: Partial<InventoryView>;
}) {
  const { rpc, store } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const products = useProducts(store?.id, { withCost: true });
  const catalog = useMemo(() => products.data ?? [], [products.data]);
  // A scanned code arrives with the first row, so the till's "unknown item"
  // shortcut lands on a page that already knows what was scanned.
  const [rows, setRows] = useState<ProductDraft[]>(() => [emptyDraft(initialCode ?? "")]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  /** A row shown blank still needs a code: generated now, stored as-is on save. */
  function nextCode(list: ProductDraft[]) {
    return suggestCode([...takenCodes(catalog), ...list.map((r) => r.sku)]);
  }

  function update(i: number, patch: Partial<ProductDraft>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyDraft(nextCode(prev))]);
  }

  function removeRow(i: number) {
    setErrors({});
    setRows((prev) => (prev.length === 1 ? [emptyDraft()] : prev.filter((_, idx) => idx !== i)));
  }

  async function save() {
    const typed = rows.map((row, i) => ({ row, i })).filter(({ row }) => !isBlankDraft(row));
    if (!typed.length) {
      toast.error(t("inv.nothingToAdd"));
      return;
    }
    const found: Record<number, string> = {};
    for (const { row, i } of typed) {
      const err = validateDraft(row, {
        codes: catalog,
        others: rows.filter((_, idx) => idx !== i),
      });
      if (err) found[i] = err;
    }
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error(Object.values(found)[0] ?? t("inv.saveItem"));
      return;
    }
    setErrors({});
    setBusy(true);
    // The preview matched codes against a long-lived cache: re-read the catalog
    // so an item added on another till is caught here, not as a server error.
    await Promise.all([
      qc.refetchQueries({ queryKey: ["products"] }),
      qc.refetchQueries({ queryKey: ["stock"] }),
    ]);
    const failed: Failures = [];
    for (const { row } of typed) {
      try {
        const id = (await rpc("save_product", {
          p_store: store?.id ?? null,
          p_id: null,
          p_name: sanitizeText(row.name, LIMITS.productName),
          p_sku: normalizeCode(row.sku) || null,
          p_category: null,
          p_price: Number(row.price || 0),
          p_cost: Number(row.cost || 0),
          p_active: row.active,
          p_reorder_point: null,
        })) as string | null;
        // Absolute quantity against the locked row, never a delta worked out
        // from this page's snapshot.
        if (id && store?.id && row.qty !== "") {
          await rpc("set_stock_qty", {
            p_store: store.id,
            p_product: id,
            p_qty: Number(row.qty),
            p_reason: "correction",
            p_note: "Added on item",
          });
        }
      } catch (e) {
        failed.push({ row, message: (e as Error).message });
      }
    }
    invalidateKeys(qc, [["products"], ["stock"], ["movements"], ["collections"], ["dash-alerts"]]);
    setBusy(false);
    if (!failed.length) {
      toast.success(t("common.saved"));
      nav({ to: "/app/inventory", search: back });
      return;
    }
    // Keep only what failed: the rows that landed are already in stock, and
    // re-submitting them would create a second copy.
    setRows(failed.map((f) => f.row));
    setErrors(Object.fromEntries(failed.map((f, i) => [i, f.message])));
    reportFailures(t, typed.length, failed);
  }

  return (
    <>
      <PageHeader
        back={{ to: "/app/inventory", label: t("inv.title"), search: back }}
        title={t("inv.newItemsTitle")}
        sub={t("inv.newItemsSub")}
        actions={
          <Button variant="outline" onClick={addRow}>
            <HugeiconsIcon icon={PlusSignIcon} /> {t("inv.addRow")}
          </Button>
        }
      />
      <div className="max-w-3xl space-y-2.5">
        {rows.map((row, i) => (
          <Card key={i} className="space-y-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {t("inv.rowNumber", { n: i + 1 })}
              </span>
              <Button
                size="icon"
                variant="ghost"
                title={t("inv.removeRow")}
                aria-label={t("inv.removeRow")}
                onClick={() => removeRow(i)}
              >
                <HugeiconsIcon icon={Delete02Icon} />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={t("common.name")}>
                  <Input
                    maxLength={LIMITS.productName}
                    value={row.name}
                    onChange={(e) =>
                      update(i, { name: e.target.value.slice(0, LIMITS.productName) })
                    }
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={t("inv.itemCode")}>
                  <div className="flex gap-1.5">
                    <Input
                      className="min-w-0 flex-1"
                      maxLength={LIMITS.sku}
                      placeholder={t("inv.codePlaceholder")}
                      value={row.sku}
                      onChange={(e) => update(i, { sku: e.target.value.slice(0, LIMITS.sku) })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      title={t("inv.generateCode")}
                      aria-label={t("inv.generateCode")}
                      onClick={() =>
                        update(i, {
                          sku: suggestCode([...takenCodes(catalog), ...rows.map((r) => r.sku)]),
                        })
                      }
                    >
                      <HugeiconsIcon icon={Refresh01Icon} />
                    </Button>
                  </div>
                </Field>
              </div>
              <Field label={t("inv.costPrice")}>
                <Input
                  inputMode="decimal"
                  value={row.cost}
                  onChange={(e) => update(i, { cost: amount(e.target.value) })}
                />
              </Field>
              <Field label={t("inv.sellingPrice")}>
                <Input
                  inputMode="decimal"
                  value={row.price}
                  onChange={(e) => update(i, { price: amount(e.target.value) })}
                />
              </Field>
              <Field label={`${t("inv.quantity")}, ${store?.name ?? ""}`}>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={row.qty}
                  onChange={(e) => update(i, { qty: amount(e.target.value) })}
                />
              </Field>
            </div>
            {errors[i] && <p className="text-xs text-destructive">{errors[i]}</p>}
          </Card>
        ))}
      </div>
      <div className="mt-4 flex max-w-3xl gap-2">
        <Button className="flex-1" disabled={busy} onClick={() => void save()}>
          {busy ? t("common.saving") : t("inv.saveItem")}
        </Button>
        <Button variant="outline" onClick={() => nav({ to: "/app/inventory", search: back })}>
          {t("common.cancel")}
        </Button>
      </div>
    </>
  );
}

/**
 * The items ticked in the inventory table, in one grid. Every cell is editable,
 * so a whole shelf can be repriced, recounted or moved into a collection in one
 * pass; only rows that differ from the catalog are written, and only what
 * changed in them (`p_category` and the reorder point ride along unchanged).
 *
 * A successful batch offers Undo in the toast. Undo writes the previous values
 * back through the same RPCs, but leaves a quantity alone when it has moved
 * since the save: a till may have sold from these rows in between, and undoing a
 * count must not undo a sale.
 */
type UndoRow = {
  id: string;
  /** Previous cells, written back only when the save changed them. */
  fields?: ProductDraft;
  category: string | null;
  /** Previous membership set, written back only when the save changed it. */
  collections?: string[];
  /** The quantity this save wrote, or null when it left this store's stock alone. */
  wroteQty: number | null;
};

export function ProductBulkEditForm({
  ids,
  back,
}: {
  ids: string[];
  /** The table's view: where Save and Cancel return to. */
  back: Partial<InventoryView>;
}) {
  const { rpc, store } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const products = useProducts(store?.id, { withCost: true });
  const stock = useStock(store?.id);
  const cols = useCollections();
  const catalog = useMemo(() => products.data ?? [], [products.data]);
  const stockMap = useMemo(() => stock.data ?? {}, [stock.data]);
  // What the catalog holds now: the baseline a save diffs against, and what a
  // cancelled edit would have kept.
  const originals = useMemo(
    () =>
      ids
        .map((id) => catalog.find((p) => p.id === id))
        .filter((p): p is Product => !!p)
        .map((p) => draftFromProduct(p, stockMap[p.id] ?? 0)),
    [ids, catalog, stockMap],
  );
  const [rows, setRows] = useState<ProductDraft[]>([]);
  // Membership is a set per item, not a cell, so it lives beside the draft rows
  // and never enters the shared validator.
  const [sets, setSets] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // What the catalog says each row belongs to: the other half of the diff.
  const membership = useCallback((id: string) => cols.data?.byProduct[id] ?? [], [cols.data]);
  // Seed once, when the catalog, the stock sheet and the memberships have
  // landed. A later refresh must not overwrite cells somebody is editing.
  const seeded = useRef(false);
  // One undo per batch: a second press on the toast must not run it twice.
  const undone = useRef(false);
  useEffect(() => {
    if (seeded.current || !originals.length) return;
    if (!products.isFetched || !stock.isFetched || !cols.isFetched) return;
    seeded.current = true;
    setRows(originals);
    setSets(Object.fromEntries(originals.map((o) => [o.id!, [...membership(o.id!)]])));
  }, [originals, products.isFetched, stock.isFetched, cols.isFetched, membership]);

  function update(i: number, patch: Partial<ProductDraft>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function toggleCollection(id: string, collection: string, on: boolean) {
    setSets((prev) => {
      const now = prev[id] ?? [];
      return { ...prev, [id]: on ? [...now, collection] : now.filter((c) => c !== collection) };
    });
  }

  /** The names a row's cell shows; the ids are what SQL takes. */
  function namesOf(id: string) {
    return (sets[id] ?? [])
      .map((cid) => cols.data?.list.find((c) => c.id === cid)?.name ?? "")
      .filter(Boolean)
      .join(", ");
  }

  async function save() {
    const dirty = changedDrafts(originals, rows);
    // A row can change without a single cell changing, so the batch is the union
    // of both diffs — and each half is written only where it differs.
    const moved = rows.filter((r) => r.id && !sameSet(sets[r.id] ?? [], membership(r.id)));
    const targets = rows.filter(
      (r) => dirty.some((d) => d.id === r.id) || moved.some((m) => m.id === r.id),
    );
    if (!targets.length) {
      toast.info(t("inv.nothingChanged"));
      return;
    }
    const found: Record<number, string> = {};
    rows.forEach((row, i) => {
      if (!dirty.some((d) => d.id === row.id)) return;
      const err = validateDraft(row, {
        codes: catalog,
        others: rows.filter((_, idx) => idx !== i),
      });
      if (err) found[i] = err;
    });
    if (Object.keys(found).length) {
      setErrors(found);
      toast.error(Object.values(found)[0] ?? t("inv.saveItem"));
      return;
    }
    setErrors({});
    setBusy(true);
    const failed: Failures = [];
    const payload: UndoRow[] = [];
    for (const row of targets) {
      const before = originals.find((o) => o.id === row.id);
      const source = catalog.find((p) => p.id === row.id);
      const fieldsChanged = dirty.some((d) => d.id === row.id);
      const colsChanged = moved.some((m) => m.id === row.id);
      // A quantity nobody edited is not rewritten: stock may have moved on
      // another till since this grid was seeded.
      const qtyChanged = fieldsChanged && Number(row.qty || 0) !== Number(before?.qty || 0);
      try {
        if (fieldsChanged) {
          await rpc("save_product", {
            p_store: store?.id ?? null,
            p_id: row.id,
            p_name: sanitizeText(row.name, LIMITS.productName),
            p_sku: normalizeCode(row.sku) || null,
            p_category: source?.category ?? null,
            p_price: Number(row.price || 0),
            p_cost: Number(row.cost || 0),
            p_active: row.active,
            p_reorder_point: row.reorder === "" ? null : Number(row.reorder),
          });
        }
        if (colsChanged) {
          await rpc("set_product_collections", {
            p_product: row.id,
            p_collections: sets[row.id!] ?? [],
          });
        }
        if (qtyChanged && store?.id && row.id) {
          await rpc("set_stock_qty", {
            p_store: store.id,
            p_product: row.id,
            p_qty: Number(row.qty || 0),
            p_reason: "correction",
            p_note: "Bulk edit",
          });
        }
        if (before) {
          payload.push({
            id: row.id!,
            ...(fieldsChanged ? { fields: before } : {}),
            category: source?.category ?? null,
            ...(colsChanged ? { collections: [...membership(row.id!)] } : {}),
            wroteQty: qtyChanged ? Number(row.qty || 0) : null,
          });
        }
      } catch (e) {
        failed.push({ row, message: (e as Error).message });
      }
    }
    invalidateKeys(qc, [["products"], ["stock"], ["movements"], ["collections"], ["dash-alerts"]]);
    setBusy(false);
    if (!failed.length) {
      toast.success(t("inv.savedCount", { count: targets.length }), {
        duration: 15_000,
        action: {
          label: t("till.undo"),
          onClick: () => {
            if (undone.current) return;
            undone.current = true;
            void runUndo(payload);
          },
        },
      });
      nav({ to: "/app/inventory", search: back });
      return;
    }
    // Successful rows leave the grid (they are saved), failures stay editable.
    // Messages are re-indexed against what is left, or they would point at a
    // row that is no longer on the screen.
    const kept = rows.filter((r) => failed.some((f) => f.row.id === r.id));
    const left: Record<number, string> = {};
    failed.forEach((f) => {
      const i = kept.findIndex((r) => r.id === f.row.id);
      if (i >= 0) left[i] = f.message;
    });
    setRows(kept);
    setErrors(left);
    reportFailures(t, targets.length, failed);
  }

  /**
   * Undo runs from the toast, after this screen is gone, so it carries its own
   * payload and re-reads stock rather than trusting the grid's snapshot.
   */
  async function runUndo(list: UndoRow[]) {
    // Read the stock sheet as it stands now: between the save and the undo a
    // till may have sold from these rows, and a recount must not eat that sale.
    await qc.refetchQueries({ queryKey: ["stock"] });
    const now = qc.getQueryData<Record<string, number>>(["stock", store?.id]) ?? {};
    let kept = 0;
    let problem: string | null = null;
    for (const u of list) {
      try {
        if (u.fields) {
          await rpc("save_product", {
            p_store: store?.id ?? null,
            p_id: u.id,
            p_name: sanitizeText(u.fields.name, LIMITS.productName),
            p_sku: normalizeCode(u.fields.sku) || null,
            p_category: u.category,
            p_price: Number(u.fields.price || 0),
            p_cost: Number(u.fields.cost || 0),
            p_active: u.fields.active,
            p_reorder_point: u.fields.reorder === "" ? null : Number(u.fields.reorder),
          });
        }
        if (u.collections) {
          await rpc("set_product_collections", { p_product: u.id, p_collections: u.collections });
        }
        if (u.wroteQty != null) {
          if (Number(now[u.id] ?? 0) === u.wroteQty && store?.id) {
            await rpc("set_stock_qty", {
              p_store: store.id,
              p_product: u.id,
              p_qty: Number(u.fields?.qty || 0),
              p_reason: "correction",
              p_note: "Bulk edit undone",
            });
          } else kept += 1;
        }
      } catch (e) {
        problem ??= (e as Error).message;
      }
    }
    invalidateKeys(qc, [["products"], ["stock"], ["movements"], ["collections"], ["dash-alerts"]]);
    if (problem) toast.error(problem);
    else toast.success(t("inv.undoDone", { count: list.length }));
    if (kept) toast.info(t("inv.undoStockKept", { count: kept }));
  }

  return (
    <>
      <PageHeader
        back={{ to: "/app/inventory", label: t("inv.title"), search: back }}
        title={t("inv.bulkTitle")}
        sub={t("inv.bulkSub")}
      />
      <Card className="max-w-5xl p-0">
        <Table className="min-w-[940px] text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="px-3">{t("common.name")}</TableHead>
              <TableHead>{t("inv.itemCode")}</TableHead>
              <TableHead className="w-28 text-right">{t("inv.costPrice")}</TableHead>
              <TableHead className="w-28 text-right">{t("inv.sellingPrice")}</TableHead>
              <TableHead className="w-24 text-right">{t("inv.quantity")}</TableHead>
              <TableHead className="w-20 text-center">{t("inv.thActive")}</TableHead>
              <TableHead className="w-48">{t("inv.collectionsLabel")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  {products.isFetched && stock.isFetched ? (
                    // Past the first read, an empty grid means the links are stale
                    // (the rows were deleted elsewhere), not that the screen is
                    // still thinking.
                    t("inv.bulkEmpty")
                  ) : (
                    <RowsSkeleton rows={3} className="mx-auto max-w-lg" />
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row, i) => (
              <TableRow key={row.id}>
                <TableCell className="px-3">
                  <Input
                    className="h-8"
                    maxLength={LIMITS.productName}
                    value={row.name}
                    onChange={(e) =>
                      update(i, { name: e.target.value.slice(0, LIMITS.productName) })
                    }
                  />
                  {errors[i] && <p className="mt-1 text-xs text-destructive">{errors[i]}</p>}
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8"
                    maxLength={LIMITS.sku}
                    value={row.sku}
                    onChange={(e) => update(i, { sku: e.target.value.slice(0, LIMITS.sku) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="tabular h-8 text-right"
                    inputMode="decimal"
                    value={row.cost}
                    onChange={(e) => update(i, { cost: amount(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="tabular h-8 text-right"
                    inputMode="decimal"
                    value={row.price}
                    onChange={(e) => update(i, { price: amount(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="tabular h-8 text-right"
                    inputMode="decimal"
                    value={row.qty}
                    onChange={(e) => update(i, { qty: amount(e.target.value) })}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    aria-label={t("inv.availableForSale")}
                    checked={row.active}
                    onCheckedChange={(v) => update(i, { active: v === true })}
                  />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-between gap-1 font-normal"
                        aria-label={t("inv.collectionsLabel")}
                      >
                        <span className="truncate">{namesOf(row.id!) || t("common.none")}</span>
                        <HugeiconsIcon
                          icon={ArrowDown01Icon}
                          className="size-3.5 shrink-0 opacity-60"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 w-52 overflow-y-auto">
                      {(cols.data?.list ?? []).map((c) => (
                        <DropdownMenuCheckboxItem
                          key={c.id}
                          checked={(sets[row.id!] ?? []).includes(c.id)}
                          onCheckedChange={(v) => toggleCollection(row.id!, c.id, v === true)}
                        >
                          {c.name}
                          {c.discount_pct > 0 ? ` −${c.discount_pct}%` : ""}
                        </DropdownMenuCheckboxItem>
                      ))}
                      {(cols.data?.list ?? []).length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          {t("inv.noCollections")}
                        </p>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="mt-4 flex max-w-5xl gap-2">
        <Button className="flex-1" disabled={busy || !rows.length} onClick={() => void save()}>
          {busy ? t("common.saving") : t("inv.saveItem")}
        </Button>
        <Button variant="outline" onClick={() => nav({ to: "/app/inventory", search: back })}>
          {t("common.cancel")}
        </Button>
      </div>
    </>
  );
}
