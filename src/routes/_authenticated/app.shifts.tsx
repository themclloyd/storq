import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { downloadPdf } from "@/lib/pdf";
import { useStaffNames } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, PageHeader, Status, fmtDate } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/shifts")({
  head: () => ({ meta: [{ title: "Cash drawer — Storq" }, { name: "description", content: "Open and close till shifts and reconcile counted cash." }, { property: "og:title", content: "Cash drawer — Storq" }, { property: "og:description", content: "Open and close till shifts and reconcile counted cash." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Shifts,
});

type Shift = {
  id: string; store_id: string; status: string; opened_by: string | null; opened_at: string; opening_float: number;
  closed_by: string | null; closed_at: string | null; expected_cash: number | null; counted_cash: number | null; variance: number | null;
  summary: Summary | null; notes: string | null;
};
type Summary = {
  opening_float: number; cash_sales: number; by_method: Record<string, number>; transactions: number; cash_refunds: number;
  cash_in: number; cash_out: number; till_expenses: number; expected_cash: number; counted_cash?: number; variance?: number;
};

function Shifts() {
  const { store, rpc, money, can } = usePos();
  const qc = useQueryClient();
  const names = useStaffNames();
  const shifts = useQuery({
    queryKey: ["shifts", store?.id],
    enabled: !!store,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("cash_shifts").select("*").eq("store_id", store!.id).order("opened_at", { ascending: false }).limit(60);
      if (error) throw error;
      return data as Shift[];
    },
  });
  const open = shifts.data?.find((s) => s.status === "open");
  const live = useQuery({
    queryKey: ["shift-summary", open?.id],
    enabled: !!open,
    refetchInterval: 30000,
    queryFn: () => rpc<Summary>("get_shift_summary", { p_shift: open!.id }),
  });
  const [float, setFloat] = useState("");
  const [move, setMove] = useState<null | "in" | "out">(null);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<Shift | null>(null);

  async function openShift() {
    try { await rpc("open_shift", { p_store: store!.id, p_float: Number(float || 0), p_notes: null }); toast.success("Shift opened"); setFloat(""); invalidateKeys(qc, [["shifts"], ["shift-summary"]]); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="Cash drawer" sub={store?.name ?? ""} />
      {!open ? (
        <div className="pos-card mb-4 max-w-md space-y-3 p-4">
          <div><h3 className="text-sm font-bold">Open a shift</h3><p className="text-[13px] text-muted-foreground">Count the cash in the drawer before you start selling.</p></div>
          <Field label="Starting cash (float)"><Input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" /></Field>
          <Button variant="accent" className="w-full" onClick={openShift}>Open shift</Button>
        </div>
      ) : (
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <div className="pos-card min-w-0 p-4 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shift open</div>
                <div className="truncate text-[13px] text-muted-foreground">Since {fmtDate(open.opened_at)} · {names.data?.[open.opened_by ?? ""]}</div>
              </div>
              <Status s="open" />
            </div>
            <div className="mt-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash expected in drawer</div>
            <div className="tabular truncate text-xl font-extrabold">{money(live.data?.expected_cash ?? open.opening_float)}</div>
            {live.data && <div className="mt-2.5"><SummaryRows s={live.data} money={money} /></div>}
          </div>
          <div className="pos-card space-y-1.5 p-4">
            <h3 className="text-sm font-bold">Drawer actions</h3>
            <Button variant="outline" className="w-full" onClick={() => setMove("in")}>Cash in (add change)</Button>
            <Button variant="outline" className="w-full" onClick={() => setMove("out")}>Cash out (drop / payout)</Button>
            <Button variant="default" className="w-full" onClick={() => setClosing(true)}>Close shift & count</Button>
          </div>
        </div>
      )}

      <h3 className="mb-2.5 text-sm font-bold">Past shifts</h3>
      {(shifts.data ?? []).filter((s) => s.status === "closed").length === 0 ? <Empty>No closed shifts yet.</Empty> : (
        <div className="pos-card divide-y">
          {(shifts.data ?? []).filter((s) => s.status === "closed").map((s) => (
            <button key={s.id} onClick={() => setReport(s)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-secondary/60">
              <span className="w-36 shrink-0 text-muted-foreground">{fmtDate(s.opened_at)}</span>
              <span className="min-w-0 flex-1 truncate">{names.data?.[s.closed_by ?? ""]}</span>
              <span className="tabular shrink-0">Expected {money(s.expected_cash)}</span>
              <span className="tabular shrink-0">Counted {money(s.counted_cash)}</span>
              <Variance v={Number(s.variance)} money={money} />
            </button>
          ))}
        </div>
      )}
      {move && open && <MoveDialog kind={move} shift={open.id} onClose={() => setMove(null)} />}
      {closing && open && <CloseDialog shift={open} expected={live.data?.expected_cash ?? 0} onClose={() => setClosing(false)} onDone={(s) => { setClosing(false); setReport(s); }} />}
      {report && <ZReport s={report} names={names.data ?? {}} onClose={() => setReport(null)} />}
      {!can("admin", "manager") && <p className="mt-4 text-xs text-muted-foreground">Managers see all shift history and variances.</p>}
    </>
  );
}

function Variance({ v, money }: { v: number; money: (n: number) => string }) {
  const label = Math.abs(v) < 0.01 ? "Balanced" : v > 0 ? `Over ${money(v)}` : `Short ${money(-v)}`;
  return <span className={cn("w-32 text-right font-semibold", Math.abs(v) < 0.01 ? "text-success" : v > 0 ? "text-accent" : "text-destructive")}>{label}</span>;
}

function SummaryRows({ s, money }: { s: Summary; money: (n: number) => string }) {
  const rows: [string, number, boolean?][] = [
    ["Starting float", s.opening_float],
    ["Cash sales & layby payments", s.cash_sales],
    ["Cash refunds", -s.cash_refunds],
    ["Cash in", s.cash_in],
    ["Cash out", -s.cash_out],
    ["Expenses paid from till", -s.till_expenses],
    ["Expected cash", s.expected_cash, true],
  ];
  return (
    <div className="space-y-1 text-[13px]">
      {rows.map(([k, v, b]) => (
        <div key={k} className={cn("flex justify-between gap-3", b && "border-t pt-2 font-bold")}><span className="truncate text-muted-foreground">{k}</span><span className="tabular shrink-0">{money(v)}</span></div>
      ))}
      {Object.keys(s.by_method ?? {}).length > 0 && (
        <div className="pt-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">All takings by method · {s.transactions} sales</div>
          {Object.entries(s.by_method).map(([m, v]) => <div key={m} className="flex justify-between gap-3 capitalize"><span className="truncate text-muted-foreground">{m}</span><span className="tabular shrink-0">{money(v)}</span></div>)}
        </div>
      )}
    </div>
  );
}

function MoveDialog({ kind, shift, onClose }: { kind: "in" | "out"; shift: string; onClose: () => void }) {
  const { rpc } = usePos();
  const qc = useQueryClient();
  const [amt, setAmt] = useState(""); const [reason, setReason] = useState("");
  async function save() {
    try { await rpc("cash_move", { p_shift: shift, p_kind: kind, p_amount: Number(amt), p_reason: reason }); toast.success("Recorded"); invalidateKeys(qc, [["shifts"], ["shift-summary"]]); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{kind === "in" ? "Cash in" : "Cash out"}</DialogTitle></DialogHeader>
        <Field label="Amount"><Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "in" ? "Added change" : "Cash drop to safe"} /></Field>
        <Button disabled={!Number(amt) || !reason.trim()} onClick={save}>Save</Button>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ shift, expected, onClose, onDone }: { shift: Shift; expected: number; onClose: () => void; onDone: (s: Shift) => void }) {
  const { rpc } = usePos();
  const qc = useQueryClient();
  const [counted, setCounted] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const sm = await rpc<Summary>("close_shift", { p_shift: shift.id, p_counted: Number(counted), p_notes: notes });
      invalidateKeys(qc, [["shifts"], ["shift-summary"]]);
      onDone({ ...shift, status: "closed", closed_at: new Date().toISOString(), summary: sm, expected_cash: sm.expected_cash, counted_cash: Number(counted), variance: sm.variance ?? 0, notes });
    } catch (e) { toast.error((e as Error).message); setBusy(false); }
  }
  void expected;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Close shift</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Count every note and coin in the drawer and enter the total. You will see the difference after closing.</p>
        <Field label="Cash counted"><Input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
        <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button disabled={busy || counted === ""} onClick={save}>Close shift</Button>
      </DialogContent>
    </Dialog>
  );
}

