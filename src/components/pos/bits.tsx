import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { WorkspacePath } from "@/lib/workspace-navigation";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableCell, TableHead } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
   * stacked BackLink row so a nested page keeps one compact header. `search`
   * carries a list's view back to the screen it belongs to.
   */
  back?: { to: WorkspacePath; label: ReactNode; search?: Record<string, unknown> };
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
                search={back.search as never}
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

/** Prev/Next pager shared by every list (ten rows per page by default). */
export function Pager({
  page,
  pageCount,
  total,
  onPage,
  pageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
  /** Rows per page, when the caller knows it. Inferred from `total` otherwise. */
  pageSize?: number;
}) {
  const { t } = useI18n();
  if (pageCount < 2) return null;
  const size = pageSize ?? Math.ceil(total / pageCount);
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <div className="mt-3 flex items-center justify-between">
      <p className="tabular text-xs text-muted-foreground">
        {t("common.showingRange", { from, to, total })}
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

/**
 * A money figure at display size. The sign rides at half height and a lighter
 * ink, so `MK0` no longer reads as the word "MKO" and the digits keep the
 * weight that makes the number scannable across the counter.
 */
export function Money({ value, className }: { value: string; className?: string }) {
  const at = value.search(/[0-9\u2212]/);
  if (at <= 0) return <span className={className}>{value}</span>;
  return (
    <span className={cn("inline-flex items-baseline", className)}>
      <span className="mr-[0.16em] text-[0.54em] font-bold tracking-[0.04em] text-muted-foreground">
        {value.slice(0, at)}
      </span>
      <span>{value.slice(at)}</span>
    </span>
  );
}

/**
 * KPI tile for list headers: a micro label over one heavy tabular figure. The
 * value never wraps, so a row of stats stays level whatever the amounts are.
 * While the figure is in flight, pass `loading` to hold the tile's shape: a
 * zeroed display would read as a real result.
 */
export function Stat({
  label,
  value,
  hint,
  loading,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="p-3.5" aria-busy={loading || undefined}>
      <div className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 space-y-1.5" aria-hidden>
          <Skeleton className="h-7 w-24" />
          {hint && <Skeleton className="h-2.5 w-16" />}
        </div>
      ) : (
        <>
          <div className="tabular mt-1 truncate text-2xl leading-tight font-extrabold">{value}</div>
          {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
        </>
      )}
    </Card>
  );
}

/** The wrapping grid for a row of `Stat` tiles. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Props that make a whole table row behave like a link: it is reachable with
 * Tab and opens on Enter or Space, not just on a mouse click. Spread it onto
 * the `TableRow` and put the keyboard hint in the row's first cell label.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function rowLinkProps(onOpen: () => void) {
  return {
    role: "link" as const,
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onOpen();
    },
  };
}

/**
 * The affordance that marks a whole table row as a link: an empty header cell
 * and a narrow cell pinned at the end of the row, with no label repeated.
 */
export function TableChevron({ head = false }: { head?: boolean }) {
  if (head) return <TableHead className="w-10" />;
  return (
    <TableCell className="w-10 pr-3">
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 text-muted-foreground/70" />
    </TableCell>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="block space-y-1">
      <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
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
      <SelectTrigger className={cn("bg-card text-sm", className)}>
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
    <Badge className={cn("border-transparent", statusStyle[s])}>
      {s in statusText ? t(`status.${s}`) : s}
    </Badge>
  );
}

/**
 * The one empty state: a quiet mark, a line of what is missing, and at most one
 * way out. Every list uses it so "nothing here yet" reads the same everywhere.
 */
export function Empty({
  icon,
  title,
  action,
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && (
        <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </Card>
  );
}

/**
 * A screen this session may not open. The dashboard is the one page every
 * signed-in person has, so the card offers a way out instead of a dead end.
 */
export function NoAccess() {
  const { t } = useI18n();
  return (
    <Card className="p-6 text-center text-sm text-muted-foreground">
      <p>{t("common.noAccess")}</p>
      <Link
        to="/app/dashboard"
        className="mt-2 inline-block font-medium text-foreground underline-offset-4 hover:underline"
      >
        {t("nav.dashboard")}
      </Link>
    </Card>
  );
}

export function StoreTypeTag({ type }: { type: string }) {
  const { t } = useI18n();
  return (
    <Badge
      className={cn(
        "border-transparent text-[11px] tracking-wide uppercase",
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
