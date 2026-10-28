import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ReceiptIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { downloadCsv, downloadPdf, fileStamp } from "@/lib/pdf";
import { fetchSalesForExport, useSalesPage, useSalesSummary, useStaffNames } from "@/lib/sales";
import { methodLabel } from "@/lib/payment-methods";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Empty,
  NoAccess,
  PageHeader,
  Pager,
  Stat,
  StatRow,
  Status,
  TableChevron,
  rowLinkProps,
} from "@/components/pos/bits";
import { ExportMenu } from "@/components/pos/ExportMenu";
import { TableSkeleton } from "@/components/pos/skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function Sales() {
  const { can } = usePos();
  if (!can("sell", "view_sales")) return <NoAccess />;
  return <SalesContent />;
}

function SalesContent() {
  const { store, stores, allStores, money, staff, business } = usePos();
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
  // Names resolve against every location, archived included: a sale made at a
  // branch that has since closed still has to say where it was sold.
  const storeName = (id: string) => allStores.find((s) => s.id === id)?.name;

  // Export is on-demand: fetch the full period only when a button is clicked so
  // ordinary browsing stays light while the download still covers every sale.
  async function runExport(kind: "csv" | "pdf") {
    // In-flight lock (the `exporting` state disables both buttons) bounds a
    // click-loop; the earlier localStorage quota was bypassable and only
    // risked blocking a legitimate owner. Real protection is RLS + the RPCs.
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
                s.payment_method ? methodLabel(s.payment_method) : "",
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

  return (
    <>
      <PageHeader
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
            {stores.length > 1 && !staff?.store_id && (
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
      <StatRow>
        {cards.map(([k, v]) => (
          <Stat key={k} label={k} value={v} loading={summary.isPending} />
        ))}
      </StatRow>
      {list.isPending ? (
        <TableSkeleton rows={6} columns={6} />
      ) : rows.length === 0 ? (
        <Empty
          icon={<HugeiconsIcon icon={ReceiptIcon} className="size-5" />}
          title={t(approval ? "sales.emptyTitleApproval" : "sales.emptyTitle")}
          action={
            <Button variant="outline" onClick={() => navigate({ to: "/app" })}>
              {t("sales.openPos")}
            </Button>
          }
        >
          {t(approval ? "sales.emptyBodyApproval" : "sales.emptyBody")}
        </Empty>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">#</TableHead>
                <TableHead className="w-36">{t("doc.date")}</TableHead>
                <TableHead className="w-40">{t("sales.colStatus")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("sales.colServed")}</TableHead>
                <TableHead>{t("common.total")}</TableHead>
                <TableChevron head />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer text-[13px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  {...rowLinkProps(() => navigate({ to: "/app/sales/$id", params: { id: s.id } }))}
                >
                  <TableCell className="font-medium">#{s.number}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(s.created_at)}</TableCell>
                  <TableCell>
                    <Status s={s.status} />
                  </TableCell>
                  <TableCell className="hidden truncate text-muted-foreground sm:table-cell">
                    {all && `${storeName(s.store_id)} · `}
                    {names.data?.[s.created_by ?? ""]}
                    {s.customer_name && ` · ${s.customer_name}`}
                  </TableCell>
                  <TableCell className="tabular font-bold">{money(s.total)}</TableCell>
                  <TableChevron />
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            page={page - 1}
            pageCount={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPage={(p) => setPage(p + 1)}
          />
        </Card>
      )}
    </>
  );
}
