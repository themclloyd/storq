import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, PlusSignIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { useProducts, useStock } from "@/lib/products";
import { useTransferMutations, useTransfers, type Transfer } from "@/lib/transfers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  Field,
  NativeSelect,
  NoAccess,
  PageHeader,
  Pager,
  fmtDate,
} from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { pageSlice } from "@/lib/paging";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/transfers")({
  head: () => ({
    meta: [
      { title: "Stock transfers | Storq" },
      {
        name: "description",
        content: "Move stock directly between your stores.",
      },
      { property: "og:title", content: "Stock transfers | Storq" },
      {
        property: "og:description",
        content: "Move stock directly between your stores.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Transfers,
});

type Draft = { product_id: string; name: string; qty: string };

// Transfer history is a stored code; only its display label is localized.
// New moves complete atomically, so only received/cancelled rows exist.
const TRF_STATUS_KEYS: Record<Transfer["status"], string> = {
  received: "trf.statusReceived",
  cancelled: "trf.statusCancelled",
};

function Transfers() {
  const { store, stores, can } = usePos();
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const transfers = useTransfers(store?.id);
  const muts = useTransferMutations();
  if (!can("stock", "view_stock")) return <NoAccess />;
  // History is readable; starting a move is a stock change.
  const canEdit = can("stock");
  const { pageCount, page: curPage, rows: pageRows } = pageSlice(transfers.data ?? [], page);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? t("trf.storeWord");

  return (
    <>
      <PageHeader
        title={t("trf.title")}
        sub={t("trf.sub", { store: store?.name ?? t("trf.yourStore") })}
        actions={
          !canEdit || stores.length < 2 ? undefined : (
            <Button onClick={() => setCreating(true)}>
              <HugeiconsIcon icon={PlusSignIcon} /> {t("trf.newTransfer")}
            </Button>
          )
        }
      />
      {canEdit && stores.length < 2 && <Empty>{t("trf.needSecond")}</Empty>}
      {transfers.isPending ? (
        <p className="text-sm text-muted-foreground">{t("trf.loading")}</p>
      ) : (transfers.data?.length ?? 0) === 0 ? (
        <Empty>{t(canEdit ? "trf.none" : "common.none")}</Empty>
      ) : (
        <>
          <div className="space-y-2">
            {pageRows.map((tr) => (
              <TransferRow key={tr.id} transfer={tr} storeName={storeName} />
            ))}
          </div>
          <Pager
            page={curPage}
            pageCount={pageCount}
            total={transfers.data?.length ?? 0}
            onPage={setPage}
          />
        </>
      )}
      {creating && store && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const statusTone: Record<Transfer["status"], string> = {
  received: "bg-success-soft text-success",
  cancelled: "bg-destructive-soft text-destructive",
};

function TransferRow({
  transfer,
  storeName,
}: {
  transfer: Transfer;
  storeName: (id: string) => string;
}) {
  const { t } = useI18n();
  const units = transfer.stock_transfer_lines.reduce((a, l) => a + l.qty, 0);
  return (
    <div className="pos-card p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {t("trf.transferNumber", { number: transfer.number })}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            statusTone[transfer.status],
          )}
        >
          {t(TRF_STATUS_KEYS[transfer.status])}
        </span>
        <span className="ml-auto text-muted-foreground">{fmtDate(transfer.created_at)}</span>
      </div>
      <div className="mt-1 text-muted-foreground">
        {storeName(transfer.from_store)} <span aria-hidden>→</span> {storeName(transfer.to_store)} ·{" "}
        {units} {units === 1 ? t("trf.unitWord") : t("trf.unitsWord")} {t("trf.acrossWord")}{" "}
        {transfer.stock_transfer_lines.length}{" "}
        {transfer.stock_transfer_lines.length === 1 ? t("trf.itemWord") : t("trf.itemsWord")}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {transfer.stock_transfer_lines.map((l) => (
          <span key={l.id}>
            {l.name} × {l.qty}
          </span>
        ))}
      </div>
      {transfer.note && <div className="mt-1.5 text-xs italic">{transfer.note}</div>}
      {transfer.status === "received" && transfer.received_at && (
        <div className="mt-1.5 text-xs text-muted-foreground">
          {t("trf.receivedWord")} {fmtDate(transfer.received_at)}
        </div>
      )}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { store, stores } = usePos();
  const { t } = useI18n();
  const others = stores.filter((s) => s.id !== store?.id);
  const [from, setFrom] = useState(store?.id ?? "");
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q);
  const [draft, setDraft] = useState<Draft[]>([]);
  // The picker lists the SOURCE store's own catalog: moves can only draw down
  // items the origin store actually owns. The destination copy is created
  // server-side in the same transaction that books the move.
  const products = useProducts(from || undefined);
  const stock = useStock(from || undefined);
  const muts = useTransferMutations(onClose);

  const fromName = (id: string) => stores.find((s) => s.id === id)?.name ?? t("trf.storeWord");
  const list = (products.data ?? []).filter((p) => p.active);
  const shown = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    return needle
      ? list.filter(
          (p) => p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle),
        )
      : list.slice(0, 20);
  }, [list, dq]);

  const inDraft = (id: string) => draft.some((d) => d.product_id === id);
  const add = (id: string, name: string) =>
    setDraft((d) =>
      d.some((x) => x.product_id === id) ? d : [...d, { product_id: id, name, qty: "1" }],
    );
  const setQty = (id: string, qty: string) =>
    setDraft((d) => d.map((x) => (x.product_id === id ? { ...x, qty } : x)));
  const remove = (id: string) => setDraft((d) => d.filter((x) => x.product_id !== id));

  const valid =
    from && to && from !== to && draft.length > 0 && draft.every((d) => Number(d.qty) > 0);

  async function move() {
    if (!valid) return;
    if (from === to) {
      toast.error(t("trf.pickTwo"));
      return;
    }
    try {
      await muts.mutateAsync({
        action: "create_transfer",
        args: {
          p_from: from,
          p_to: to,
          p_note: note.trim() || null,
          p_items: draft.map((d) => ({ product_id: d.product_id, qty: Number(d.qty) })),
        },
      });
      toast.success(t("trf.movedToast"));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("trf.newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("trf.fromStore")}>
            <NativeSelect
              value={from}
              onChange={setFrom}
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
          <Field label={t("trf.toStore")}>
            <NativeSelect
              value={to}
              onChange={setTo}
              options={stores
                .filter((s) => s.id !== from)
                .map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
        </div>
        {from === to && (
          <p className="text-xs font-medium text-destructive">{t("trf.chooseTwo")}</p>
        )}

        <Field label={t("trf.addItems")}>
          <Input placeholder={t("trf.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <div className="max-h-40 overflow-auto rounded-md border">
          {shown.map((p) => {
            const have = stock.data?.[p.id] ?? 0;
            return (
              <button
                key={p.id}
                type="button"
                disabled={inDraft(p.id)}
                onClick={() => add(p.id, p.name)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px]",
                  inDraft(p.id) ? "cursor-default opacity-50" : "hover:bg-secondary",
                )}
              >
                <span className="min-w-0 truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {fromName(from)}: {have}
                </span>
              </button>
            );
          })}
          {shown.length === 0 && (
            <p className="p-3 text-center text-xs text-muted-foreground">{t("trf.noMatch")}</p>
          )}
        </div>

        {draft.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {t("trf.transferring")}
            </span>
            {draft.map((d) => (
              <div key={d.product_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.name}</span>
                <Input
                  inputMode="decimal"
                  aria-label={t("trf.qtyFor", { name: d.name })}
                  className="tabular h-8 w-20 text-right"
                  value={d.qty}
                  onChange={(e) => setQty(d.product_id, e.target.value.replace(/[^0-9.]/g, ""))}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={t("trf.removeFor", { name: d.name })}
                  onClick={() => remove(d.product_id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Field label={t("trf.noteOptional")}>
          <Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || muts.isPending} onClick={() => void move()}>
            {t("trf.moveCta")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
