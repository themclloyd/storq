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
  ShoppingBag01Icon,
  Simcard01Icon,
} from "@/lib/icons";
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
import { normalizeCode } from "@/lib/item-codes";
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
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Empty, Field, NativeSelect } from "@/components/pos/bits";
import { ReceiptModal } from "@/components/pos/ReceiptModal";
import { ScanCamera, ScanCameraButton } from "@/components/pos/ScanCamera";
import { QuickAddItem } from "@/components/pos/QuickAddItem";
import { useScannerWedge } from "@/components/pos/use-scanner";
import { DiscountDialog, type DiscountLine } from "@/components/pos/DiscountDialog";
import { Receipt, type ReceiptTender } from "@/lib/receipts";
import { validatePin } from "@/lib/validate";
import { cn } from "@/lib/utils";
import { useCollections, salePrice } from "@/lib/collections";
import { useI18n, type TranslateParams } from "@/lib/i18n";

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
  // Live screen: re-read quantities so a CSV import or another till's sale is
  // never sold against a badge this device cached earlier.
  const stock = useStock(store?.id, { live: true });
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
  // An unknown code lets a manager register the item right here (one code, no
  // trip to Inventory); cashiers just see the "no item matches" error.
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  // Below the two-column breakpoint the sale panel lives in a bottom sheet
  // (spec §5); this drives that sheet while a floating bar summarises the cart.
  const [mobileCart, setMobileCart] = useState(false);
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
        (!needle ||
          p.name.toLowerCase().includes(needle) ||
          normalizeCode(p.sku).toLowerCase().includes(needle)),
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
  const rate = Number(store?.tax_rate ?? 0);
  const incl = store?.tax_inclusive ?? true;
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
  // Removing a line or clearing the basket is reversible: offer Undo in the
  // toast so an accidental tap never loses the sale (spec §5, §10).
  const removeLine = (id: string) => {
    const line = cart.find((l) => l.p.id === id);
    if (!line) return;
    setCart((c) => c.filter((l) => l.p.id !== id));
    toast(t("till.removedItem", { name: line.p.name }), {
      action: {
        label: t("till.undo"),
        onClick: () => setCart((c) => (c.some((l) => l.p.id === id) ? c : [...c, line])),
      },
    });
  };
  const clearCart = () => {
    if (!cart.length) return;
    const snapshot = cart;
    const snapDisc = discounts;
    setCart([]);
    setDiscounts({});
    toast(t("till.clearedCart"), {
      action: {
        label: t("till.undo"),
        onClick: () => {
          setCart(snapshot);
          setDiscounts(snapDisc);
        },
      },
    });
  };

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
  useScannerWedge(applyCode, { enabled: !!store && !dlg && !scanning && !quickAdd });
  useEffect(() => {
    if (!pendingScan) return;
    const p = findByBarcode(list, pendingScan);
    if (p) {
      add(p);
      setPendingScan(null);
    } else if (products.isFetched) {
      toast.error(t("till.noBarcodeMatch", { code: pendingScan }));
      if (can("admin", "manager")) {
        setScanning(false);
        setQuickAdd(pendingScan.trim());
      }
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
  // Auto-focus the search on mount (spec §5) so a cashier can start typing or
  // let a scanner wedge land in the box without a click first.
  useEffect(() => {
    if (store) searchRef.current?.focus();
  }, [store]);

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
          storeAddress: store.address,
          storePhone: store.phone,
          storeEmail: store.email,
          storeTaxNumber: store.tax_number,
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

  const rows: SaleRow[] = cart.map((l) => {
    const d = lineDisc(l);
    return {
      id: l.p.id,
      name: l.p.name,
      unit: price(l.p),
      disc: d,
      gross: lineGross(l),
      net: round2(lineGross(l) - d),
      qty: l.qty,
    };
  });
  // One element reused by the desktop column and the mobile bottom sheet, so the
  // two surfaces can never drift apart (spec §5, §11).
  const salePanel = (
    <SalePanel
      title={approval ? t("till.currentInvoice") : t("till.currentSale")}
      storeName={store.name}
      rows={rows}
      emptyText={t("till.tapItems")}
      discountTotal={discountTotal}
      grossSub={grossSub}
      rate={rate}
      incl={incl}
      tax={tax}
      total={total}
      approval={approval}
      money={money}
      t={t}
      onStep={setQty}
      onRemove={removeLine}
      onClear={clearCart}
      onDiscount={() => setShowDisc(true)}
      onCharge={() => setDlg("sale")}
      onLayby={() => setDlg("layby")}
    />
  );

  return (
    <>
      {/* No PageHeader: the tab bar, sidebar store picker and sale panel already
          carry the breadcrumb, title and store name — the register keeps the full
          viewport for items. */}
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
                className="h-11 bg-card pl-9 text-[15px]"
                placeholder={t("till.searchPlaceholder")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <ScanCameraButton onOpen={() => setScanning(true)} />
          </div>
          {cats.length > 0 && (
            <div className="mb-4 flex justify-start gap-2 overflow-x-auto pb-1">
              <CatChip active={!cat} onClick={() => setCat(null)}>
                {t("till.all")}
              </CatChip>
              {cats.map((id) => (
                <CatChip
                  key={id}
                  active={cat === id}
                  onClick={() => setCat(cat === id ? null : id)}
                >
                  {catName(id)}
                </CatChip>
              ))}
            </div>
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
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
              {shown.map((p) => {
                const s = stock.data?.[p.id] ?? 0;
                const threshold = p.reorder_point ?? 5;
                const soldOut = s <= 0;
                const low = s > 0 && s <= threshold;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p)}
                    disabled={soldOut}
                    aria-disabled={soldOut}
                    className={cn(
                      "pos-tile pos-card overflow-hidden text-left hover:border-primary",
                      soldOut && "pointer-events-none opacity-45",
                    )}
                  >
                    <div
                      className={cn(
                        "font-display relative grid h-[120px] place-items-center rounded-t-2xl text-3xl text-tile-foreground",
                        tileFor(p.name),
                      )}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                      {low && (
                        <span className="absolute left-2 top-2">
                          <Badge variant="destructive">{t("till.low")}</Badge>
                        </span>
                      )}
                      {soldOut && (
                        <span className="absolute inset-x-0 bottom-2 text-center text-xs font-medium text-destructive">
                          {t("till.outOfStock")}
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="mt-1 flex items-baseline justify-between text-xs">
                        <span className="tabular font-semibold text-secondary-foreground">
                          {price(p) < Number(p.price) && (
                            <span className="mr-1 font-normal text-muted-foreground line-through">
                              {money(p.price)}
                            </span>
                          )}
                          {money(price(p))}
                        </span>
                        {!soldOut && (
                          <span className="tabular text-muted-foreground">
                            {t("till.inStock", { count: s })}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Desktop: the sticky Current-sale column (spec §5). */}
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-8">{salePanel}</div>
        </div>

        {/* Mobile / tablet: a floating summary bar that opens the sale as a
            bottom sheet below the two-column breakpoint. */}
        <div className="lg:hidden">
          {cart.length > 0 && (
            <Sheet open={mobileCart} onOpenChange={setMobileCart}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t bg-card px-5 py-4 text-left shadow-lg"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="grid size-9 place-items-center rounded-full bg-secondary text-secondary-foreground [&_svg]:size-4">
                      <HugeiconsIcon icon={ShoppingBag01Icon} />
                    </span>
                    <span className="text-sm font-medium">
                      {t("till.itemsCount", { count: cart.length })}
                    </span>
                  </span>
                  <span className="font-display tabular text-lg">{money(total)}</span>
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="max-h-[85vh] gap-0 overflow-hidden rounded-t-3xl bg-background p-0"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>{t("till.currentSale")}</SheetTitle>
                  <SheetDescription>{store.name}</SheetDescription>
                </SheetHeader>
                <div className="max-h-[calc(85vh-2rem)] overflow-y-auto">{salePanel}</div>
              </SheetContent>
            </Sheet>
          )}
        </div>

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
        {receipt && (
          <ReceiptModal receipt={receipt} money={money} onClose={() => setReceipt(null)} />
        )}
        {scanning && (
          <ScanCamera onDetected={(code) => applyCode(code)} onClose={() => setScanning(false)} />
        )}
        {quickAdd && (
          <QuickAddItem
            code={quickAdd}
            onCreated={(p) => {
              add(p);
              setQuickAdd(null);
            }}
            onClose={() => setQuickAdd(null)}
          />
        )}
      </div>
    </>
  );
}

type SaleRow = {
  id: string;
  name: string;
  unit: number;
  disc: number;
  gross: number;
  net: number;
  qty: number;
};

// The Current-sale panel (spec §5): header + clear, empty state, pill-stepper
// rows, and the tinted footer (discount / VAT / total / charge / layby). Rendered
// inline on desktop and inside the mobile bottom sheet from a single element.
function SalePanel({
  title,
  storeName,
  rows,
  emptyText,
  discountTotal,
  grossSub,
  rate,
  incl,
  tax,
  total,
  approval,
  money,
  t,
  onStep,
  onRemove,
  onClear,
  onDiscount,
  onCharge,
  onLayby,
}: {
  title: string;
  storeName: string;
  rows: SaleRow[];
  emptyText: string;
  discountTotal: number;
  grossSub: number;
  rate: number;
  incl: boolean;
  tax: number;
  total: number;
  approval: boolean;
  money: (n: number | string | null | undefined) => string;
  t: (key: string, opts?: TranslateParams) => string;
  onStep: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onDiscount: () => void;
  onCharge: () => void;
  onLayby: () => void;
}) {
  const has = rows.length > 0;
  return (
    <Card className="flex h-fit flex-col overflow-hidden rounded-3xl">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b px-5 py-4">
        <div className="min-w-0">
          <CardTitle className="font-display text-lg font-medium">{title}</CardTitle>
          <CardDescription className="truncate text-xs">{storeName}</CardDescription>
        </div>
        {has && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("till.clear")}
          </button>
        )}
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="max-h-[45vh]">
          <div className="divide-y">
            {!has && (
              <div className="flex flex-col items-center gap-3 p-8 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
                  <HugeiconsIcon icon={ShoppingBag01Icon} />
                </span>
                <p className="text-sm text-muted-foreground">{emptyText}</p>
              </div>
            )}
            {rows.map((r) => (
              <div key={r.id} className="pos-row flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="tabular text-xs text-muted-foreground">
                    {money(r.unit)} {t("till.eachWord")}
                    {r.disc > 0 && <span className="ml-1 text-warning">· −{money(r.disc)}</span>}
                  </div>
                </div>
                <div className="inline-flex items-center gap-0.5 rounded-full border border-input bg-card p-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={r.qty <= 1 ? t("till.remove") : t("till.decrease")}
                    onClick={() => (r.qty <= 1 ? onRemove(r.id) : onStep(r.id, r.qty - 1))}
                  >
                    {r.qty <= 1 ? (
                      <HugeiconsIcon icon={Delete02Icon} />
                    ) : (
                      <HugeiconsIcon icon={MinusSignIcon} />
                    )}
                  </Button>
                  <span className="tabular w-6 text-center text-sm font-medium">{r.qty}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("till.increase")}
                    onClick={() => onStep(r.id, r.qty + 1)}
                  >
                    <HugeiconsIcon icon={PlusSignIcon} />
                  </Button>
                </div>
                <div className="tabular w-20 text-right text-sm">
                  {r.disc > 0 && (
                    <div className="text-xs font-normal text-muted-foreground line-through">
                      {money(r.gross)}
                    </div>
                  )}
                  <span className="font-semibold text-secondary-foreground">{money(r.net)}</span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 border-t bg-secondary/40 p-5">
        <button
          type="button"
          onClick={onDiscount}
          disabled={!has}
          className="w-full rounded-xl border border-dashed border-input py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          {discountTotal > 0
            ? t("till.discountApplied", { amount: money(discountTotal) })
            : `+ ${t("till.addDiscount")}`}
        </button>
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
          <span className="font-display tabular text-[38px] leading-none font-medium">
            {money(total)}
          </span>
        </div>
        <Button size="xl" variant="soft" className="w-full" disabled={!has} onClick={onCharge}>
          {approval ? t("till.sendForApproval") : t("till.charge", { amount: money(total) })}
        </Button>
        <Button size="lg" variant="outline" className="w-full" disabled={!has} onClick={onLayby}>
          {approval ? t("till.laybyInvoice") : t("till.startLayby")}
        </Button>
      </CardFooter>
    </Card>
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
  const { money, store } = usePos();
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
  const rate = Number(store?.tax_rate ?? 0);
  // Notes a cashier is likely holding: the next round amounts above the total.
  const step = total >= 5000 ? 5000 : total >= 1000 ? 1000 : 100;
  const upTo = (m: number) => Math.ceil(total / m) * m;
  const notes = [...new Set([upTo(step), upTo(step * 2), upTo(step * 4)])]
    .filter((v) => v > total)
    .slice(0, 2);
  // A layby deposit is any part of a fixed total; half is the other common one.
  const half = round2(total / 2);

  // Split rows carry their own amounts; the primary row is the cash field when
  // cash or a layby deposit (any method, any amount up to the total), or covers
  // the remainder when a lone card/mobile tender pays a sale in full (no split).
  const tenders: TenderRow[] = approval
    ? []
    : splitting
      ? [
          { method, amount: pay },
          ...extra.map((e) => ({ method: e.method, amount: Number(e.amount || 0) })),
        ].filter((t) => t.amount > 0)
      : [];
  const sumT = tenders.reduce((a, t) => a + t.amount, 0);
  const covered = !splitting ? (kind === "layby" || method === "cash" ? pay : total) : sumT;
  const short = round2(total - covered);
  const change = approval
    ? 0
    : calcChange(splitting ? tenders : [{ method, amount: pay }], total, kind);
  const showAmount = !approval && (kind === "layby" || method === "cash" || splitting);

  const submit = async () => {
    setBusy(true);
    await onDone({
      payment: approval
        ? 0
        : kind === "sale" && !splitting
          ? total
          : round2(splitting ? sumT : Math.min(Math.max(pay, 0), total)),
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
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-3xl bg-card p-0">
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
          <div className="rounded-2xl bg-secondary/50 px-4 py-3 text-center">
            <div className={sectionLabel}>
              {approval ? t("till.invoiceTotal") : t("till.amountDue")}
            </div>
            <div className="font-display tabular mt-1 text-[34px] leading-none font-medium">
              {money(total)}
            </div>
            {rate > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t("till.vat")} {rate}%{" "}
                {store?.tax_inclusive ? t("till.included") : t("till.added")}
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
              <SegmentedControl
                aria-label={t("till.paymentMethod")}
                className="w-full"
                value={method}
                onChange={setMethod}
                options={payMethods.map((m) => ({
                  value: m.v,
                  label: t(m.k),
                  icon: <HugeiconsIcon icon={m.i} className="size-4 shrink-0" />,
                }))}
              />
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
                  className="tabular h-12 bg-card text-right text-xl font-semibold md:text-xl"
                />
              </Field>
              {!splitting && (
                <div className="flex flex-wrap gap-2">
                  <Tender active={pay === total} onClick={() => setTendered(String(total))}>
                    {kind === "layby" ? t("till.tenderFullAmount") : t("till.tenderExact")}
                  </Tender>
                  {kind === "layby" ? (
                    <Tender active={pay === half} onClick={() => setTendered(String(half))}>
                      {t("till.tenderHalfAmount")}
                    </Tender>
                  ) : (
                    notes.map((v) => (
                      <Tender key={v} active={pay === v} onClick={() => setTendered(String(v))}>
                        {money(v)}
                      </Tender>
                    ))
                  )}
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

          {!approval && (splitting || kind === "layby") && short > 0.005 && (
            <div className="flex items-center justify-between rounded-2xl bg-muted px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">
                {t("till.remainingDue")}
              </span>
              <span className="tabular text-lg font-semibold">{money(short)}</span>
            </div>
          )}
          {change > 0 && (
            <div className="flex items-center justify-between rounded-2xl bg-success-soft px-4 py-3">
              <span className="text-sm font-medium text-success">{t("till.changeDue")}</span>
              <span className="tabular text-lg font-semibold text-success">{money(change)}</span>
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

        <DialogFooter className="flex-row gap-3 border-t bg-muted px-5 py-4 sm:justify-between sm:space-x-0">
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

// Category filter chips (spec §5): a pill row where the active chip is filled
// `primary`. Scrollable on narrow screens so the row never wraps the toolbar.
function CatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
