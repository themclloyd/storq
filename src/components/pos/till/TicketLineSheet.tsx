import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, MinusSignIcon, PlusSignIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/pos/bits";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { DISCOUNT_CAP_RATIO, lineCapBlocked, round2 } from "@/lib/products";
import type { TicketRow } from "@/components/pos/till/Ticket";

const fixed = (n: number) => round2(n).toFixed(2);

/**
 * Line detail, opened by tapping a ticket row: quantity, a line discount and a
 * note (a size, a colour, "no bag"). Nothing is written until Done, so a stray
 * tap cannot rewrite a line the cashier was only inspecting.
 */
export function TicketLineSheet({
  line,
  stock,
  capped,
  onSave,
  onRemove,
  onClose,
}: {
  line: TicketRow;
  stock: number;
  /** A cashier without the approvals grant is held to the 10% cap. */
  capped: boolean;
  onSave: (qty: number, discount: number, note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { money } = usePos();
  const { t } = useI18n();
  const [qty, setQty] = useState(line.qty);
  const [disc, setDisc] = useState(line.disc > 0 ? fixed(line.disc) : "");
  const [note, setNote] = useState(line.note ?? "");

  const gross = round2(line.unit * qty);
  const discount = Math.min(Math.max(Number(disc || 0), 0), gross);
  const overCap = capped && lineCapBlocked(gross, discount);

  const commit = () => {
    onSave(qty, round2(discount), note.trim());
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden bg-card p-0">
        <DialogHeader className="space-y-0 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base">{line.name}</DialogTitle>
          <DialogDescription className="tabular mt-1 text-[11px]">
            {money(line.unit)} {t("till.eachWord")} ·{" "}
            {t("till.inStock", { count: Math.max(stock, 0) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {t("till.lineQty")}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("till.decrease")}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="till-key grid size-12 shrink-0 place-items-center border border-border bg-card text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
              >
                <HugeiconsIcon icon={MinusSignIcon} />
              </button>
              <Input
                inputMode="numeric"
                aria-label={t("till.lineQty")}
                value={qty}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^0-9]/g, ""));
                  setQty(Number.isFinite(n) && n > 0 ? Math.min(n, 999999) : 1);
                }}
                className="tabular h-12 text-center text-xl font-bold"
              />
              <button
                type="button"
                aria-label={t("till.increase")}
                onClick={() => setQty((q) => Math.min(999999, q + 1))}
                className="till-key grid size-12 shrink-0 place-items-center border border-border bg-card text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
              >
                <HugeiconsIcon icon={PlusSignIcon} />
              </button>
            </div>
          </div>

          <Field label={t("till.lineDiscount")}>
            <Input
              inputMode="decimal"
              aria-label={t("till.lineDiscount")}
              className="tabular h-11 text-right"
              value={disc}
              onChange={(e) => setDisc(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
            />
          </Field>
          {overCap && (
            <p className="text-[11px] font-medium text-warning">
              {t("till.cashierCapNote", { pct: DISCOUNT_CAP_RATIO * 100 })}
            </p>
          )}

          <Field label={t("till.lineNote")}>
            <Input
              maxLength={80}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("till.lineNotePlaceholder")}
            />
          </Field>

          <div className="flex items-baseline justify-between rounded-[10px] bg-muted px-3 py-2.5">
            <span className="text-[12px] font-medium text-muted-foreground">
              {t("till.lineTotal")}
            </span>
            <span className="tabular text-lg font-extrabold">
              {money(round2(gross - discount))}
            </span>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 border-t border-border bg-secondary/35 px-5 py-4 sm:justify-between sm:space-x-0">
          <Button
            variant="ghost"
            size="lg"
            className="px-3 text-destructive hover:bg-destructive-soft hover:text-destructive"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} />
            {t("till.remove")}
          </Button>
          <Button size="lg" className="flex-1" onClick={commit}>
            {t("common.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
