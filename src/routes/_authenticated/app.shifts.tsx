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
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/shifts")({
  head: () => ({
    meta: [
      { title: "Cash drawer | Storq" },
      { name: "description", content: "Open and close till shifts and reconcile counted cash." },
      { property: "og:title", content: "Cash drawer | Storq" },
      {
        property: "og:description",
        content: "Open and close till shifts and reconcile counted cash.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Shifts,
});

type Shift = {
  id: string;
  store_id: string;
  status: string;
  opened_by: string | null;
  opened_at: string;
  opening_float: number;
  closed_by: string | null;
  closed_at: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  summary: Summary | null;
  notes: string | null;
};
type Summary = {
  opening_float: number;
  cash_sales: number;
  by_method: Record<string, number>;
  transactions: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  till_expenses: number;
  expected_cash: number;
  counted_cash?: number;
  variance?: number;
};

function Shifts() {
  const { store, rpc, money, can, staff } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const names = useStaffNames();
  const shifts = useQuery({
    queryKey: ["shifts", store?.id],
    enabled: !!store,
    // The list is invalidated explicitly on open/record/close, so it can stay
    // cached across mounts; the live figures come from the polled summary.
    staleTime: 300_000,
    queryFn: async () => {
      // cash_shifts predates type regeneration — read via any-cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("cash_shifts")
        .select("*")
        .eq("store_id", store!.id)
        .order("opened_at", { ascending: false })
        .limit(60);
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
  const [floatOpen, setFloatOpen] = useState(false);
  const [report, setReport] = useState<Shift | null>(null);

  async function openShift() {
    try {
      await rpc("open_shift", { p_store: store!.id, p_float: Number(float || 0), p_notes: null });
      toast.success(t("shift.openedToast"));
      setFloat("");
      invalidateKeys(qc, [["shifts"], ["drawer"], ["shift-summary"]]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // The drawer opens itself on the first sale, so the only state worth
  // shouting about is one that has been left open since before today — that is
  // yesterday's cash sitting in today's expected amount.
  const stale = !!open && new Date(open.opened_at).toDateString() !== new Date().toDateString();
  // The seller who opened the drawer (or a manager) may correct the float that
  // was in the till before the first sale.
  const canSetFloat = !!open && (can("admin", "manager") || open.opened_by === staff?.id);

  return (
    <>
      <PageHeader title={t("shift.title")} sub={store?.name ?? ""} />
      {!open ? (
        <div className="pos-card mb-4 max-w-md space-y-3 p-4">
          <div>
            <h3 className="font-display text-sm font-medium">{t("shift.openTitle")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("shift.openHint")}</p>
          </div>
          <Field label={t("shift.startingFloat")}>
            <Input
              inputMode="decimal"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Button className="w-full" onClick={openShift}>
            {t("shift.openBtn")}
          </Button>
        </div>
      ) : (
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <div className="pos-card min-w-0 p-4 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("shift.openLabel")}
                </div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {t("shift.sinceWord")} {fmtDate(open.opened_at)} ·{" "}
                  {names.data?.[open.opened_by ?? ""]}
                </div>
              </div>
              <Status s="open" />
            </div>
            {stale && (
              <p className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] font-medium text-warning-foreground">
                {t("shift.staleNote", { date: fmtDate(open.opened_at) })}
              </p>
            )}
            <div className="mt-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("shift.cashExpected")}
            </div>
            <div className="font-display tabular truncate text-xl font-medium">
              {money(live.data?.expected_cash ?? open.opening_float)}
            </div>
            {live.data && (
              <div className="mt-2.5">
                <SummaryRows s={live.data} money={money} />
              </div>
            )}
          </div>
          <div className="pos-card space-y-1.5 p-4">
            <h3 className="font-display text-sm font-medium">{t("shift.drawerActions")}</h3>
            <Button variant="outline" className="w-full" onClick={() => setMove("in")}>
              {t("shift.cashInAdd")}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setMove("out")}>
              {t("shift.cashOutDrop")}
            </Button>
            <Button variant="default" className="w-full" onClick={() => setClosing(true)}>
              {t("shift.closeCount")}
            </Button>
            {canSetFloat && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setFloatOpen(true)}
              >
                {t("shift.editFloat")}
              </Button>
            )}
          </div>
        </div>
      )}

      <h3 className="font-display mb-2.5 text-sm font-medium">{t("shift.past")}</h3>
      {(shifts.data ?? []).filter((s) => s.status === "closed").length === 0 ? (
        <Empty>{t("shift.noneClosed")}</Empty>
      ) : (
        <div className="pos-card divide-y">
          {(shifts.data ?? [])
            .filter((s) => s.status === "closed")
            .map((s) => (
              <button
                key={s.id}
                onClick={() => setReport(s)}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-muted"
              >
                <span className="w-36 shrink-0 text-muted-foreground">{fmtDate(s.opened_at)}</span>
                <span className="min-w-0 flex-1 truncate">{names.data?.[s.closed_by ?? ""]}</span>
                <span className="tabular shrink-0">
                  {t("shift.expectedWord")} {money(s.expected_cash)}
                </span>
                <span className="tabular shrink-0">
                  {t("shift.countedWord")} {money(s.counted_cash)}
                </span>
                <Variance v={Number(s.variance)} money={money} />
              </button>
            ))}
        </div>
      )}
      {move && open && <MoveDialog kind={move} shift={open.id} onClose={() => setMove(null)} />}
      {floatOpen && open && (
        <FloatDialog
          shift={open.id}
          current={open.opening_float}
          onClose={() => setFloatOpen(false)}
        />
      )}
      {closing && open && (
        <CloseDialog
          shift={open}
          expected={live.data?.expected_cash ?? 0}
          onClose={() => setClosing(false)}
          onDone={(s) => {
            setClosing(false);
            setReport(s);
          }}
        />
      )}
      {report && <ZReport s={report} names={names.data ?? {}} onClose={() => setReport(null)} />}
      {!can("admin", "manager") && (
        <p className="mt-4 text-xs text-muted-foreground">{t("shift.managerNote")}</p>
      )}
    </>
  );
}

function Variance({ v, money }: { v: number; money: (n: number) => string }) {
  const { t } = useI18n();
  const label =
    Math.abs(v) < 0.01
      ? t("shift.balanced")
      : v > 0
        ? t("shift.over", { amount: money(v) })
        : t("shift.short", { amount: money(-v) });
  return (
    <span
      className={cn(
        "w-32 text-right font-semibold",
        Math.abs(v) < 0.01 ? "text-success" : v > 0 ? "text-success" : "text-destructive",
      )}
    >
      {label}
    </span>
  );
}

function SummaryRows({ s, money }: { s: Summary; money: (n: number) => string }) {
  const { t } = useI18n();
  const rows: [string, number, boolean?][] = [
    [t("shift.rowStartingFloat"), s.opening_float],
    [t("shift.rowCashSales"), s.cash_sales],
    [t("shift.rowCashRefunds"), -s.cash_refunds],
    [t("shift.cashIn"), s.cash_in],
    [t("shift.cashOut"), -s.cash_out],
    [t("shift.rowExpenses"), -s.till_expenses],
    [t("shift.rowExpectedCash"), s.expected_cash, true],
  ];
  return (
    <div className="space-y-1 text-[13px]">
      {rows.map(([k, v, b]) => (
        <div
          key={k}
          className={cn("flex justify-between gap-3", b && "border-t pt-2 font-semibold")}
        >
          <span className="truncate text-muted-foreground">{k}</span>
          <span className="tabular shrink-0">{money(v)}</span>
        </div>
      ))}
      {Object.keys(s.by_method ?? {}).length > 0 && (
        <div className="pt-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("shift.allTakings", { count: s.transactions })}
          </div>
          {Object.entries(s.by_method).map(([m, v]) => (
            <div key={m} className="flex justify-between gap-3 capitalize">
              <span className="truncate text-muted-foreground">{m}</span>
              <span className="tabular shrink-0">{money(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MoveDialog({
  kind,
  shift,
  onClose,
}: {
  kind: "in" | "out";
  shift: string;
  onClose: () => void;
}) {
  const { rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [amt, setAmt] = useState("");
  const [reason, setReason] = useState("");
  async function save() {
    try {
      await rpc("cash_move", {
        p_shift: shift,
        p_kind: kind,
        p_amount: Number(amt),
        p_reason: reason,
      });
      toast.success(t("shift.recorded"));
      invalidateKeys(qc, [["shifts"], ["drawer"], ["shift-summary"]]);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "in" ? t("shift.cashIn") : t("shift.cashOut")}</DialogTitle>
        </DialogHeader>
        <Field label={t("doc.amount")}>
          <Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </Field>
        <Field label={t("shift.reason")}>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={kind === "in" ? t("shift.reasonIn") : t("shift.reasonOut")}
          />
        </Field>
        <Button disabled={!Number(amt) || !reason.trim()} onClick={save}>
          {t("common.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function FloatDialog({
  shift,
  current,
  onClose,
}: {
  shift: string;
  current: number;
  onClose: () => void;
}) {
  const { rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [amt, setAmt] = useState(String(current ?? ""));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await rpc("set_shift_float", { p_shift: shift, p_float: Number(amt || 0) });
      toast.success(t("shift.floatSaved"));
      invalidateKeys(qc, [["shifts"], ["drawer"], ["shift-summary"]]);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shift.editFloat")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("shift.floatHint")}</p>
        <Field label={t("shift.startingFloat")}>
          <Input
            autoFocus
            inputMode="decimal"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />
        </Field>
        <Button disabled={busy || amt === ""} onClick={save}>
          {t("common.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  shift,
  expected,
  onClose,
  onDone,
}: {
  shift: Shift;
  expected: number;
  onClose: () => void;
  onDone: (s: Shift) => void;
}) {
  const { rpc } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const sm = await rpc<Summary>("close_shift", {
        p_shift: shift.id,
        p_counted: Number(counted),
        p_notes: notes,
      });
      invalidateKeys(qc, [["shifts"], ["drawer"], ["shift-summary"]]);
      onDone({
        ...shift,
        status: "closed",
        closed_at: new Date().toISOString(),
        summary: sm,
        expected_cash: sm.expected_cash,
        counted_cash: Number(counted),
        variance: sm.variance ?? 0,
        notes,
      });
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  void expected;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shift.closeShift")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("shift.closeHint")}</p>
        <Field label={t("shift.cashCounted")}>
          <Input
            autoFocus
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </Field>
        <Field label={t("shift.notesOptional")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button disabled={busy || counted === ""} onClick={save}>
          {t("shift.closeShift")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ZReport({
  s,
  names,
  onClose,
}: {
  s: Shift;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const { money, business, stores } = usePos();
  const { t } = useI18n();
  const sm = s.summary;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("shift.reportTitle")}</DialogTitle>
        </DialogHeader>
        <div id="zreport" className="space-y-2 text-[13px]">
          <div className="text-center">
            <div className="font-medium">{business?.name}</div>
            <div className="text-muted-foreground">
              {stores.find((x) => x.id === s.store_id)?.name}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("shift.openedWord")}</span>
            <span>
              {fmtDate(s.opened_at)} · {names[s.opened_by ?? ""]}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("shift.closedWord")}</span>
            <span>
              {s.closed_at && fmtDate(s.closed_at)} · {names[s.closed_by ?? ""] ?? ""}
            </span>
          </div>
          {sm && <SummaryRows s={sm} money={money} />}
          <div className="flex justify-between border-t pt-2 font-semibold">
            <span>{t("shift.cashCounted")}</span>
            <span className="tabular">{money(s.counted_cash)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{t("shift.difference")}</span>
            <Variance v={Number(s.variance)} money={money} />
          </div>
          {s.notes && (
            <p className="text-muted-foreground">
              {t("shift.notesWord")} {s.notes}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const v = Number(s.variance);
            void downloadPdf({
              filename: `storq-shift-${(s.closed_at ?? s.opened_at).slice(0, 10)}`,
              title: t("shift.reportTitle"),
              business: business?.name,
              subtitle: stores.find((x) => x.id === s.store_id)?.name,
              badge:
                Math.abs(v) < 0.01
                  ? t("shift.balanced")
                  : v > 0
                    ? t("shift.overWord")
                    : t("shift.shortWord"),
              meta: [
                [
                  t("shift.openedWord"),
                  `${fmtDate(s.opened_at)} · ${names[s.opened_by ?? ""] ?? ""}`,
                ],
                [
                  t("shift.closedWord"),
                  s.closed_at
                    ? `${fmtDate(s.closed_at)} · ${names[s.closed_by ?? ""] ?? ""}`
                    : t("shift.openWord"),
                ],
              ],
              kpis: [
                [t("shift.rowExpectedCash"), money(s.expected_cash ?? sm?.expected_cash ?? 0)],
                [t("shift.countedWord"), money(s.counted_cash)],
                [t("shift.difference"), money(v)],
              ],
              sections: [
                ...(sm
                  ? [
                      {
                        type: "pairs" as const,
                        heading: t("shift.title"),
                        rows: [
                          [t("shift.rowStartingFloat"), money(sm.opening_float)],
                          [t("shift.rowCashSales"), money(sm.cash_sales)],
                          [t("shift.rowCashRefunds"), `-${money(sm.cash_refunds)}`],
                          [t("shift.cashIn"), money(sm.cash_in)],
                          [t("shift.cashOut"), `-${money(sm.cash_out)}`],
                          [t("shift.rowExpenses"), `-${money(sm.till_expenses)}`],
                          [t("shift.rowExpectedCash"), money(sm.expected_cash)],
                        ] as [string, string][],
                      },
                      {
                        type: "pairs" as const,
                        heading: t("shift.takingsByMethod", { count: sm.transactions }),
                        rows: Object.entries(sm.by_method ?? {}).map(
                          ([m, x]) => [m, money(x)] as [string, string],
                        ),
                      },
                    ]
                  : []),
                ...(s.notes
                  ? [{ type: "text" as const, heading: t("shift.notes"), text: s.notes }]
                  : []),
              ],
              footerNote: t("shift.footerCounted"),
            });
          }}
        >
          {t("sdetail.downloadPdf")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
