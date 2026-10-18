import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ReceiptIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { downloadCsv, downloadPdf, fileStamp } from "@/lib/pdf";
import { fetchSalesForExport, useSalesPage, useSalesSummary, useStaffNames } from "@/lib/sales";
import { consumeExportQuota } from "@/lib/export-quota";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PageHeader } from "@/components/pos/bits";
import { ExportMenu } from "@/components/pos/ExportMenu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/sales")({
  head: () => ({
    meta: [
      { title: "Sales | Storq" },
      { name: "description", content: "Review Storq sales, receipts and refunds." },
      { property: "og:title", content: "Sales | Storq" },
      { property: "og:description", content: "Review Storq sales, receipts and refunds." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Sales,
});

const ranges = { today: 0, "7 days": 7, "30 days": 30 } as const;
const rangeKey: Record<keyof typeof ranges, string> = {
  today: "sales.rangeToday",
  "7 days": "sales.range7d",
  "30 days": "sales.range30d",
};

// Rows are read one page at a time straight from the server; the table never
// holds the whole period in memory the way the old client-side slice did.
const PAGE_SIZE = 50;

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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

function StatusBadge({ s }: { s: string }) {
  const { t } = useI18n();
  return (
    <Badge className={cn("rounded-full border-transparent px-2.5 py-0.5", statusStyle[s])}>
      {s in statusText ? t(`status.${s}`) : s}
    </Badge>
  );
}

function Sales() {
  const { store, stores, money, can, business } = usePos();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [range, setRange] = useState<keyof typeof ranges>("today");
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ranges[range]);
    return d.toISOString();
  }, [range]);
  const storeId = all ? undefined : store?.id;
  // Approval stores speak in "invoice" terms throughout this page; direct
  // stores and the mixed all-stores view keep the plain "sales" vocabulary.
  const approval = !all && store?.store_type === "approval";

  // Headline numbers come from a single SQL aggregate over the whole period, so
  // they stay exact past 1000 sales; the table itself pages on the server.
  const summary = useSalesSummary({ storeId, since });
  const kpi = summary.data ?? {
    revenue: 0,
    collected: 0,
    refunds: 0,
    transactions: 0,
    pending: 0,
  };
  const list = useSalesPage({ storeId, since, page, pageSize: PAGE_SIZE });
  const names = useStaffNames();
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name;

  // Export is on-demand: fetch the full period only when a button is clicked so
  // ordinary browsing stays light while the download still covers every sale.
  async function runExport(kind: "csv" | "pdf") {
    // Per-device rolling budget — client-side only but stops a click-loop from
    // re-pulling another full-period scan the instant the previous finishes.
    const quota = consumeExportQuota();
    if (!quota.allowed) {
      toast.error(
        t("xport.quotaHit", { mins: Math.max(1, Math.ceil(quota.retryAfterMs / 60_000)) }),
      );
      return;
    }
    setExporting(true);
    try {
      const data = await fetchSalesForExport({ storeId, since });
      const staffName = (id: string | null) => names.data?.[id ?? ""] ?? "";
      if (kind === "csv") {
        downloadCsv(`storq-sales-${fileStamp()}.csv`, [
          [
            "number",
            "date",
            "store",
            "status",
            "staff",
            "customer",
            "method",
            "total",
            "tax",
            "paid",
            "refunded",
          ],
          ...data.map((s) => [
            s.number,
            s.created_at,
            storeName(s.store_id) ?? "",
            s.status,
            staffName(s.created_by),
            s.customer_name ?? "",
            s.payment_method ?? "",
            s.total,
            s.tax,
            s.paid,
            s.refunded,
          ]),
        ]);
      } else {
        void downloadPdf({
          filename: `storq-sales-${fileStamp()}`,
          title: t(approval ? "sales.reportTitleApproval" : "sales.reportTitle"),
          business: business?.name,
          orientation: "landscape",
          subtitle: `${all ? t("sales.allStores") : (store?.name ?? "")} · ${t(rangeKey[range])}`,
          kpis: [
            [t("sales.netSales"), money(kpi.revenue)],
            [t("sales.collected"), money(kpi.collected)],
            [t("sales.refunds"), money(kpi.refunds)],
            [t(approval ? "sales.titleApproval" : "sales.transactions"), String(kpi.transactions)],
          ],
          sections: [
            {
              type: "table",
              head: [
                "#",
                t("doc.date"),
                t("sales.colStore"),
                t("sales.colStatus"),
                t("sales.colStaff"),
                t("doc.customer"),
                t("doc.method"),
                t("common.total"),
                t("sales.colRefunded"),
              ],
              align: ["left", "left", "left", "left", "left", "left", "left", "right", "right"],
              body: data.map((s) => [
                s.number,
                new Date(s.created_at).toLocaleString("en-ZA", {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
                storeName(s.store_id) ?? "",
                s.status in statusText ? t(`status.${s.status}`) : s.status,
                staffName(s.created_by),
                s.customer_name ?? "",
                s.payment_method ?? "",
                money(s.total),
                Number(s.refunded) ? money(s.refunded) : "",
              ]),
            },
          ],
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const showPending = all
    ? stores.some((s) => s.store_type === "approval")
    : store?.store_type === "approval";

  const cards: [string, string][] = [
    [t("sales.netSales"), money(kpi.revenue)],
    [t("sales.collected"), money(kpi.collected)],
    [t("sales.refunds"), money(kpi.refunds)],
    [t(approval ? "sales.titleApproval" : "sales.transactions"), String(kpi.transactions)],
  ];
  if (showPending) cards.push([t("status.pending_approval"), String(kpi.pending)]);

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.sales")} / ${t(approval ? "nav.invoices" : "nav.salesHistory")}`}
        title={t(approval ? "sales.titleApproval" : "sales.title")}
        actions={
          <>
            <SegmentedControl
              aria-label={t("sales.title")}
              size="sm"
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(1);
              }}
              options={(Object.keys(ranges) as (keyof typeof ranges)[]).map((r) => ({
                value: r,
                label: t(rangeKey[r]),
              }))}
            />
            {stores.length > 1 && can("admin", "manager") && (
              <Button
                size="sm"
                variant={all ? "secondary" : "outline"}
                aria-pressed={all}
                onClick={() => {
                  setAll(!all);
                  setPage(1);
                }}
              >
                {t("sales.allStores")}
              </Button>
            )}
            <ExportMenu disabled={exporting} onExport={(kind) => void runExport(kind)} />
          </>
        }
      />
      <div className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {cards.map(([k, v]) => (
          <Card key={k} className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {k}
            </div>
            <div className="font-display tabular mt-1 truncate text-2xl font-medium">{v}</div>
          </Card>
        ))}
      </div>
      {list.isPending ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t("common.loading")}</Card>
      ) : rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
              <HugeiconsIcon icon={ReceiptIcon} />
            </span>
            <p className="font-display text-lg">
              {t(approval ? "sales.emptyTitleApproval" : "sales.emptyTitle")}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {t(approval ? "sales.emptyBodyApproval" : "sales.emptyBody")}
            </p>
            <Button variant="outline" onClick={() => navigate({ to: "/app" })}>
              {t("sales.openPos")}
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead className="w-32">{t("doc.date")}</TableHead>
                <TableHead>{t("sales.colStatus")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("sales.colDetails")}</TableHead>
                <TableHead>{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer text-[13px]"
                  onClick={() => navigate({ to: "/app/sales/$id", params: { id: s.id } })}
                >
                  <TableCell className="font-medium">#{s.number}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(s.created_at)}</TableCell>
                  <TableCell>
                    <StatusBadge s={s.status} />
                  </TableCell>
                  <TableCell className="hidden truncate text-muted-foreground sm:table-cell">
                    {all && `${storeName(s.store_id)} · `}
                    {names.data?.[s.created_by ?? ""]}
                    {s.customer_name && ` · ${s.customer_name}`}
                  </TableCell>
                  <TableCell className="tabular font-semibold">{money(s.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 border-t p-3">
            <span className="text-xs text-muted-foreground">
              {t("sales.showing", { from, to, total })}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || list.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label={t("sales.prev")}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <span className="tabular text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || list.isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label={t("sales.next")}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
