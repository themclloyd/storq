import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useProducts, useStock } from "@/lib/products";
import {
  TRANSFER_STATUS_LABELS,
  useTransferMutations,
  useTransfers,
  type Transfer,
} from "@/lib/transfers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, NativeSelect, PageHeader, fmtDate } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/transfers")({
  head: () => ({
    meta: [
      { title: "Stock transfers — Storq" },
      {
        name: "description",
        content: "Move stock between your stores and track it in transit.",
      },
      { property: "og:title", content: "Stock transfers — Storq" },
      {
        property: "og:description",
        content: "Move stock between your stores and track it in transit.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Transfers,
});

type Draft = { product_id: string; name: string; qty: string };

function Transfers() {
  const { store, stores, can } = usePos();
  const [creating, setCreating] = useState(false);
  const transfers = useTransfers(store?.id);
  const muts = useTransferMutations();
  if (!can("admin", "manager"))
    return <Empty>Only admins and managers can move stock between stores.</Empty>;
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "Store";
  const acting = muts.isPending;

  async function act(action: "receive_transfer" | "cancel_transfer", id: string) {
    if (
      action === "cancel_transfer" &&
      !confirm("Cancel this transfer? The stock goes back to the sending store.")
    )
      return;
    try {
      await muts.mutateAsync({ action, args: { p_id: id } });
      toast.success(action === "receive_transfer" ? "Stock received" : "Transfer cancelled");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Stock transfers"
        sub={`Dispatch stock out of ${store?.name ?? "your store"} and receive it at the destination.`}
        actions={
          stores.length < 2 ? undefined : (
            <Button variant="accent" onClick={() => setCreating(true)}>
              <HugeiconsIcon icon={PlusSignIcon} /> New transfer
            </Button>
          )
        }
      />
      {stores.length < 2 && (
        <Empty>
          Add a second location under Settings before you can transfer stock between stores.
        </Empty>
      )}
      {transfers.isPending ? (
        <p className="text-sm text-muted-foreground">Loading transfers…</p>
      ) : (transfers.data?.length ?? 0) === 0 ? (
        <Empty>No transfers yet.</Empty>
      ) : (
        <div className="space-y-2">
          {transfers.data!.map((t) => (
            <TransferRow
              key={t.id}
              t={t}
              storeName={storeName}
              canReceive={store?.id === t.to_store}
              busy={acting}
              onReceive={() => void act("receive_transfer", t.id)}
              onCancel={() => void act("cancel_transfer", t.id)}
            />
          ))}
        </div>
      )}
      {creating && store && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const statusTone: Record<Transfer["status"], string> = {
  in_transit: "bg-accent/15 text-accent",
  received: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

function TransferRow({
  t,
  storeName,
  canReceive,
  busy,
  onReceive,
  onCancel,
}: {
  t: Transfer;
  storeName: (id: string) => string;
  canReceive: boolean;
  busy: boolean;
  onReceive: () => void;
  onCancel: () => void;
}) {
  const units = t.stock_transfer_lines.reduce((a, l) => a + l.qty, 0);
  return (
    <div className="pos-card p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">Transfer #{t.number}</span>
        <span
          className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", statusTone[t.status])}
        >
          {TRANSFER_STATUS_LABELS[t.status]}
        </span>
        <span className="ml-auto text-muted-foreground">{fmtDate(t.created_at)}</span>
      </div>
      <div className="mt-1 text-muted-foreground">
        {storeName(t.from_store)} <span aria-hidden>→</span> {storeName(t.to_store)} · {units} unit
        {units === 1 ? "" : "s"} across {t.stock_transfer_lines.length} item
        {t.stock_transfer_lines.length === 1 ? "" : "s"}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {t.stock_transfer_lines.map((l) => (
          <span key={l.id}>
            {l.name} × {l.qty}
          </span>
        ))}
      </div>
      {t.note && <div className="mt-1.5 text-xs italic">{t.note}</div>}
      {t.status === "in_transit" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canReceive && (
            <Button size="sm" variant="success" disabled={busy} onClick={onReceive}>
              Receive at {storeName(t.to_store)}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {t.status === "received" && t.received_at && (
        <div className="mt-1.5 text-xs text-muted-foreground">
          Received {fmtDate(t.received_at)}
        </div>
      )}
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { store, stores } = usePos();
  const products = useProducts();
  const others = stores.filter((s) => s.id !== store?.id);
  const [from, setFrom] = useState(store?.id ?? "");
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft[]>([]);
  const stock = useStock(from || undefined);
  const muts = useTransferMutations(onClose);

  const fromName = (id: string) => stores.find((s) => s.id === id)?.name ?? "Store";
  const list = (products.data ?? []).filter((p) => p.active);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter(
          (p) => p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle),
        )
      : list.slice(0, 20);
  }, [list, q]);

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

  async function dispatch() {
    if (!valid) return;
    if (from === to) {
      toast.error("Pick two different stores");
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
      toast.success("Stock dispatched — now in transit");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New stock transfer</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From store">
            <NativeSelect
              value={from}
              onChange={setFrom}
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
          <Field label="To store">
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
          <p className="text-xs font-medium text-destructive">Choose two different stores.</p>
        )}

        <Field label="Add items">
          <Input
            placeholder="Search by name or SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
            <p className="p-3 text-center text-xs text-muted-foreground">No matching items.</p>
          )}
        </div>

        {draft.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Transferring</span>
            {draft.map((d) => (
              <div key={d.product_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.name}</span>
                <Input
                  inputMode="decimal"
                  aria-label={`Quantity for ${d.name}`}
                  className="tabular h-8 w-20 text-right"
                  value={d.qty}
                  onChange={(e) => setQty(d.product_id, e.target.value.replace(/[^0-9.]/g, ""))}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => remove(d.product_id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Field label="Note (optional)">
          <Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!valid || muts.isPending}
            onClick={() => void dispatch()}
          >
            Dispatch stock
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
