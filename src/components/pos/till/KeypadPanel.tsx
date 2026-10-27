import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { NumberPad } from "@/components/pos/till/NumberPad";

/**
 * Square's second way to ring up: a calculator. A cashier types an item code
 * and adds it without touching the search box, or types a price to register a
 * new item at that amount (the catalogue is the only thing checkout can sell,
 * so a one-off is a named item rather than an untraceable line).
 */
export function KeypadPanel({
  onAddCode,
  onCustomAmount,
  canCreateItem,
}: {
  /** Adds the item carrying this code; returns true when it landed in the cart. */
  onAddCode: (code: string) => boolean;
  onCustomAmount: (amount: number) => void;
  canCreateItem: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const amount = Number(value);
  const hasValue = value.trim().length > 0;

  return (
    <div className="till-surface mx-auto w-full max-w-sm p-4">
      <div className="mb-3 rounded-[10px] border border-border bg-background px-3 py-2 text-right">
        <span className="block text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {t("till.keypadCode")}
        </span>
        <span className="tabular block truncate text-3xl leading-tight font-bold">
          {value || "—"}
        </span>
      </div>

      <NumberPad value={value} onChange={setValue} />

      <div className="mt-3 space-y-2">
        <Button
          size="xl"
          className="w-full"
          disabled={!hasValue}
          onClick={() => {
            if (onAddCode(value.trim())) setValue("");
          }}
        >
          <HugeiconsIcon icon={PlusSignIcon} />
          {t("till.keypadAddItem")}
        </Button>
        {canCreateItem && (
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={!hasValue || !Number.isFinite(amount) || amount <= 0}
            onClick={() => onCustomAmount(amount)}
          >
            {t("till.keypadCustom")}
          </Button>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("till.keypadHint")}</p>
      </div>
    </div>
  );
}
