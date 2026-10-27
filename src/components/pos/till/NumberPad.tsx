import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@/lib/icons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DIGITS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];
const MAX_LEN = 12;

/**
 * The physical number pad a counter expects: three columns, big keys, a press
 * state on every one. `decimal` swaps the clear key for a point, for amounts;
 * integer entry (item codes) keeps a clear key instead.
 */
export function NumberPad({
  value,
  onChange,
  decimal = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  decimal?: boolean;
  className?: string;
}) {
  const { t } = useI18n();

  const append = (key: string) => {
    if (key === ".") {
      if (!decimal || value.includes(".")) return;
      onChange(value ? `${value}.` : "0.");
      return;
    }
    if (value.replace(".", "").length >= MAX_LEN) return;
    // A leading zero would otherwise build "00042"; keep one zero.
    if (value === "0") {
      onChange(key);
      return;
    }
    onChange(value + key);
  };

  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {DIGITS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => append(d)}
          className="till-key tabular h-16 border border-border bg-card text-2xl font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
        >
          {d}
        </button>
      ))}
      {decimal ? (
        <button
          type="button"
          onClick={() => append(".")}
          className="till-key h-16 border border-border bg-card text-2xl font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
        >
          .
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("till.keyClear")}
          className="till-key h-16 border border-border bg-card text-sm font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
        >
          {t("till.keyClear")}
        </button>
      )}
      <button
        type="button"
        onClick={() => append("0")}
        className="till-key tabular h-14 border border-border bg-card text-xl font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
      >
        0
      </button>
      <button
        type="button"
        onClick={() => onChange(value.slice(0, -1))}
        aria-label={t("till.keyDelete")}
        className="till-key grid h-16 place-items-center border border-border bg-card text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
      >
        <HugeiconsIcon icon={Delete02Icon} className="size-5" />
      </button>
    </div>
  );
}
