import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@/lib/icons";
import { useI18n } from "@/lib/i18n";
import {
  LEGACY_PAYMENT_METHODS,
  PAYMENT_METHODS,
  methodIcon,
  methodLabel,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/pos/bits";

/**
 * A tenant's methods as a wrapping grid of toggles. Cash is always on, the
 * server guarantees it too, and `extra` surfaces retired codes that this
 * business already had enabled so it can keep or drop them deliberately.
 */
export function PaymentMethodPicker({
  value,
  onChange,
  extra = [],
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  extra?: string[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const options: PaymentMethod[] = [
    ...PAYMENT_METHODS,
    ...LEGACY_PAYMENT_METHODS.filter((m) => extra.includes(m.code)),
  ];
  const toggle = (code: string) => {
    if (code === "cash" || disabled) return;
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((m) => {
          const on = m.code === "cash" || value.includes(m.code);
          return (
            <button
              key={m.code}
              type="button"
              aria-pressed={on}
              disabled={disabled || m.code === "cash"}
              onClick={() => toggle(m.code)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                on
                  ? "border-primary/60 bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/60",
                m.code === "cash" && "cursor-default",
              )}
            >
              <HugeiconsIcon icon={methodIcon(m.code)} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{methodLabel(m.code)}</span>
              {m.legacy && (
                <span className="rounded bg-muted px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("biz.legacy")}
                </span>
              )}
              {on && <HugeiconsIcon icon={Tick02Icon} className="size-4 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("biz.cashAlways")}</p>
    </div>
  );
}

const PRESET_CURRENCIES = ["MWK", "USD", "ZAR", "KES", "TZS", "ZMW", "BWP", "MZN", "GBP", "EUR"];
const OTHER = "__other";
const CODE_RE = /[^A-Z]/g;

/**
 * Preset currency codes with an escape hatch for anything else. The business
 * stores the code itself (it is printed straight before the amount), so custom
 * input is normalised to 1–4 uppercase letters.
 */
export function CurrencyField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(() => !PRESET_CURRENCIES.includes(value));
  return (
    <div className="space-y-2">
      <NativeSelect
        value={custom ? OTHER : value}
        disabled={disabled}
        onChange={(next) => {
          if (next === OTHER) setCustom(true);
          else {
            setCustom(false);
            onChange(next);
          }
        }}
        options={[
          ...PRESET_CURRENCIES.map((c) => ({ value: c, label: c })),
          { value: OTHER, label: t("biz.currencyOther") },
        ]}
      />
      {custom && (
        <Input
          value={value}
          disabled={disabled}
          maxLength={4}
          placeholder="MWK"
          className="w-28 uppercase"
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(CODE_RE, "").slice(0, 4))}
        />
      )}
    </div>
  );
}