function ZReport({ s, names, onClose }: { s: Shift; names: Record<string, string>; onClose: () => void }) {
  const { money, business, stores } = usePos();
  const sm = s.summary;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>End of shift report</DialogTitle></DialogHeader>
        <div id="zreport" className="space-y-2 text-[13px]">
          <div className="text-center"><div className="font-bold">{business?.name}</div><div className="text-muted-foreground">{stores.find((x) => x.id === s.store_id)?.name}</div></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Opened</span><span>{fmtDate(s.opened_at)} · {names[s.opened_by ?? ""]}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Closed</span><span>{s.closed_at && fmtDate(s.closed_at)} · {names[s.closed_by ?? ""] ?? ""}</span></div>
          {sm && <SummaryRows s={sm} money={money} />}
          <div className="flex justify-between border-t pt-2 font-bold"><span>Cash counted</span><span className="tabular">{money(s.counted_cash)}</span></div>
          <div className="flex justify-between font-bold"><span>Difference</span><Variance v={Number(s.variance)} money={money} /></div>
          {s.notes && <p className="text-muted-foreground">Notes: {s.notes}</p>}
        </div>
        <Button variant="outline" onClick={() => {
          const v = Number(s.variance);
          void downloadPdf({
            filename: `storq-shift-${(s.closed_at ?? s.opened_at).slice(0, 10)}`, title: "End of shift report", business: business?.name,
            subtitle: stores.find((x) => x.id === s.store_id)?.name, badge: Math.abs(v) < 0.01 ? "BALANCED" : v > 0 ? "OVER" : "SHORT",
            meta: [["Opened", `${fmtDate(s.opened_at)} · ${names[s.opened_by ?? ""] ?? ""}`], ["Closed", s.closed_at ? `${fmtDate(s.closed_at)} · ${names[s.closed_by ?? ""] ?? ""}` : "Open"]],
            kpis: [["Expected cash", money(s.expected_cash ?? sm?.expected_cash ?? 0)], ["Counted", money(s.counted_cash)], ["Difference", money(v)]],
            sections: [
              ...(sm ? [{ type: "pairs" as const, heading: "Cash drawer", rows: [["Starting float", money(sm.opening_float)], ["Cash sales & layby payments", money(sm.cash_sales)], ["Cash refunds", `-${money(sm.cash_refunds)}`], ["Cash in", money(sm.cash_in)], ["Cash out", `-${money(sm.cash_out)}`], ["Expenses paid from till", `-${money(sm.till_expenses)}`], ["Expected cash", money(sm.expected_cash)]] as [string, string][] },
                { type: "pairs" as const, heading: `Takings by method · ${sm.transactions} sales`, rows: Object.entries(sm.by_method ?? {}).map(([m, x]) => [m, money(x)] as [string, string]) }] : []),
              ...(s.notes ? [{ type: "text" as const, heading: "Notes", text: s.notes }] : []),
            ],
            footerNote: "Counted by: ____________________      Checked by: ____________________",
          });
        }}>Download PDF</Button>
      </DialogContent>
    </Dialog>
  );
}
