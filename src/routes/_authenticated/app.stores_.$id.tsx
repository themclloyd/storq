import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@/lib/icons";
import { usePos, type Store } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import {
  LIMITS,
  firstError,
  optionalText,
  requireText,
  sanitizeText,
  validateAmount,
  validateEmail,
  validatePhone,
} from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackLink, PageHeader } from "@/components/pos/bits";
import { RadioCard, StoreTypeTag } from "@/components/pos/store-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadCsv, downloadPdf, fileStamp } from "@/lib/pdf";
import { fetchSalesForExport, fetchSaleItemsForExport } from "@/lib/sales";
import { fetchRefundsForExport } from "@/lib/refunds";
import { fetchExpensesForExport } from "@/lib/expenses";
import { fetchProductsForExport, fetchMovementsForExport } from "@/lib/products";
import { buildBusinessReport } from "@/lib/business-report";
import { methodLabel } from "@/lib/receipts";

export const Route = createFileRoute("/_authenticated/app/stores_/$id")({
  head: () => ({
    meta: [
      { title: "Location | Storq" },
      { name: "description", content: "Location VAT and receipt details." },
      { property: "og:title", content: "Location | Storq" },
      { property: "og:description", content: "Location VAT and receipt details." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StorePage,
});

const types = [
  { v: "direct", tKey: "store.typeDirect", dKey: "store.directDesc" },
  { v: "approval", tKey: "store.approvalTitle", dKey: "store.approvalDesc" },
] as const;

function StorePage() {
  const { id } = Route.useParams();
  const { stores, can } = usePos();
  const { t } = useI18n();
  if (!can("admin"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("store.onlyAdmins")}</Card>
    );
  const store = stores.find((s) => s.id === id);
  if (!store)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        {stores.length ? t("store.notFound") : t("common.loading")}
      </Card>
    );
  // Keyed so a refreshed store row resets the draft once the query returns.
  return <StoreForm key={store.id} store={store} />;
}

function StoreForm({ store }: { store: Store }) {
  const { rpc, money, business } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(store.name);
  const [type, setType] = useState<Store["store_type"]>(store.store_type);
  const [phone, setPhone] = useState(store.phone ?? "");
  const [email, setEmail] = useState(store.email ?? "");
  const [address, setAddress] = useState(store.address ?? "");
  const [taxNumber, setTaxNumber] = useState(store.tax_number ?? "");
  const [rate, setRate] = useState(String(store.tax_rate ?? 0));
  const [incl, setIncl] = useState(store.tax_inclusive ?? true);
  const [busy, setBusy] = useState(false);
  const [xbusy, setXbusy] = useState<
    Partial<
      Record<
        "sales" | "saleItems" | "refunds" | "expenses" | "products" | "movements" | "pdf" | "all",
        boolean
      >
    >
  >({});

  // ── Export helpers ──────────────────────────────────────────────────────────
  // All time — "all time" is the right default for a location export:
  // the user wants everything from that store, not just the last 30 days.
  const since = new Date("2000-01-01").toISOString();
  const stamp = fileStamp();
  const tag = store.name.replace(/\s+/g, "-");

  function xmark(key: string, v: boolean) {
    setXbusy((prev) => ({ ...prev, [key]: v }));
  }
  const anyX = Object.values(xbusy).some(Boolean);

  const xSales = useCallback(async () => {
    xmark("sales", true);
    try {
      const rows = await fetchSalesForExport({ storeId: store.id, since });
      if (!rows.length) {
        toast.info(t("xport.emptyDataset"));
        return;
      }
      downloadCsv(`storq-sales-${tag}-${stamp}.csv`, [
        [
          "Sale #",
          "Date",
          "Status",
          "Payment method",
          "Customer",
          "Total",
          "Tax",
          "Paid",
          "Refunded",
          "Staff",
        ],
        ...rows.map((r) => [
          r.number,
          r.created_at,
          r.status,
          r.payment_method ?? "",
          r.customer_name ?? "",
          r.total,
          r.tax,
          r.paid,
          r.refunded,
          r.created_by ?? "",
        ]),
      ]);
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("sales", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, stamp, tag]);

  const xSaleItems = useCallback(async () => {
    xmark("saleItems", true);
    try {
      const rows = await fetchSaleItemsForExport({ storeId: store.id, since });
      if (!rows.length) {
        toast.info(t("xport.emptyDataset"));
        return;
      }
      downloadCsv(`storq-sale-items-${tag}-${stamp}.csv`, [
        ["Sale #", "Date", "Status", "Product ID", "Name", "Qty", "Unit price", "Line total"],
        ...rows.map((r) => [
          r.sale_number,
          r.sale_created_at,
          r.sale_status,
          r.product_id ?? "",
          r.product_name,
          r.qty,
          r.unit_price,
          r.line_total,
        ]),
      ]);
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("saleItems", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, stamp, tag]);

  const xRefunds = useCallback(async () => {
    xmark("refunds", true);
    try {
      const rows = await fetchRefundsForExport({ storeId: store.id, since });
      if (!rows.length) {
        toast.info(t("xport.emptyDataset"));
        return;
      }
      const body = rows.flatMap((r) =>
        r.refund_items.length
          ? r.refund_items.map((i) => [
              r.number,
              r.created_at,
              r.sale_id,
              i.name,
              Number(i.qty),
              Number(i.amount),
              Number(i.cost),
              i.restock ? "yes" : "no",
              r.method,
              r.reason ?? "",
            ])
          : [
              [
                r.number,
                r.created_at,
                r.sale_id,
                "",
                "",
                r.amount,
                r.cost,
                "",
                r.method,
                r.reason ?? "",
              ],
            ],
      );
      downloadCsv(`storq-refunds-${tag}-${stamp}.csv`, [
        [
          "Refund #",
          "Date",
          "Sale #",
          "Item",
          "Qty",
          "Amount",
          "Cost",
          "Restocked",
          "Method",
          "Reason",
        ],
        ...body,
      ]);
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("refunds", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, stamp, tag]);

  const xExpenses = useCallback(async () => {
    xmark("expenses", true);
    try {
      const rows = await fetchExpensesForExport({ storeId: store.id, since });
      if (!rows.length) {
        toast.info(t("xport.emptyDataset"));
        return;
      }
      downloadCsv(`storq-expenses-${tag}-${stamp}.csv`, [
        ["Date", "Category", "Source", "Amount", "Note", "Staff"],
        ...rows.map((r) => [
          r.spent_on,
          r.category,
          r.source,
          r.amount,
          r.note ?? "",
          r.created_by ?? "",
        ]),
      ]);
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("expenses", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, stamp, tag]);

  const xProducts = useCallback(async () => {
    xmark("products", true);
    try {
      const rows = await fetchProductsForExport(store.id);
      if (!rows.length) {
        toast.info(t("xport.emptyDataset"));
        return;
      }
      downloadCsv(`storq-products-${tag}-${stamp}.csv`, [
        [
          "Name",
          "SKU / code",
          "Category",
          "Selling price",
          "Buying cost",
          "In stock",
          "Active",
          "Reorder point",
        ],
        ...rows.map((r) => [
          r.name,
          r.sku ?? "",
          r.category ?? "",
          r.price,
          r.cost,
          r.qty,
          r.active ? "yes" : "no",
          r.reorder_point ?? "",
        ]),
      ]);
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("products", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, stamp, tag]);

  const xMovements = useCallback(async () => {
    xmark("movements", true);
    try {
      const rows = await fetchMovementsForExport({ storeId: store.id, since });
      if (!rows.length) {
        toast.info(t("xport.emptyDataset"));
        return;
      }
      downloadCsv(`storq-stock-movements-${tag}-${stamp}.csv`, [
        ["Date", "Product", "Product ID", "Change", "Balance after", "Reason", "Note", "Reference"],
        ...rows.map((r) => [
          r.created_at,
          r.product_name,
          r.product_id,
          r.delta,
          r.balance_after,
          r.reason,
          r.note ?? "",
          r.ref_id ?? "",
        ]),
      ]);
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("movements", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, stamp, tag]);

  const xPdf = useCallback(async () => {
    xmark("pdf", true);
    try {
      const [salesRows, refundRows, expenseRows, productRows] = await Promise.all([
        fetchSalesForExport({ storeId: store.id, since }),
        fetchRefundsForExport({ storeId: store.id, since }),
        fetchExpensesForExport({ storeId: store.id, since }),
        fetchProductsForExport(store.id),
      ]);
      const report = buildBusinessReport({
        sales: salesRows.map((r) => ({
          id: r.number.toString(),
          store_id: r.store_id,
          status: r.status,
          total: r.total,
          paid: r.paid,
          tax: r.tax,
          payment_method: r.payment_method,
          sale_items: [],
        })),
        refunds: refundRows.map((r) => ({
          store_id: r.store_id,
          amount: r.amount,
          cost: r.cost,
          tax: r.tax,
          refund_items: r.refund_items.map((i) => ({
            product_id: i.product_id,
            name: i.name,
            qty: i.qty,
            amount: i.amount,
            cost: i.cost,
          })),
        })),
        expenses: expenseRows.map((e) => ({
          store_id: e.store_id,
          amount: e.amount,
          category: e.category,
          source: e.source,
        })),
        costs: {},
      });
      const cur = business?.currency ?? "R";
      const fmt = (n: number) => money(n);
      const pct = (n: number) => `${n.toFixed(1)}%`;
      const methods = Object.entries(report.byMethod).sort((a, b) => b[1] - a[1]);
      const cats = Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]);
      const activeProds = productRows.filter((p) => p.active);
      const totalUnits = activeProds.reduce((s, p) => s + p.qty, 0);
      const retailVal = activeProds.reduce((s, p) => s + p.qty * p.price, 0);
      const costVal = activeProds.reduce((s, p) => s + p.qty * p.cost, 0);
      const topStock = [...activeProds]
        .filter((p) => p.qty > 0)
        .sort((a, b) => b.qty * b.price - a.qty * a.price)
        .slice(0, 20);
      const lowStock = activeProds
        .filter((p) => p.reorder_point != null && p.qty <= p.reorder_point)
        .sort((a, b) => a.qty - b.qty)
        .slice(0, 15);
      const refundByMethod: Record<string, number> = {};
      for (const r of refundRows)
        refundByMethod[r.method] = (refundByMethod[r.method] ?? 0) + r.amount;
      await downloadPdf({
        filename: `storq-full-report-${tag}-${stamp}`,
        title: t("xport.pdfTitle"),
        business: business?.name,
        subtitle: `${store.name} · ${t("xport.rangeAllTime")}`,
        badge: report.realProfit >= 0 ? t("bizReport.badgeProfit") : t("bizReport.badgeLoss"),
        meta: [
          [t("bizReport.pdfScope"), store.name],
          [t("bizReport.pdfCurrency"), cur],
          [
            t("bizReport.pdfIssued"),
            new Date().toLocaleDateString("en-ZA", { dateStyle: "medium" }),
          ],
        ],
        kpis: [
          [t("bizReport.collected"), fmt(report.moneyCollected)],
          [t("bizReport.stockCost"), fmt(report.stockCost)],
          [t("bizReport.expenses"), fmt(report.expenses)],
          [t("bizReport.realProfit"), fmt(report.realProfit)],
        ],
        sections: [
          {
            type: "pairs",
            heading: t("bizReport.pdfStatement"),
            rows: [
              [t("bizReport.totalSales"), fmt(report.grossSales)],
              [`  - ${t("bizReport.refunds")}`, `-${fmt(report.refunds)}`],
              [`= ${t("bizReport.collected")}`, fmt(report.moneyCollected)],
              [`  - ${t("bizReport.stockCost")}`, `-${fmt(report.stockCost)}`],
              [
                `= ${t("bizReport.productProfit")} (${pct(report.productMargin)})`,
                fmt(report.productProfit),
              ],
              [`  - ${t("bizReport.expenses")}`, `-${fmt(report.expenses)}`],
              [
                `= ${t("bizReport.realProfit")} (${pct(report.realMargin)})`,
                fmt(report.realProfit),
              ],
            ],
          },
          {
            type: "pairs",
            heading: t("bizReport.quickFacts"),
            rows: [
              [t("bizReport.orders"), String(report.orders)],
              [t("bizReport.avgSale"), fmt(report.avgSale)],
              [t("bizReport.units"), String(report.unitsSold)],
              [t("bizReport.vat"), fmt(report.tax)],
              [t("xport.pdfRefundCount"), String(refundRows.length)],
              [t("xport.pdfRefundTotal"), fmt(report.refunds)],
            ],
          },
          ...(methods.length
            ? [
                {
                  type: "table" as const,
                  heading: t("bizReport.pdfMoney"),
                  head: [t("reports.thMethod"), t("reports.thAmount"), t("xport.pdfShare")],
                  align: ["left", "right", "right"] as ("left" | "right")[],
                  body: methods.map(([m, v]) => [
                    methodLabel(m),
                    fmt(v),
                    report.moneyCollected ? pct((v / report.moneyCollected) * 100) : "-",
                  ]),
                  foot: [t("bizReport.totalSales"), fmt(report.grossSales), ""],
                },
              ]
            : []),
          ...(cats.length
            ? [
                {
                  type: "table" as const,
                  heading: t("bizReport.spending"),
                  head: [t("reports.thCategory"), t("reports.thAmount"), t("xport.pdfShare")],
                  align: ["left", "right", "right"] as ("left" | "right")[],
                  body: cats.map(([c, v]) => [
                    c,
                    fmt(v),
                    report.expenses ? pct((v / report.expenses) * 100) : "-",
                  ]),
                  foot: [t("exp.totalExpenses"), fmt(report.expenses), ""],
                },
              ]
            : []),
          ...(Object.keys(refundByMethod).length
            ? [
                {
                  type: "table" as const,
                  heading: t("xport.pdfRefundsByMethod"),
                  head: [t("reports.thMethod"), t("reports.thAmount")],
                  align: ["left", "right"] as ("left" | "right")[],
                  body: Object.entries(refundByMethod)
                    .sort((a, b) => b[1] - a[1])
                    .map(([m, v]) => [methodLabel(m), fmt(v)]),
                  foot: [t("xport.pdfRefundTotal"), fmt(report.refunds)],
                },
              ]
            : []),
          {
            type: "pairs" as const,
            heading: t("xport.pdfInventoryTitle"),
            rows: [
              [t("xport.pdfActiveItems"), String(activeProds.length)],
              [t("xport.pdfTotalUnits"), String(totalUnits)],
              [t("xport.pdfRetailValue"), fmt(retailVal)],
              [t("xport.pdfCostValue"), fmt(costVal)],
            ],
          },
          ...(topStock.length
            ? [
                {
                  type: "table" as const,
                  heading: t("xport.pdfTopStock"),
                  head: [
                    t("bizReport.thItem"),
                    t("xport.colInStock"),
                    t("xport.colPrice"),
                    t("xport.pdfStockValue"),
                  ],
                  align: ["left", "right", "right", "right"] as ("left" | "right")[],
                  body: topStock.map((p) => [p.name, p.qty, fmt(p.price), fmt(p.qty * p.price)]),
                },
              ]
            : []),
          ...(lowStock.length
            ? [
                {
                  type: "table" as const,
                  heading: t("xport.pdfLowStock"),
                  head: [t("bizReport.thItem"), t("xport.colInStock"), t("inv.reorderPointField")],
                  align: ["left", "right", "right"] as ("left" | "right")[],
                  body: lowStock.map((p) => [p.name, p.qty, p.reorder_point ?? ""]),
                },
              ]
            : []),
          { type: "text" as const, text: t("reports.footerNote") },
          { type: "text" as const, heading: " ", text: t("bizReport.pdfSignoff") },
        ],
      });
    } catch {
      toast.error(t("xport.errorMsg"));
    } finally {
      xmark("pdf", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, store.name, stamp, tag]);

  const xAll = useCallback(async () => {
    xmark("all", true);
    try {
      const delay = () => new Promise<void>((r) => setTimeout(r, 350));
      await xSales();
      await delay();
      await xSaleItems();
      await delay();
      await xRefunds();
      await delay();
      await xExpenses();
      await delay();
      await xProducts();
      await delay();
      await xMovements();
      await delay();
      await xPdf();
    } finally {
      xmark("all", false);
    }
  }, [xSales, xSaleItems, xRefunds, xExpenses, xProducts, xMovements, xPdf]);

  async function save() {
    const err = firstError(
      requireText(name, t("store.locationName"), LIMITS.storeName),
      validatePhone(phone, true),
      email.trim() ? validateEmail(email) : null,
      optionalText(address, t("store.address"), LIMITS.address),
      optionalText(taxNumber, t("store.taxNumber"), LIMITS.taxId),
      validateAmount(rate, { label: t("store.taxRate"), min: 0, max: 50 }),
    );
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      await rpc("save_store", {
        p_id: store.id,
        p_name: sanitizeText(name, LIMITS.storeName),
        p_type: type,
        p_phone: phone.trim(),
        p_email: email.trim() || null,
        p_address: address.trim() ? sanitizeText(address, LIMITS.address) : null,
        p_tax_number: taxNumber.trim() || null,
        p_tax_rate: Number(rate || 0),
        p_tax_inclusive: incl,
      });
      toast.success(t("common.saved"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sample = 1000;
  const rateNum = Number(rate || 0);
  const net = incl ? sample / (1 + rateNum / 100) : sample;
  const vat = incl ? sample - net : (sample * rateNum) / 100;

  return (
    <>
      <BackLink to="/app/stores" label={t("store.title")} />
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("store.title")} / ${store.name}`}
        title={store.name}
        sub={<StoreTypeTag type={store.store_type} />}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={anyX}>
                <HugeiconsIcon icon={Download01Icon} />
                {anyX ? t("xport.downloading") : t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t("xport.storeExportLabel")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={xPdf} className="font-medium">
                <HugeiconsIcon icon={Download01Icon} className="text-primary" />
                {t("xport.pdfReportTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">PDF</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={xAll}>
                {t("xport.downloadAllBtn")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">ZIP</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={xSales}>
                {t("xport.salesTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={xSaleItems}>
                {t("xport.saleItemsTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={xRefunds}>
                {t("xport.refundsTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={xExpenses}>
                {t("xport.expensesTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={xProducts}>
                {t("xport.productsTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={xMovements}>
                {t("xport.movementsTitle")}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">CSV</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
        <Card className="space-y-3 p-5">
          <div>
            <h3 className="font-display text-base font-medium">{t("store.detailsTitle")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("store.detailsDesc")}</p>
          </div>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.locationName")}
            </span>
            <Input
              maxLength={LIMITS.storeName}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, LIMITS.storeName))}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.phone")}
            </span>
            <Input
              inputMode="tel"
              maxLength={LIMITS.phone}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.email")}
            </span>
            <Input
              type="email"
              inputMode="email"
              maxLength={LIMITS.email}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.address")}
            </span>
            <Input
              maxLength={LIMITS.address}
              value={address}
              onChange={(e) => setAddress(e.target.value.slice(0, LIMITS.address))}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.taxNumber")}
            </span>
            <Input
              maxLength={LIMITS.taxId}
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value.slice(0, LIMITS.taxId))}
            />
          </Label>
        </Card>

        <Card className="space-y-3 p-5">
          <div>
            <h3 className="font-display text-base font-medium">{t("store.taxTitle")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("store.taxDesc")}</p>
          </div>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("store.taxRatePct")}
            </span>
            <Input
              inputMode="decimal"
              maxLength={5}
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </Label>
          <div role="radiogroup" aria-label={t("store.taxTitle")} className="space-y-2">
            {(
              [
                [true, "store.inclTitle", "store.inclDesc"],
                [false, "store.addVatTitle", "store.addVatDesc"],
              ] as const
            ).map(([v, ti, di]) => (
              <RadioCard
                key={String(v)}
                checked={incl === v}
                onSelect={() => setIncl(v)}
                title={t(ti)}
                desc={t(di)}
              />
            ))}
          </div>
          <div className="rounded-2xl bg-secondary/50 p-3 text-[13px]">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("store.taxExample", { amount: money(sample) })}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("store.exampleNet")}</span>
              <span className="tabular font-medium">{money(net)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">{t("store.exampleVat")}</span>
              <span className="tabular font-medium">{money(vat)}</span>
            </div>
            <div className="mt-1 flex justify-between gap-3 border-t pt-1.5">
              <span className="font-medium">{t("store.exampleTotal")}</span>
              <span className="tabular font-semibold">{money(net + vat)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 max-w-4xl rounded-2xl border p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("store.typeTitle")}
        </div>
        <div
          role="radiogroup"
          aria-label={t("store.typeTitle")}
          className="grid gap-2 md:grid-cols-2"
        >
          {types.map((opt) => (
            <RadioCard
              key={opt.v}
              checked={type === opt.v}
              onSelect={() => setType(opt.v)}
              title={t(opt.tKey)}
              desc={t(opt.dKey)}
            />
          ))}
        </div>
      </div>

      <Button className="mt-5" disabled={busy || !name || !phone} onClick={save}>
        {t("common.save")}
      </Button>
    </>
  );
}
