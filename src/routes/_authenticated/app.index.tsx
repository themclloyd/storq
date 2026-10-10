import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useDeferredValue, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BanknoteIcon,
  CreditCardIcon,
  Delete02Icon,
  MinusSignIcon,
  PlusSignIcon,
  Search01Icon,
  Simcard01Icon,
} from "@hugeicons/core-free-icons";
import {
  useProducts,
  useStock,
  findByBarcode,
  round2,
  cartCapBlocked,
  lineCapBlocked,
  type Product,
} from "@/lib/products";
import { SALE_TOUCHED, invalidateKeys } from "@/lib/cache-invalidation";
import { usePos } from "@/lib/pos";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Empty, Field, NativeSelect, StoreTypeTag } from "@/components/pos/bits";
import { ReceiptModal } from "@/components/pos/ReceiptModal";
import { ScanCamera, ScanCameraButton } from "@/components/pos/ScanCamera";
import { useScannerWedge } from "@/components/pos/use-scanner";
import { DiscountDialog, type DiscountLine } from "@/components/pos/DiscountDialog";
import { Receipt, type ReceiptTender } from "@/lib/receipts";
import { validatePin } from "@/lib/validate";
import { cn } from "@/lib/utils";
import { useCollections, salePrice } from "@/lib/collections";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: "Register — Storq" },
      { name: "description", content: "Ring up sales and create layby or approval invoices." },
      { property: "og:title", content: "Register — Storq" },
      {
        property: "og:description",
        content: "Ring up sales and create layby or approval invoices.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Register,
});

const tiles = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5", "bg-tile-6"];
const tileFor = (s: string) =>
  tiles[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % tiles.length];

type Line = { p: Product; qty: number };
type TenderRow = { method: string; amount: number };
type SaleForm = {
  payment: number;
  method: string;
  tenders: TenderRow[];
  name: string;
  phone: string;
  note: string;
  overridePin: string | null;
};

/** Change comes only from the cash portion beyond what the other tenders miss. */
function calcChange(tenders: TenderRow[], total: number, kind: "sale" | "layby"): number {
  if (kind !== "sale") return 0;
  const cash = tenders.filter((t) => t.method === "cash").reduce((a, t) => a + t.amount, 0);
  const other = tenders.filter((t) => t.method !== "cash").reduce((a, t) => a + t.amount, 0);
  return Math.max(0, round2(cash - Math.max(0, total - other)));
}

