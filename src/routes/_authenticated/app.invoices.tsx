import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePos } from "@/lib/pos";
import { useSales, useStaffNames, type SaleRow } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, NativeSelect, PageHeader, Status, fmtDate } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/invoices")({ head: () => ({ meta: [{ title: "Invoices — Storq" }, { name: "description", content: "Review and approve store invoices in Storq." }, { property: "og:title", content: "Invoices — Storq" }, { property: "og:description", content: "Review and approve store invoices in Storq." }, { name: "robots", content: "noindex, nofollow" }] }), component: Invoices });

function Invoices() {
  const { store, money, can, rpc, staff } = usePos();
  const qc = useQueryClient();
  const names = useStaffNames();
  const pending = useSales("pending", { storeId: store?.id, statuses: ["pending_approval"] });
  const reviewed = useSales("reviewed", { storeId: store?.id, statuses: ["rejected", "completed", "layby_open", "layby_completed"] });
  const [approving, setApproving] = useState<SaleRow | null>(null);
  const approver = can("admin", "manager");

  async function review(s: SaleRow, approve: boolean, payment = 0, method = "cash") {
    try {
      await rpc("review_invoice", { p_sale: s.id, p_approve: approve, p_payment: payment, p_method: method });
      toast.success(approve ? `Invoice #${s.number} approved` : `Invoice #${s.number} rejected`);
      setApproving(null);
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (store?.store_type !== "approval")
    return (
      <>
        <PageHeader title="Invoices" />
        <Empty>{store?.name} is a direct-sale store — sales complete at the till. Switch to an approval-based store to see invoices.</Empty>
      </>
    );

  return (
    <>
      <PageHeader title="Invoices" sub={approver ? "Approve invoices to release stock and record payment." : "Invoices you and others sent for approval."} />
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">Awaiting approval ({pending.data?.length ?? 0})</h2>
      {pending.data?.length === 0 && <Empty>Nothing waiting.</Empty>}
      <div className="grid gap-2 md:grid-cols-2">
        {pending.data?.map((s) => (
          <div key={s.id} className="pos-card min-w-0 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-bold">#{s.number} {s.kind === "layby" && <span className="text-accent">· Layby</span>}</div>
                <div className="truncate text-xs text-muted-foreground">by {names.data?.[s.created_by ?? ""] ?? "—"} · {fmtDate(s.created_at)}</div>
              </div>
              <div className="tabular shrink-0 text-base font-extrabold">{money(s.total)}</div>
            </div>
            <ul className="mt-2.5 space-y-1 text-[13px]">
              {s.sale_items.map((i, k) => (
                <li key={k} className="flex justify-between"><span>{i.qty} × {i.name}</span><span className="tabular text-muted-foreground">{money(i.qty * i.price)}</span></li>
              ))}
            </ul>
            {(s.customer_name || s.note) && (
              <p className="mt-2.5 rounded-lg bg-secondary p-2 text-xs">{s.customer_name && <b>{s.customer_name} {s.customer_phone} </b>}{s.note}</p>
            )}
            {approver && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => review(s, false)}>Reject</Button>
                <Button size="sm" variant="success" className="flex-1" disabled={s.created_by === staff?.id && staff?.role !== "admin"} onClick={() => setApproving(s)}>Approve</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-muted-foreground">Recently reviewed</h2>
      <div className="pos-card divide-y">
        {reviewed.data?.filter((s) => s.approved_by).slice(0, 30).map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <span className="w-14 shrink-0 font-bold">#{s.number}</span>
            <Status s={s.status} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">by {names.data?.[s.approved_by ?? ""]} · {s.approved_at && fmtDate(s.approved_at)}</span>
            <span className="tabular shrink-0 font-semibold">{money(s.total)}</span>
          </div>
        ))}
        {!reviewed.data?.some((s) => s.approved_by) && <p className="p-4 text-center text-sm text-muted-foreground">None yet.</p>}
      </div>

      {approving && <ApproveDialog s={approving} onClose={() => setApproving(null)} onApprove={(p, m) => review(approving, true, p, m)} />}
    </>
  );
}

function ApproveDialog({ s, onClose, onApprove }: { s: SaleRow; onClose: () => void; onApprove: (p: number, m: string) => void }) {
  const { money } = usePos();
  const [method, setMethod] = useState("cash");
  const [dep, setDep] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Approve invoice #{s.number}</DialogTitle></DialogHeader>
        <div className="tabular text-center text-xl font-extrabold">{money(s.total)}</div>
        <Field label="Payment method">
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="mobile">Mobile money</option><option value="account">On account / EFT</option>
          </NativeSelect>
        </Field>
        {s.kind === "layby" && <Field label="Deposit received"><Input inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} /></Field>}
        <Button variant="success" onClick={() => onApprove(s.kind === "layby" ? Number(dep || 0) : s.total, method)}>Approve & release stock</Button>
      </DialogContent>
    </Dialog>
  );
}
