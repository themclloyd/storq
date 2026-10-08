import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
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
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="block space-y-1">
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
    <Badge className={cn("rounded-full border-transparent px-2.5 py-0.5", statusStyle[s])}>
      {statusText[s] ?? s}
    </Badge>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">{children}</Card>
  );
}

export function StoreTypeTag({ type }: { type: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full border-transparent px-2 py-0.5 text-[11px] uppercase tracking-wide",
        type === "approval"
          ? "bg-warning/25 text-warning-foreground"
          : "bg-success/15 text-success",
      )}
    >
      {type === "approval" ? "Approval" : "Direct sale"}
    </Badge>
  );
}

export const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
