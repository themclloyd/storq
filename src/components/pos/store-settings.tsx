import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const storeTypeStyle: Record<string, string> = {
  approval: "bg-warning-soft text-warning-foreground",
  direct: "bg-success-soft text-success",
};

/** Direct-sale / approval chip shared by the locations list and store page. */
export function StoreTypeTag({ type }: { type: string }) {
  const { t } = useI18n();
  return (
    <Badge
      className={cn(
        "rounded-full border-transparent px-2 py-0.5 text-[11px] uppercase tracking-wide",
        storeTypeStyle[type] ?? "bg-success-soft text-success",
      )}
    >
      {type === "approval" ? t("store.typeApproval") : t("store.typeDirect")}
    </Badge>
  );
}

/** Large radio row used for the store type and the VAT mode. */
export function RadioCard({
  checked,
  onSelect,
  title,
  desc,
  disabled = false,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        checked ? "border-primary bg-secondary/50" : "border-input bg-card hover:bg-muted",
        disabled && "cursor-not-allowed opacity-60 hover:bg-card",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border [&_svg]:size-3",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked && <HugeiconsIcon icon={Tick02Icon} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
