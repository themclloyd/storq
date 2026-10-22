import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { WorkspacePath } from "@/lib/workspace-navigation";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  back,
  breadcrumb,
  title,
  sub,
  actions,
}: {
  /**
   * Parent-page link rendered on the trail line itself, replacing the old
   * stacked BackLink row so a nested page keeps one compact header.
   */
  back?: { to: WorkspacePath; label: ReactNode };
  breadcrumb?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {(back || breadcrumb) && (
          <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {back && (
              <Link
                to={back.to}
                className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
                {back.label}
              </Link>
            )}
            {back && breadcrumb && <span aria-hidden>/</span>}
            {breadcrumb}
          </div>
        )}
        <h1 className="font-display text-3xl leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Prev/Next pager shared by the inventory lists (ten rows per page). */
export function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  if (pageCount < 2) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      <p className="text-xs text-muted-foreground">
        {t("common.of")} {total}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>
          {t("common.prev")}
        </Button>
        <span className="tabular text-xs text-muted-foreground">
          {page + 1} / {pageCount}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
        >
          {t("common.next")}
        </Button>
      </div>
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