function Register() {
  const { store, money, business, staff, checkout, can } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const products = useProducts();
  const stock = useStock(store?.id);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [discounts, setDiscounts] = useState<Record<string, number>>({});
  const [showDisc, setShowDisc] = useState(false);
  const [dlg, setDlg] = useState<null | "sale" | "layby">(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [scanning, setScanning] = useState(false);
  // Codes seen while the catalog query refreshed: applied once a match exists.
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const cols = useCollections();
  // Catalog filtering runs over the whole cached product list, so memoize it
  // (avoids re-scanning on every cart/discount render) and defer the search
  // term so the input stays instantly responsive while tiles catch up.
  const list = useMemo(() => (products.data ?? []).filter((p) => p.active), [products.data]);
  const price = (p: Product) => salePrice(p, cols.data);
  const cats = (cols.data?.list ?? []).map((c) => c.id);
  const catName = (id: string) => cols.data?.list.find((c) => c.id === id)?.name ?? "";
  const dq = useDeferredValue(q);
  // The till reveals stock only on demand: a search term or an opened category
  // shows the tiles, so the register never dumps the whole menu up front — a
  // store rings up what the customer asks for (like a restaurant order), and a
  // barcode scan drops the item straight into the cart.
  const browsing = dq.trim().length > 0 || !!cat;
  const shown = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    return list.filter(
      (p) =>
        (!cat || (cols.data?.byProduct[p.id] ?? []).includes(cat)) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle)),
    );
  }, [list, cat, cols.data, dq]);
  // Discount-adjusted money: net sub = gross - per-line discounts, tax on net.
  const lineGross = (l: Line) => round2(l.qty * price(l.p));
  const lineDisc = (l: Line) => Math.min(round2(discounts[l.p.id] ?? 0), lineGross(l));
  // lineGross/lineDisc close over `price` (a cols.data-derived fn), so these
  // totals recompute each render — cheap over a single cart, no memo needed.
  const grossSub = round2(cart.reduce((a, l) => a + lineGross(l), 0));
  const discountTotal = round2(cart.reduce((a, l) => a + lineDisc(l), 0));
  const netSub = round2(grossSub - discountTotal);
  const rate = Number(business?.tax_rate ?? 0);
  const incl = business?.tax_inclusive ?? true;
  const tax = rate > 0 ? (incl ? netSub - netSub / (1 + rate / 100) : (netSub * rate) / 100) : 0;
  const total = rate > 0 && !incl ? netSub + tax : netSub;
  const approval = store?.store_type === "approval";
  const cashier = !can("admin", "manager");
  // Cashiers need a manager PIN once any line or the basket passes the 10% cap.
  const overCap =
    discountTotal > 0 &&
    cashier &&
    (cartCapBlocked(grossSub, discountTotal) ||
      cart.some((l) => lineCapBlocked(lineGross(l), lineDisc(l))));

  const add = (p: Product) =>
    setCart((c) =>
      c.find((l) => l.p.id === p.id)
        ? c.map((l) => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { p, qty: 1 }],
    );
  const setQty = (id: string, qty: number) =>
    setCart((c) =>
      qty <= 0 ? c.filter((l) => l.p.id !== id) : c.map((l) => (l.p.id === id ? { ...l, qty } : l)),
    );

  // ---- barcode: hardware wedge + camera scan ----
  const applyCode = (code: string) => {
    const p = findByBarcode(list, code);
    if (p) {
      add(p);
      return true;
    }
    setPendingScan(code);
    return false;
  };
  useScannerWedge(applyCode, { enabled: !!store && !dlg && !scanning });
  useEffect(() => {
    if (!pendingScan) return;
    const p = findByBarcode(list, pendingScan);
    if (p) {
      add(p);
      setPendingScan(null);
    } else if (products.isFetched) {
      toast.error(t("till.noBarcodeMatch", { code: pendingScan }));
      setPendingScan(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScan, products.data]);
  // `/` focuses the search box, like Square/Shopify tills.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target;
      if (
        e.key === "/" &&
        !(
          el instanceof HTMLElement &&
          (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
        )
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function finish(kind: "sale" | "layby", f: SaleForm) {
    if (!store) return;
    const lines = cart.map((l) => ({
      name: l.p.name,
      qty: l.qty,
      price: price(l.p),
      total: lineGross(l),
    }));
    const disList = cart
      .map((l) => ({ product_id: l.p.id, amount: lineDisc(l) }))
      .filter((d) => d.amount > 0);
    const tenderArg = f.tenders.map((t) => ({ method: t.method, amount: round2(t.amount) }));
    const distinct = new Set(f.tenders.map((t) => t.method));
    const pm = !f.tenders.length
      ? "cash"
      : distinct.size > 1
        ? "split"
        : (f.tenders[0]?.method ?? "cash");
    const tenderSum = f.tenders.reduce((a, t) => a + t.amount, 0);
    try {
      const r = await checkout(
        {
          p_store: store.id,
          p_kind: kind,
          p_items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })),
          p_payment: f.payment,
          p_method: f.method,
          p_customer_name: f.name || null,
          p_customer_phone: f.phone || null,
          p_note: f.note || null,
          ...(tenderArg.length ? { p_tenders: tenderArg } : {}),
          ...(disList.length ? { p_discounts: disList } : {}),
          ...(f.overridePin ? { p_override_pin: f.overridePin } : {}),
        },
        { offlineOk: kind === "sale" && !approval, estTotal: Math.round(total * 100) / 100 },
      );
      if (r.offline) {
        setCart([]);
        setDiscounts({});
        setDlg(null);
        const change = calcChange(f.tenders, r.total, kind);
        toast.success(
          t("till.noInternetSale", { amount: money(r.total) }) +
            (change ? t("till.changeSuffix", { amount: money(change) }) : ""),
        );
        return;
      }
      setCart([]);
      setDiscounts({});
      setDlg(null);
      invalidateKeys(qc, SALE_TOUCHED);
      // Approval invoices carry no payment yet, so only completed sales / laybys get a receipt.
      if (r.status !== "pending_approval") {
        setReceipt({
          number: r.number,
          kind,
          status: r.status,
          bizName: business?.name ?? "Storq",
          storeName: store.name,
          cashier: staff?.name ?? "Staff",
          date: new Date().toISOString(),
          lines,
          subtotal: grossSub,
          discount: discountTotal,
          tax: r.tax,
          taxRate: rate,
          taxInclusive: incl,
          total: r.total,
          method: pm,
          tenders: f.tenders.map((t) => ({ method: t.method, raw: t.amount }) as ReceiptTender),
          paid: kind === "layby" ? round2(f.tenders.length ? tenderSum : f.payment) : r.total,
          change: calcChange(f.tenders, r.total, kind),
          customerName: f.name || null,
          customerPhone: f.phone || null,
          note: f.note || null,
        });
      } else {
        toast.success(t("till.invoiceSentApproval", { no: r.number }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!store) return <Empty>{t("till.addStoreFirst")}</Empty>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="min-w-0">
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Label htmlFor="pos-search" className="sr-only">
              {t("till.searchLabel")}
            </Label>
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              id="pos-search"
              className="h-11 bg-card pl-9"
              placeholder={t("till.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <ScanCameraButton onOpen={() => setScanning(true)} />
          <StoreTypeTag type={store.store_type} />
        </div>
        {cats.length > 0 && (
          <ToggleGroup
            type="single"
            value={cat ?? "all"}
            onValueChange={(v) => setCat(v && v !== "all" ? v : null)}
            className="mb-4 justify-start gap-2 overflow-x-auto"
          >
            <ToggleGroupItem
              value="all"
              className="shrink-0 rounded-full px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {t("till.all")}
            </ToggleGroupItem>
            {cats.map((id) => (
              <ToggleGroupItem
                key={id}
                value={id}
                className="shrink-0 rounded-full px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {catName(id)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {products.isError ? (
          <Empty>
            <div className="flex flex-col items-center gap-3">
              <span>{t("errors.generic")}</span>
              <Button size="sm" variant="outline" onClick={() => void products.refetch()}>
                {t("common.tryAgain")}
              </Button>
            </div>
          </Empty>
        ) : list.length === 0 ? (
          <Empty>{products.isFetched ? t("till.noItemsYet") : t("common.loading")}</Empty>
        ) : !browsing ? (
          <Empty>{t("till.searchToStart")}</Empty>
        ) : shown.length === 0 ? (
          <Empty>{t("till.noMatchingItems")}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => {
              const s = stock.data?.[p.id] ?? 0;
              return (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  className="pos-tile pos-card overflow-hidden text-left hover:shadow-[var(--shadow-pop)]"
                >
                  <div
                    className={cn(
                      "grid h-20 place-items-center text-2xl font-extrabold text-tile-foreground",
                      tileFor(p.name),
                    )}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="p-3">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 flex justify-between text-xs">
                      <span className="tabular font-semibold">
                        {price(p) < Number(p.price) && (
                          <span className="mr-1 font-normal text-muted-foreground line-through">
                            {money(p.price)}
                          </span>
                        )}
                        {money(price(p))}
                      </span>
                      <span
                        className={cn(
                          "tabular",
                          s <= 0 ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {t("till.inStock", { count: s })}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <Card className="flex h-fit flex-col shadow-none lg:sticky lg:top-8">
        <CardHeader className="space-y-0 border-b px-5 py-4">
          <CardTitle className="font-bold">
            {approval ? t("till.currentInvoice") : t("till.currentSale")}
          </CardTitle>
          <CardDescription className="text-xs">{store.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="max-h-[45vh]">
            <div className="divide-y">
              {cart.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  {t("till.tapItems")}
                </p>
              )}
              {cart.map((l) => {
                const d = lineDisc(l);
                const net = round2(lineGross(l) - d);
                return (
                  <div key={l.p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{l.p.name}</div>
                      <div className="tabular text-xs text-muted-foreground">
                        {money(price(l.p))} {t("till.eachWord")}
                        {d > 0 && <span className="ml-1 text-warning">· -{money(d)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7"
                        onClick={() => setQty(l.p.id, l.qty - 1)}
                      >
                        {l.qty === 1 ? (
                          <HugeiconsIcon icon={Delete02Icon} />
                        ) : (
                          <HugeiconsIcon icon={MinusSignIcon} />
                        )}
                      </Button>
                      <span className="tabular w-7 text-center text-sm font-bold">{l.qty}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7"
                        onClick={() => setQty(l.p.id, l.qty + 1)}
                      >
                        <HugeiconsIcon icon={PlusSignIcon} />
                      </Button>
                    </div>
                    <div className="tabular w-20 text-right text-sm font-semibold">
                      {d > 0 && (
                        <div className="text-xs font-normal text-muted-foreground line-through">
                          {money(lineGross(l))}
                        </div>
                      )}
                      {money(net)}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3 border-t bg-secondary/25 p-5 pt-5">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!cart.length}
            onClick={() => setShowDisc(true)}
          >
            {discountTotal > 0
              ? t("till.discountApplied", { amount: money(discountTotal) })
              : t("till.addDiscount")}
          </Button>
          {discountTotal > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{t("till.lineItems")}</span>
              <span className="tabular">{money(grossSub)}</span>
            </div>
          )}
          {rate > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                {t("till.vat")} {rate}% ({incl ? t("till.included") : t("till.added")})
              </span>
              <span className="tabular">{money(tax)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">{t("common.total")}</span>
            <span className="tabular text-3xl font-extrabold">{money(total)}</span>
          </div>
          <Button
            size="xl"
            variant="default"
            className="w-full"
            disabled={!cart.length}
            onClick={() => setDlg("sale")}
          >
            {approval ? t("till.sendForApproval") : t("till.charge", { amount: money(total) })}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            disabled={!cart.length}
            onClick={() => setDlg("layby")}
          >
            {approval ? t("till.laybyInvoice") : t("till.startLayby")}
          </Button>
        </CardFooter>
      </Card>

      {dlg && (
        <CheckoutDialog
          kind={dlg}
          total={total}
          approval={approval}
          needsPin={overCap}
          onClose={() => setDlg(null)}
          onDone={(f) => finish(dlg, f)}
        />
      )}
      {showDisc && (
        <DiscountDialog
          lines={cart.map((l): DiscountLine => ({
            id: l.p.id,
            name: l.p.name,
            unit: price(l.p),
            qty: l.qty,
          }))}
          discounts={discounts}
          onApply={setDiscounts}
          onClose={() => setShowDisc(false)}
        />
      )}
      {receipt && <ReceiptModal receipt={receipt} money={money} onClose={() => setReceipt(null)} />}
      {scanning && (
        <ScanCamera onDetected={(code) => applyCode(code)} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}

const payMethods = [
  { v: "cash", k: "till.payCash", i: BanknoteIcon },
  { v: "card", k: "till.payCard", i: CreditCardIcon },
  { v: "mobile", k: "till.payMobile", i: Simcard01Icon },
] as const;

const sectionLabel = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

function CheckoutDialog({
  kind,
  total,
  approval,
  needsPin,
  onClose,
  onDone,
}: {
  kind: "sale" | "layby";
  total: number;
  approval: boolean;
  needsPin: boolean;
  onClose: () => void;
  onDone: (f: SaleForm) => Promise<void>;
}) {
  const { money, store, business } = usePos();
  const { t } = useI18n();
  const methodOpts = payMethods.map((m) => ({ value: m.v, label: t(m.k) }));
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [extra, setExtra] = useState<{ method: string; amount: string }[]>([]);
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pay = Number(tendered || 0);
  const splitting = extra.length > 0;
  const rate = Number(business?.tax_rate ?? 0);
  const currency = business?.currency ?? "R";
  // Notes a cashier is likely holding: the next round amounts above the total.
  const step = total >= 5000 ? 5000 : total >= 1000 ? 1000 : 100;
  const upTo = (m: number) => Math.ceil(total / m) * m;
  const notes = [...new Set([upTo(step), upTo(step * 2), upTo(step * 4)])]
    .filter((v) => v > total)
    .slice(0, 2);

  // Split rows carry their own amounts; the primary row is the cash field when
  // cash, or covers the remainder when a lone card/mobile tender (no split).
  const tenders: TenderRow[] = approval
    ? []
    : splitting
      ? [
          { method, amount: pay },
          ...extra.map((e) => ({ method: e.method, amount: Number(e.amount || 0) })),
        ].filter((t) => t.amount > 0)
      : [];
  const sumT = tenders.reduce((a, t) => a + t.amount, 0);
  const covered = !splitting ? (method === "cash" ? pay : total) : sumT;
  const short = round2(total - covered);
  const change = approval
    ? 0
    : calcChange(splitting ? tenders : [{ method, amount: pay }], total, kind);
  const showAmount = !approval && (method === "cash" || splitting);

  const submit = async () => {
    setBusy(true);
    await onDone({
      payment: approval
        ? 0
        : kind === "sale" && !splitting
          ? total
          : round2(splitting ? sumT : pay),
      method,
      tenders: splitting ? tenders : [],
      name,
      phone,
      note,
      overridePin: needsPin ? pin : null,
    });
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden bg-card p-0 shadow-[var(--shadow-pop)]">
        <DialogHeader className="space-y-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>
            {approval
              ? kind === "layby"
                ? t("till.titleLaybyApproval")
                : t("till.titleInvoiceApproval")
              : kind === "layby"
                ? t("till.titleStartLayby")
                : t("till.titleTakePayment")}
          </DialogTitle>
          <DialogDescription className="mt-1.5 truncate text-xs">
            {store?.name} ·{" "}
            {approval
              ? t("till.subApprovalInvoice")
              : kind === "layby"
                ? t("till.subLayby")
                : t("till.subDirectSale")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-5">
          <div className="rounded-lg bg-secondary/45 px-4 py-3 text-center">
            <div className={sectionLabel}>
              {approval ? t("till.invoiceTotal") : t("till.amountDue")}
            </div>
            <div className="tabular mt-1 text-3xl font-extrabold">{money(total)}</div>
            {rate > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t("till.vat")} {rate}%{" "}
                {business?.tax_inclusive ? t("till.included") : t("till.added")}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {approval ? (
            <Alert className="border-warning/40 bg-warning/15 text-warning-foreground">
              <AlertDescription className="text-xs [&_p]:leading-relaxed">
                {t("till.approvalNote")}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label className={sectionLabel}>
                {splitting ? t("till.payment1Method") : t("till.paymentMethod")}
              </Label>
              <ToggleGroup
                type="single"
                value={method}
                onValueChange={(v) => v && setMethod(v)}
                className="gap-1 rounded-full border border-input bg-muted/60 p-1"
              >
                {payMethods.map((m) => (
                  <ToggleGroupItem
                    key={m.v}
                    value={m.v}
                    className="flex-1 rounded-full px-2 py-2 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    <HugeiconsIcon icon={m.i} className="size-4 shrink-0" />
                    <span className="truncate">{t(m.k)}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {showAmount && (
            <div className="space-y-2">
              <Field
                label={
                  splitting
                    ? t("till.labelAmount")
                    : kind === "layby"
                      ? t("till.labelDepositPaidNow")
                      : t("till.labelCashReceived")
                }
              >
                <Input
                  inputMode="decimal"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder="0.00"
                  className="tabular h-12 bg-card text-right text-xl font-bold md:text-xl"
                />
              </Field>
              {!splitting && (
                <div className="flex flex-wrap gap-2">
                  <Tender active={pay === total} onClick={() => setTendered(String(total))}>
                    {kind === "layby" ? t("till.tenderFullAmount") : t("till.tenderExact")}
                  </Tender>
                  {notes.map((v) => (
                    <Tender key={v} active={pay === v} onClick={() => setTendered(String(v))}>
                      {currency} {v.toLocaleString("en-ZA")}
                    </Tender>
                  ))}
                </div>
              )}
            </div>
          )}

          {!approval && (
            <div className="space-y-2">
              {extra.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <NativeSelect
                    className="w-36"
                    value={e.method}
                    onChange={(v) =>
                      setExtra((x) => x.map((r, j) => (j === i ? { ...r, method: v } : r)))
                    }
                    options={methodOpts}
                  />
                  <Input
                    inputMode="decimal"
                    aria-label={t("till.ariaPaymentAmount", { no: i + 2 })}
                    value={e.amount}
                    onChange={(ev) =>
                      setExtra((x) =>
                        x.map((r, j) => (j === i ? { ...r, amount: ev.target.value } : r)),
                      )
                    }
                    placeholder="0.00"
                    className="tabular h-9 flex-1 text-right"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0"
                    aria-label={t("till.ariaRemovePayment")}
                    onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setExtra((x) => [...x, { method: x.length ? "mobile" : "card", amount: "" }])
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                {t("till.addAnotherPayment")}
              </Button>
            </div>
          )}

          {splitting && short > 0.005 && (
            <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                {t("till.remainingDue")}
              </span>
              <span className="tabular text-lg font-extrabold">{money(short)}</span>
            </div>
          )}
          {change > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-success/10 px-4 py-3">
              <span className="text-sm font-semibold text-success">{t("till.changeDue")}</span>
              <span className="tabular text-lg font-extrabold text-success">{money(change)}</span>
            </div>
          )}

          {needsPin && (
            <Field label={t("till.managerPinOverCap")}>
              <Input
                inputMode="numeric"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={t("till.enterManagerPin")}
                className="tabular"
              />
            </Field>
          )}

          {(kind === "layby" || approval) && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={kind === "layby" ? t("till.customerNameRequired") : t("till.customerName")}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("till.phoneLabel")}>
                <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
          )}
          {approval && (
            <Field label={t("till.noteForApprover")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
        </div>

        <DialogFooter className="flex-row gap-3 border-t bg-secondary/35 px-5 py-4 sm:justify-between sm:space-x-0">
          <Button variant="ghost" size="lg" className="px-4" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={
              busy ||
              (kind === "layby" && !name.trim()) ||
              (needsPin && validatePin(pin) !== null) ||
              (kind === "sale" &&
                !approval &&
                ((splitting && short > 0.005) ||
                  (!splitting && method === "cash" && tendered !== "" && pay < total)))
            }
            onClick={submit}
          >
            {approval
              ? t("till.sendForApproval")
              : kind === "layby"
                ? t("till.openLayby")
                : t("till.completeSale", { amount: money(total) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tender({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "outline"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
