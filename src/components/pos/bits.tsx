import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function NativeSelect({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
        className,
      )}
    />
  );
}

const statusStyle: Record<string, string> = {
  completed: "bg-success/15 text-success",
  layby_completed: "bg-success/15 text-success",
  pending_approval: "bg-warning/25 text-warning-foreground",
  layby_open: "bg-accent/15 text-accent",
  rejected: "bg-destructive/15 text-destructive",
  layby_cancelled: "bg-destructive/15 text-destructive",
  open: "bg-accent/15 text-accent",
  closed: "bg-secondary text-muted-foreground",
  refunded: "bg-destructive/15 text-destructive",
  partially_refunded: "bg-warning/25 text-warning-foreground",
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
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", statusStyle[s])}>
      {statusText[s] ?? s}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="pos-card p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function StoreTypeTag({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        type === "approval" ? "bg-warning/25 text-warning-foreground" : "bg-success/15 text-success",
      )}
    >
      {type === "approval" ? "Approval" : "Direct sale"}
    </span>
  );
}

export const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
