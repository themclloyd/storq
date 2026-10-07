import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { usePos } from "@/lib/pos";
import { useStaffNames } from "@/lib/sales";
import { expenseCategories, rangeDays, sinceFor, sourceLabel, useExpenses, type Expense } from "@/lib/expenses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Field, NativeSelect, PageHeader } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/expenses")({
  head: () => ({ meta: [{ title: "Expenses — Storq" }, { name: "description", content: "Record and review business expenses." }, { property: "og:title", content: "Expenses — Storq" }, { property: "og:description", content: "Record and review business expenses." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Expenses,
});

const today = () => new Date().toISOString().slice(0, 10);

function Expenses() {
  const { store, rpc, money, can } = usePos();
  const qc = useQueryClient();
  const [range, setRange] = useState<keyof typeof rangeDays>("7 days");
  const list = useExpenses({ storeId: store?.id, since: sinceFor(range) });
  const names = useStaffNames();
  const [f, setF] = useState({ amount: "", category: expenseCategories[0]!, source: "till" as Expense["source"], note: "", date: today() });
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];
  const total = rows.reduce((a, e) => a + Number(e.amount), 0);
  const till = rows.filter((e) => e.source === "till").reduce((a, e) => a + Number(e.amount), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    setBusy(true);
    try {
      await rpc("record_expense", { p_store: store.id, p_amount: Number(f.amount), p_category: f.category, p_source: f.source, p_note: f.note || null, p_date: f.date });
      toast.success("Expense recorded");
      setF({ ...f, amount: "", note: "" });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) { toast.error((err as Error).message); }
    setBusy(false);
  }
  async function remove(id: string) {
    if (!confirm("Delete this expense?")) return;
    try { await rpc("delete_expense", { p_id: id }); qc.invalidateQueries({ queryKey: ["expenses"] }); }
    catch (err) { toast.error((err as Error).message); }
  }

  return (
    <>
      <PageHeader title="Expenses" sub={store?.name ?? ""}
        actions={(Object.keys(rangeDays) as (keyof typeof rangeDays)[]).map((r) => (
          <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="capitalize">{r}</Button>
        ))}
      />
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <form onSubmit={save} className="pos-card h-fit space-y-3 p-4">
          <h2 className="text-sm font-bold">Record an expense</h2>
          <Field label="Amount"><Input required type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Category">
            <NativeSelect value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {expenseCategories.map((c) => <option key={c}>{c}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Paid from">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(sourceLabel) as Expense["source"][]).map((s) => (
                <Button key={s} type="button" size="sm" variant={f.source === s ? "default" : "outline"} onClick={() => setF({ ...f, source: s })} className="h-auto rounded-lg py-2 text-xs whitespace-normal">{sourceLabel[s]}</Button>
              ))}
            </div>
          </Field>
          <Field label="Date"><Input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Note (optional)"><Input value={f.note} placeholder="e.g. Diesel for generator" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <Button className="w-full" disabled={busy || !store}>Save expense</Button>
        </form>
        <div>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="pos-card p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total expenses</div><div className="tabular mt-1 truncate text-base font-extrabold">{money(total)}</div></div>
            <div className="pos-card p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Paid from till</div><div className="tabular mt-1 truncate text-base font-extrabold">{money(till)}</div></div>
          </div>
          {rows.length === 0 ? <Empty>No expenses in this period.</Empty> : (
            <div className="pos-card divide-y">
              {rows.map((e) => (
                <div key={e.id} className="flex min-w-0 items-center gap-3 px-4 py-2 text-[13px]">
                  <span className="w-20 shrink-0 text-muted-foreground">{e.spent_on}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.category}</div>
                    <div className="truncate text-xs text-muted-foreground">{sourceLabel[e.source]} · {names.data?.[e.created_by ?? ""]}{e.note && ` · ${e.note}`}</div>
                  </div>
                  <span className="tabular shrink-0 font-semibold">{money(e.amount)}</span>
                  {can("admin", "manager") && <button onClick={() => remove(e.id)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Delete expense"><HugeiconsIcon icon={Delete02Icon} className="size-4" /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
