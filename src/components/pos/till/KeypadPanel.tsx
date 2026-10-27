import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
  /** Adds the item carrying this code; resolves true when it landed in the cart. */
  onAddCode: (code: string) => boolean | Promise<boolean>;
  onCustomAmount: (amount: number) => void;
  canCreateItem: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const amount = Number(value);
  const hasValue = value.trim().length > 0;

  return (
    <div className="till-surface w-full max-w-3xl p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-start">
        <div className="space-y-3">
          <div className="rounded-[10px] border border-border bg-background px-4 py-3 text-right">
            <span className="block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {t("till.keypadCode")}
            </span>
            <span
              className={cn(
                "tabular block truncate text-4xl leading-tight font-bold",
                !hasValue && "text-muted-foreground/40",
              )}
            >
              {value || "0"}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Button
              size="xl"
              className="w-full"
              disabled={!hasValue}
              onClick={() => {
                // A code that has to be looked up resolves asynchronously; the
                // pad only clears once the item really joined the sale.
                void Promise.resolve(onAddCode(value.trim())).then((ok) => {
                  if (ok) setValue("");
                });
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
          </div>

          <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">
            {t("till.keypadHint")}
          </p>
        </div>

        <NumberPad value={value} onChange={setValue} />
      </div>
    </div>
  );
}
