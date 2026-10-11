import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PageHeader({
  breadcrumb,
  title,
  sub,
  actions,
}: {
  breadcrumb?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-xs text-muted-foreground">{breadcrumb}</div>}
        <h1 className="font-display text-3xl leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="block space-y-2">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </Label>
  );
}

export function NativeSelect({
  value,
  onChange,
  className,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} {...(disabled !== undefined && { disabled })}>
      <SelectTrigger className={cn("h-9 bg-card text-sm", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const statusStyle: Record<string, string> = {
  completed: "bg-success-soft text-success",
  layby_completed: "bg-success-soft text-success",
  pending_approval: "bg-warning-soft text-warning-foreground",
  layby_open: "bg-warning-soft text-warning-foreground",
  rejected: "bg-destructive-soft text-destructive",
  layby_cancelled: "bg-destructive-soft text-destructive",
  open: "bg-warning-soft text-warning-foreground",
  closed: "bg-secondary text-muted-foreground",
  refunded: "bg-destructive-soft text-destructive",
  partially_refunded: "bg-warning-soft text-warning-foreground",
};
const statusText: Record<string, string> = {
  completed: "Paid",
  layby_completed: "Layby paid",
  pending_approval: "Awaiting approval",
  layby_open: "Layby open",
  rejected: "Rejected",
  layby_cancelled: "Layby cancelled",
  open: "Open",
  closed: "Closed",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
};
export function Status({ s }: { s: string }) {
  const { t } = useI18n();
  return (
    <Badge className={cn("rounded-full border-transparent px-2.5 py-0.5", statusStyle[s])}>
      {s in statusText ? t(`status.${s}`) : s}
    </Badge>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <Card className="p-6 text-center text-sm text-muted-foreground">{children}</Card>;
}

export function StoreTypeTag({ type }: { type: string }) {
  const { t } = useI18n();
  return (
    <Badge
      className={cn(
        "rounded-full border-transparent px-2 py-0.5 text-[11px] uppercase tracking-wide",
        type === "approval"
          ? "bg-warning-soft text-warning-foreground"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {type === "approval" ? t("status.approval") : t("status.directSale")}
    </Badge>
  );
}

// Shared till formatting helper co-located with the POS bits; advisory only.
// eslint-disable-next-line react-refresh/only-export-components
export const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
