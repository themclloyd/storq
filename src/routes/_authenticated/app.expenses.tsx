import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { downloadCsv, downloadPdf, fileStamp } from "@/lib/pdf";
import { useStaffNames } from "@/lib/sales";
import { expenseCategories, rangeDays, sinceFor, useExpenses, type Expense } from "@/lib/expenses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Field, NativeSelect, PageHeader } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — Storq" },
      { name: "description", content: "Record and review business expenses." },
      { property: "og:title", content: "Expenses — Storq" },
      { property: "og:description", content: "Record and review business expenses." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Expenses,
});

const today = () => new Date().toISOString().slice(0, 10);

// Expense source is a stored code; only its display label is localized. Category names are
// business data (stored per tenant) and stay untranslated.
const SOURCE_KEYS: Record<Expense["source"], string> = {
  till: "exp.srcTill",
  bank: "exp.srcBank",
  mobile: "exp.srcMobile",
};
const SOURCE_CODES = Object.keys(SOURCE_KEYS) as Expense["source"][];
const RANGE_KEYS: Record<keyof typeof rangeDays, string> = {
  today: "sales.rangeToday",
  "7 days": "sales.range7d",
  "30 days": "sales.range30d",
  "90 days": "exp.range90d",
};

function Expenses() {
  const { store, rpc, money, can, business } = usePos();
  const { t } = useI18n();
  const srcLabel = (s: Expense["source"]) => t(SOURCE_KEYS[s]);
  const qc = useQueryClient();
  const [range, setRange] = useState<keyof typeof rangeDays>("7 days");
  const list = useExpenses({ storeId: store?.id, since: sinceFor(range) });
  const names = useStaffNames();
  const [f, setF] = useState({
    amount: "",
    category: expenseCategories[0]!,
    source: "till" as Expense["source"],
    note: "",
    date: today(),
  });
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];
  const total = rows.reduce((a, e) => a + Number(e.amount), 0);
  const till = rows.filter((e) => e.source === "till").reduce((a, e) => a + Number(e.amount), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!store) return;
    setBusy(true);
    try {
      await rpc("record_expense", {
        p_store: store.id,
        p_amount: Number(f.amount),
        p_category: f.category,
        p_source: f.source,
        p_note: f.note || null,
        p_date: f.date,
      });
      toast.success(t("exp.recorded"));
      setF({ ...f, amount: "", note: "" });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
    setBusy(false);
  }
  async function remove(id: string) {
    if (!confirm(t("exp.deleteConfirm"))) return;
    try {
      await rpc("delete_expense", { p_id: id });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title={t("exp.title")}
        sub={store?.name ?? ""}
        actions={[
          <Button
            key="csv"
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv(`storq-expenses-${fileStamp()}.csv`, [
                ["date", "category", "source", "amount", "note", "recorded_by"],
                ...rows.map((e) => [
                  e.spent_on,
                  e.category,
                  e.source,
                  e.amount,
                  e.note ?? "",
                  names.data?.[e.created_by ?? ""] ?? "",
                ]),
              ])
            }
          >
            CSV
          </Button>,
          <Button
            key="pdf"
            size="sm"
            variant="outline"
            onClick={() => {
              const cats: Record<string, number> = {};
              rows.forEach((e) => (cats[e.category] = (cats[e.category] ?? 0) + Number(e.amount)));
              void downloadPdf({
                filename: `storq-expenses-${fileStamp()}`,
                title: t("exp.reportTitle"),
                business: business?.name,
                subtitle: `${store?.name ?? ""} · ${t(RANGE_KEYS[range])}`,
                kpis: [
                  [t("exp.totalSpent"), money(total)],
                  [t("exp.paidFromTill"), money(till)],
                  [t("exp.entries"), String(rows.length)],
                ],
                sections: [
                  {
                    type: "pairs",
                    heading: t("exp.byCategory"),
                    rows: Object.entries(cats)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => [k, money(v)]),
                  },
                  {
                    type: "table",
                    heading: t("exp.allExpenses"),
                    head: [
                      t("doc.date"),
                      t("exp.category"),
                      t("exp.paidFrom"),
                      t("exp.note"),
                      t("exp.byCol"),
                      t("doc.amount"),
                    ],
                    align: ["left", "left", "left", "left", "left", "right"],
                    body: rows.map((e) => [
                      e.spent_on,
                      e.category,
                      srcLabel(e.source),
                      e.note ?? "",
                      names.data?.[e.created_by ?? ""] ?? "",
                      money(e.amount),
                    ]),
                    foot: [t("common.total"), "", "", "", "", money(total)],
                  },
                ],
              });
            }}
          >
            PDF
          </Button>,
          ...(Object.keys(rangeDays) as (keyof typeof rangeDays)[]).map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "default" : "outline"}
              onClick={() => setRange(r)}
              className="capitalize"
            >
              {t(RANGE_KEYS[r])}
            </Button>
          )),
        ]}
      />
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <form onSubmit={save} className="pos-card h-fit space-y-3 p-4">
          <h2 className="text-sm font-bold">{t("exp.recordExpense")}</h2>
          <Field label={t("doc.amount")}>
            <Input
              required
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </Field>
          <Field label={t("exp.category")}>
            <NativeSelect
              value={f.category}
              onChange={(v) => setF({ ...f, category: v })}
              options={expenseCategories.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label={t("exp.paidFrom")}>
            <div className="grid grid-cols-3 gap-2">
              {SOURCE_CODES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={f.source === s ? "default" : "outline"}
                  onClick={() => setF({ ...f, source: s })}
                  className="h-auto rounded-lg py-2 text-xs whitespace-normal"
                >
                  {srcLabel(s)}
                </Button>
              ))}
            </div>
          </Field>
          <Field label={t("doc.date")}>
            <Input
              type="date"
              value={f.date}
              max={today()}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </Field>
          <Field label={t("exp.noteOptional")}>
            <Input
              value={f.note}
              placeholder={t("exp.notePlaceholder")}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
          <Button className="w-full" disabled={busy || !store}>
            {t("exp.saveExpense")}
          </Button>
        </form>
        <div>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="pos-card p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("exp.totalExpenses")}
              </div>
              <div className="tabular mt-1 truncate text-base font-extrabold">{money(total)}</div>
            </div>
            <div className="pos-card p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("exp.paidFromTill")}
              </div>
              <div className="tabular mt-1 truncate text-base font-extrabold">{money(till)}</div>
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty>{t("exp.none")}</Empty>
          ) : (
            <div className="pos-card divide-y">
              {rows.map((e) => (
                <div key={e.id} className="flex min-w-0 items-center gap-3 px-4 py-2 text-[13px]">
                  <span className="w-20 shrink-0 text-muted-foreground">{e.spent_on}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.category}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {srcLabel(e.source)} · {names.data?.[e.created_by ?? ""]}
                      {e.note && ` · ${e.note}`}
                    </div>
                  </div>
                  <span className="tabular shrink-0 font-semibold">{money(e.amount)}</span>
                  {can("admin", "manager") && (
                    <button
                      onClick={() => remove(e.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={t("exp.deleteAria")}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
