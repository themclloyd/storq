// Manual discount sheet: per-line flat amounts with a % quick fill. Mirrors
// the server cap (10% of a line / the cart for cashiers). Past the cap the
// checkout asks for a manager PIN (verified server-side) — this sheet only
// edits the discount amounts, which live on the cart in the register.
import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/pos/bits";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { DISCOUNT_CAP_RATIO, round2, lineCapBlocked, cartCapBlocked } from "@/lib/products";

export type DiscountLine = { id: string; name: string; unit: number; qty: number };

const fixed = (n: number) => round2(n).toFixed(2);

export function DiscountDialog({
  lines,
  discounts,
  onApply,
  onClose,
}: {
  lines: DiscountLine[];
  discounts: Record<string, number>;
  onApply: (d: Record<string, number>) => void;
  onClose: () => void;
}) {
  const { money, can } = usePos();
  const { t } = useI18n();
  const cashier = !can("admin", "manager");
  // raw text keeps the caret sane while typing "12."; parsed/clamped on apply
  const [amt, setAmt] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.id, discounts[l.id] ? fixed(discounts[l.id] ?? 0) : ""]),
    ),
  );
  const [pct, setPct] = useState("");

  const parsed = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of lines) {
      const n = Number(amt[l.id] || 0);
      out[l.id] = Number.isFinite(n) && n > 0 ? Math.min(round2(n), round2(l.unit * l.qty)) : 0;
    }
    return out;
  }, [amt, lines]);

  const gross = lines.reduce((a, l) => a + round2(l.unit * l.qty), 0);
  const totalDisc = round2(Object.values(parsed).reduce((a, n) => a + n, 0));
  const overCap =
    cartCapBlocked(gross, totalDisc) ||
    lines.some((l) => lineCapBlocked(round2(l.unit * l.qty), parsed[l.id] ?? 0));

  const applyPct = () => {
    const p = Number(pct);
    if (!Number.isFinite(p) || p <= 0 || p > 100) return;
    setAmt(
      Object.fromEntries(
        lines.map((l) => [
          l.id,
          fixed(Math.min(round2((l.unit * l.qty * p) / 100), round2(l.unit * l.qty))),
        ]),
      ),
    );
  };

  const apply = () => {
    const clean: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed)) if (n > 0) clean[id] = n;
    onApply(clean);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden bg-card p-0 shadow-[var(--shadow-pop)]">
        <DialogHeader className="space-y-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>{t("till.discountsTitle")}</DialogTitle>
          <DialogDescription className="mt-1.5 text-xs">
            {cashier
              ? t("till.cashierCapNote", { pct: DISCOUNT_CAP_RATIO * 100 })
              : t("till.lineLimitNote")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2 px-5 pt-4">
          <Field label={t("till.applyPctToAll")}>
            <Input
              inputMode="decimal"
              className="tabular h-9 w-24"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="10"
            />
          </Field>
          <Button size="sm" variant="outline" disabled={!pct} onClick={applyPct}>
            {t("common.apply")}
          </Button>
        </div>

        <ScrollArea className="max-h-[40vh]">
          <div className="divide-y px-5">
            {lines.map((l) => {
              const lineGross = round2(l.unit * l.qty);
              const blocked = cashier && lineCapBlocked(lineGross, parsed[l.id] ?? 0);
              return (
                <div key={l.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.name}</div>
                    <div className="tabular text-xs text-muted-foreground">
                      {l.qty} × {money(l.unit)} = {money(lineGross)}
                    </div>
                  </div>
                  <Input
                    inputMode="decimal"
                    aria-label={t("till.ariaDiscountFor", { name: l.name })}
                    className="tabular h-9 w-24 text-right"
                    value={amt[l.id] ?? ""}
                    onChange={(e) => setAmt((m) => ({ ...m, [l.id]: e.target.value }))}
                    placeholder="0.00"
                  />
                  {(amt[l.id] ?? "") !== "" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0"
                      aria-label={t("till.ariaClearDiscountFor", { name: l.name })}
                      onClick={() => setAmt((m) => ({ ...m, [l.id]: "" }))}
                    >
                      <HugeiconsIcon icon={Delete02Icon} />
                    </Button>
                  )}
                  {blocked && (
                    <span className="shrink-0 text-[11px] font-medium text-warning">
                      {t("till.overCap")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="space-y-3 px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">{t("till.totalDiscount")}</span>
            <span className="tabular text-lg font-extrabold">-{money(totalDisc)}</span>
          </div>
          {overCap && cashier && (
            <Alert className="border-warning/40 bg-warning/15 text-warning-foreground">
              <AlertDescription className="text-xs [&_p]:leading-relaxed">
                {t("till.capAlert", { pct: DISCOUNT_CAP_RATIO * 100 })}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-row gap-3 border-t bg-secondary/35 px-5 py-4 sm:justify-between sm:space-x-0">
          <Button variant="ghost" size="lg" className="px-4" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" className="flex-1" disabled={totalDisc <= 0} onClick={apply}>
            {totalDisc > 0
              ? t("till.applyAmountOff", { amount: money(totalDisc) })
              : t("common.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
