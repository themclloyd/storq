import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { COUNTED, useRefunds } from "@/lib/refunds";
import { usePos } from "@/lib/pos";
import { useSales, useStaffNames } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/sales")({ head: () => ({ meta: [{ title: "Sales — Storq" }, { name: "description", content: "Review Storq sales, receipts and refunds." }, { property: "og:title", content: "Sales — Storq" }, { property: "og:description", content: "Review Storq sales, receipts and refunds." }, { name: "robots", content: "noindex, nofollow" }] }), component: Sales });

const ranges = { today: 0, "7 days": 7, "30 days": 30 } as const;

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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

function StatusBadge({ s }: { s: string }) {
  return (
    <Badge className={cn("rounded-full border-transparent px-2.5 py-0.5", statusStyle[s])}>
      {statusText[s] ?? s}
    </Badge>
  );
}

function Sales() {
  const { store, stores, money, can } = usePos();
  const navigate = useNavigate();
  const [range, setRange] = useState<keyof typeof ranges>("today");
  const [all, setAll] = useState(false);
  const since = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ranges[range]); return d.toISOString();
  }, [range]);
  const sales = useSales("history", { storeId: all ? undefined : store?.id, since });
  const names = useStaffNames();
  const rows = sales.data ?? [];
  const done = rows.filter((s) => COUNTED.includes(s.status));
  const revenue = done.reduce((a, s) => a + Number(s.total) - Number(s.refunded ?? 0), 0);
  const refunds = useRefunds({ storeId: all ? undefined : store?.id, since });
  const collected = rows.filter((s) => s.status !== "pending_approval" && s.status !== "rejected").reduce((a, s) => a + Number(s.paid), 0);
  const pending = rows.filter((s) => s.status === "pending_approval").length;
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Sales</h1>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ranges) as (keyof typeof ranges)[]).map((r) => (
            <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="capitalize">{r}</Button>
          ))}
          {stores.length > 1 && can("admin", "manager") && <Button size="sm" variant={all ? "accent" : "outline"} onClick={() => setAll(!all)}>All stores</Button>}
        </div>
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Net sales", money(revenue)],
          ["Collected", money(collected)],
          ["Refunds", money((refunds.data ?? []).reduce((a, r) => a + Number(r.amount), 0))],
          ["Transactions", String(done.length)],
          ...((all ? stores.some((s) => s.store_type === "approval") : store?.store_type === "approval") ? [["Awaiting approval", String(pending)]] : []),
        ].map(([k, v]) => (
          <Card key={k} className="p-3 shadow-none">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="tabular mt-1 truncate text-base font-extrabold">{v}</div>
          </Card>
        ))}
      </div>
      {rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">No sales in this period.</Card>
      ) : (
        <Card className="shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead className="w-32">Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Details</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} className="cursor-pointer text-[13px]" onClick={() => navigate({ to: "/app/sales/$id", params: { id: s.id } })}>
                  <TableCell className="font-bold">#{s.number}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(s.created_at)}</TableCell>
                  <TableCell><StatusBadge s={s.status} /></TableCell>
                  <TableCell className="hidden truncate text-muted-foreground sm:table-cell">
                    {all && `${storeName(s.store_id)} · `}{names.data?.[s.created_by ?? ""]}{s.customer_name && ` · ${s.customer_name}`}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">{money(s.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
