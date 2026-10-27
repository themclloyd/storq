import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  CalculatorIcon,
  Delete02Icon,
  GridViewIcon,
  Search01Icon,
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
import { useOnce } from "@/hooks/use-once";
import { normalizeCode } from "@/lib/item-codes";
import { usePos } from "@/lib/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Empty, Field, NoAccess } from "@/components/pos/bits";
import { ReceiptModal } from "@/components/pos/ReceiptModal";
import { ScanCamera, ScanCameraButton } from "@/components/pos/ScanCamera";
import { QuickAddItem } from "@/components/pos/QuickAddItem";
import { useScannerWedge } from "@/components/pos/use-scanner";
import { DiscountDialog, type DiscountLine } from "@/components/pos/DiscountDialog";
import { CustomerDialog } from "@/components/pos/till/CustomerDialog";
import { ItemTile } from "@/components/pos/till/ItemTile";
import { KeypadPanel } from "@/components/pos/till/KeypadPanel";
import { TenderScreen } from "@/components/pos/till/TenderScreen";
import {
  Ticket,
  type TicketCustomer,
  type TicketRow,
  type TicketTotals,
} from "@/components/pos/till/Ticket";
import { TicketLineSheet } from "@/components/pos/till/TicketLineSheet";
import { Receipt, type ReceiptTender } from "@/lib/receipts";
import { useCollections, salePrice } from "@/lib/collections";
import { useI18n } from "@/lib/i18n";
import { changeDue, composeNote, type SaleForm } from "@/lib/till";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({
    meta: [
      { title: "Register | Storq" },
      { name: "description", content: "Ring up sales and create layby or approval invoices." },
      { property: "og:title", content: "Register | Storq" },
      {
        property: "og:description",
        content: "Ring up sales and create layby or approval invoices.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Register,
});

/** A cart line, with the note the cashier pinned to that one item. */
type Line = { p: Product; qty: number; note?: string | undefined };
type Held = { id: string; at: number; cart: Line[]; discounts: Record<string, number> };
/** Square's two ways to ring up: the item grid, or a calculator. */
type Mode = "library" | "keypad";

/** The till acts on money and stock, so it is never a read-only screen. */
function Register() {
  const { can } = usePos();
  if (!can("sell")) return <NoAccess />;
  return <RegisterContent />;
}

function RegisterContent() {
  const { store, money, business, staff, checkout, can } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const products = useProducts(store?.id);
  // Cool the "Try again" click on the till's error state so a session cannot
  // hammer the catalog query on a flaky connection.
  const { run: retryProducts, running: retryingProducts } = useOnce(
    () => products.refetch(),
    3_000,
  );
  // Live screen: re-read quantities so a CSV import or another till's sale is
  // never sold against a badge this device cached earlier.
  const stock = useStock(store?.id, { live: true });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  // Square's All tab browses the whole catalogue; we only load it once asked,
  // so a till does not dump the menu (and its costs of reading) up front.
  const [browseAll, setBrowseAll] = useState(false);
  const [mode, setMode] = useState<Mode>("library");
  const [cart, setCart] = useState<Line[]>([]);
  const [discounts, setDiscounts] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<TicketCustomer>({ name: "", phone: "" });
  const [orderNote, setOrderNote] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [lineId, setLineId] = useState<string | null>(null);
  const [showDisc, setShowDisc] = useState(false);
  const [tender, setTender] = useState<null | "sale" | "layby">(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [scanning, setScanning] = useState(false);
  // Codes seen while the catalog query refreshed: applied once a match exists.
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  // An unknown code lets a manager register the item right here (one code, no
  // trip to Inventory); the keypad's custom amount uses the same door.
  const [quickAdd, setQuickAdd] = useState<null | { code: string; amount?: number }>(null);
  // Below the two-column breakpoint the ticket lives in a bottom sheet and a
  // fixed bar summarises it, with Charge one tap away.
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
  // The till reveals stock only on demand: a search term, an opened category or
  // the All tab shows the tiles, so the register never dumps the whole menu up
  // front — a store rings up what the customer asks for, and a barcode scan
  // drops the item straight into the cart.
  const browsing = dq.trim().length > 0 || !!cat || browseAll;
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
  const capped = !can("approvals");
  // Without approval access, a discount past the 10% cap needs someone who holds
  // it to enter their PIN.
  const overCap =
    discountTotal > 0 &&
    capped &&
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
  // toast so an accidental tap never loses the sale.
  const removeLine = (id: string) => {
    const line = cart.find((l) => l.p.id === id);
    if (!line) return;
    setCart((c) => c.filter((l) => l.p.id !== id));
    setDiscounts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    toast(t("till.removedItem", { name: line.p.name }), {
      action: {
        label: t("till.undo"),
        onClick: () => setCart((c) => (c.some((l) => l.p.id === id) ? c : [...c, line])),
      },
    });
  };
  const resetSale = () => {
    setCart([]);
    setDiscounts({});
    setCustomer({ name: "", phone: "" });
    setOrderNote("");
    setLineId(null);
    setMobileCart(false);
    setTender(null);
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

  // ---- held (parked) sales: kept on this device per store ----
  const heldKey = `storq:held:${store?.id ?? "none"}`;
  const [held, setHeld] = useState<Held[]>([]);
  useEffect(() => {
    try {
      setHeld(JSON.parse(localStorage.getItem(heldKey) ?? "[]"));
    } catch {
      setHeld([]);
    }
  }, [heldKey]);
  const saveHeld = (next: Held[]) => {
    setHeld(next);
    localStorage.setItem(heldKey, JSON.stringify(next));
  };
  const holdCart = () => {
    if (!cart.length) return;
    saveHeld([...held, { id: crypto.randomUUID(), at: Date.now(), cart, discounts }]);
    setCart([]);
    setDiscounts({});
    toast.success(t("till.heldSaved"));
  };
  const resumeHeld = (id: string) => {
    const h = held.find((x) => x.id === id);
    if (!h) return;
    // Re-link to the fresh catalog so prices/stock are current; drop removed items.
    const lines: Line[] = h.cart.flatMap((l) => {
      const p = list.find((x) => x.id === l.p.id);
      return p ? [{ p, qty: l.qty, note: l.note }] : [];
    });
    const rest = held.filter((x) => x.id !== id);
    // Swap: the current basket (if any) is held in its place.
    saveHeld(
      cart.length ? [...rest, { id: crypto.randomUUID(), at: Date.now(), cart, discounts }] : rest,
    );
    setCart(lines);
    setDiscounts(h.discounts);
    toast.success(t("till.heldResumed"));
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
  useScannerWedge(applyCode, {
    enabled:
      !!store &&
      !tender &&
      !scanning &&
      !quickAdd &&
      !lineId &&
      !customerOpen &&
      !noteOpen &&
      !showDisc,
  });
  useEffect(() => {
    if (!pendingScan) return;
    const p = findByBarcode(list, pendingScan);
    if (p) {
      add(p);
      setPendingScan(null);
    } else if (products.isFetched) {
      toast.error(t("till.noBarcodeMatch", { code: pendingScan }));
      if (can("stock")) {
        setScanning(false);
        setQuickAdd({ code: pendingScan.trim() });
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
        setMode("library");
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  // Auto-focus the search on mount so a cashier can start typing or let a
  // scanner wedge land in the box without a click first.
  useEffect(() => {
    if (store) searchRef.current?.focus();
  }, [store]);

  async function finish(kind: "sale" | "layby", f: SaleForm) {
    if (!store) return;
    // The order note and every line note travel together, so the receipt and
    // the sale record explain what was actually handed over.
    const note = composeNote(
      f.note,
      cart.map((l) => ({ name: l.p.name, note: l.note })),
    );
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
          p_note: note || null,
          ...(tenderArg.length ? { p_tenders: tenderArg } : {}),
          ...(disList.length ? { p_discounts: disList } : {}),
          ...(f.overridePin ? { p_override_pin: f.overridePin } : {}),
        },
        { offlineOk: kind === "sale" && !approval, estTotal: round2(total) },
      );
      if (r.offline) {
        const change = changeDue(f.tenders, r.total, kind);
        resetSale();
        toast.success(
          t("till.noInternetSale", { amount: money(r.total) }) +
            (change ? t("till.changeSuffix", { amount: money(change) }) : ""),
        );
        return;
      }
      resetSale();
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
          tenders: f.tenders.map(
            (ten) => ({ method: ten.method, raw: ten.amount }) as ReceiptTender,
          ),
          paid: kind === "layby" ? round2(f.tenders.length ? tenderSum : f.payment) : r.total,
          change: changeDue(f.tenders, r.total, kind),
          customerName: f.name || null,
          customerPhone: f.phone || null,
          note: note || null,
        });
      } else {
        toast.success(t("till.invoiceSentApproval", { no: r.number }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!store) return <Empty>{t("till.addStoreFirst")}</Empty>;

  const rows: TicketRow[] = cart.map((l) => {
    const gross = lineGross(l);
    const disc = lineDisc(l);
    return {
      id: l.p.id,
      name: l.p.name,
      unit: price(l.p),
      qty: l.qty,
      note: l.note,
      gross,
      disc,
      net: round2(gross - disc),
    };
  });
  const totals: TicketTotals = {
    gross: grossSub,
    discount: discountTotal,
    tax,
    rate,
    incl,
    total,
  };
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const active = lineId ? rows.find((r) => r.id === lineId) : undefined;

  // One Ticket element feeds the desktop pane and the phone sheet, so the two
  // surfaces can never drift apart.
  const ticket = (className: string) => (
    <Ticket
      className={className}
      title={approval ? t("till.currentInvoice") : t("till.currentSale")}
      storeName={store.name}
      rows={rows}
      totals={totals}
      customer={customer}
      note={orderNote}
      approval={approval}
      onCustomer={() => setCustomerOpen(true)}
      onClear={clearCart}
      onHold={holdCart}
      onDiscount={() => setShowDisc(true)}
      onNote={() => setNoteOpen(true)}
      onOpenLine={(id) => setLineId(id)}
      onCharge={() => {
        // Charge owns the screen: the phone sheet closes first so two overlays
        // never fight over focus.
        setMobileCart(false);
        setTender("sale");
      }}
      onLayby={() => {
        setMobileCart(false);
        setTender("layby");
      }}
    />
  );

  return (
    <>
      {/* 60/40 counter split: the catalogue on the left, the receipt tape on the
          right. The ticket is sticky so the Charge button never scrolls away. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(340px,384px)] lg:items-start lg:gap-4">
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Label htmlFor="pos-search" className="sr-only">
                {t("till.searchLabel")}
              </Label>
              <HugeiconsIcon
                icon={Search01Icon}
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
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
            <div
              role="group"
              aria-label={t("till.catalogMode")}
              className="flex shrink-0 items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5"
            >
              <ModeButton
                icon={GridViewIcon}
                label={t("till.modeLibrary")}
                active={mode === "library"}
                onClick={() => setMode("library")}
              />
              <ModeButton
                icon={CalculatorIcon}
                label={t("till.modeKeypad")}
                active={mode === "keypad"}
                onClick={() => setMode("keypad")}
              />
            </div>
          </div>

          {held.length > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                {t("till.heldCarts", { count: held.length })}
              </span>
              {held.map((h) => (
                <span
                  key={h.id}
                  className="flex items-center gap-0.5 rounded-full border border-border bg-card py-0.5 pr-0.5 pl-2.5 text-[11px]"
                >
                  <span className="tabular">
                    {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
                    · {t("till.heldItems", { count: h.cart.length })}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] font-semibold text-primary"
                    onClick={() => resumeHeld(h.id)}
                  >
                    {t("till.resume")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-6 p-0 text-muted-foreground"
                    aria-label={t("till.discardHeld")}
                    onClick={() => saveHeld(held.filter((x) => x.id !== h.id))}
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
                  </Button>
                </span>
              ))}
            </div>
          )}

          {mode === "keypad" ? (
            <KeypadPanel
              onAddCode={(code) => {
                const p = findByBarcode(list, code);
                if (!p) {
                  toast.error(t("till.noBarcodeMatch", { code }));
                  return false;
                }
                add(p);
                return true;
              }}
              onCustomAmount={(amount) => setQuickAdd({ code: "", amount })}
              canCreateItem={can("stock")}
            />
          ) : (
            <>
              {cats.length > 0 && (
                <div className="no-scrollbar mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
                  <CatChip
                    active={!cat && browseAll}
                    onClick={() => {
                      setCat(null);
                      setBrowseAll(true);
                    }}
                  >
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryingProducts}
                      onClick={() => void retryProducts()}
                    >
                      {t("common.tryAgain")}
                    </Button>
                  </div>
                </Empty>
              ) : list.length === 0 ? (
                <Empty>{products.isFetched ? t("till.noItemsYet") : t("common.loading")}</Empty>
              ) : !browsing ? (
                <Empty>
                  <div className="flex flex-col items-center gap-3">
                    <span>{t(approval ? "till.searchToStartInvoice" : "till.searchToStart")}</span>
                    <Button size="sm" variant="outline" onClick={() => setBrowseAll(true)}>
                      {t("till.showAll")}
                    </Button>
                  </div>
                </Empty>
              ) : shown.length === 0 ? (
                <Empty>{t("till.noMatchingItems")}</Empty>
              ) : (
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(142px,1fr))] sm:gap-2.5">
                  {shown.map((p) => {
                    const s = stock.data?.[p.id] ?? 0;
                    return (
                      <ItemTile
                        key={p.id}
                        name={p.name}
                        price={price(p)}
                        compareAt={Number(p.price)}
                        stock={s}
                        threshold={p.reorder_point ?? 5}
                        onAdd={() => add(p)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        {/* Desktop / tablet landscape: the ticket as a fixed-height column. */}
        <aside className="hidden lg:block">
          <div className="lg:sticky lg:top-4">{ticket("h-[min(calc(100dvh-9rem),820px)]")}</div>
        </aside>

        {/* Phone / small tablet: a summary bar with Charge one tap away; the bar
            opens the full ticket as a sheet. */}
        <div className="lg:hidden">
          {cart.length > 0 && (
            <>
              <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom,0px))] z-30 flex items-stretch gap-2 border-t border-border bg-card px-3 py-2 shadow-[0_-1px_0_var(--hairline)] md:bottom-0">
                <button
                  type="button"
                  onClick={() => setMobileCart(true)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-1 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                >
                  <span className="tabular grid size-9 shrink-0 place-items-center rounded-[10px] bg-secondary text-[12px] font-bold text-secondary-foreground">
                    {count}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">
                      {t("till.reviewSale")}
                    </span>
                    <span className="tabular block truncate text-[11px] text-muted-foreground">
                      {money(total)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="charge"
                  className="h-11 shrink-0 px-3 text-[13px]"
                  onClick={() => setTender("sale")}
                >
                  {approval
                    ? t("till.sendForApproval")
                    : t("till.charge", { amount: money(total) })}
                  <HugeiconsIcon icon={ArrowRight01Icon} />
                </Button>
              </div>
              <Sheet open={mobileCart} onOpenChange={setMobileCart}>
                <SheetContent
                  side="bottom"
                  className="max-h-[88vh] gap-0 overflow-hidden rounded-t-[16px] bg-background p-0"
                >
                  <SheetHeader className="sr-only">
                    <SheetTitle>{t("till.currentSale")}</SheetTitle>
                    <SheetDescription>{store.name}</SheetDescription>
                  </SheetHeader>
                  <div className="max-h-[86vh] overflow-hidden pt-2">
                    {ticket("max-h-[84vh] rounded-t-none border-x-0 border-b-0")}
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}
        </div>

        {tender && (
          <TenderScreen
            kind={tender}
            total={total}
            approval={approval}
            needsPin={overCap}
            customer={customer}
            note={orderNote}
            onClose={() => setTender(null)}
            onDone={(f) => finish(tender, f)}
          />
        )}
        {active && (
          <TicketLineSheet
            line={active}
            stock={stock.data?.[active.id] ?? 0}
            capped={capped}
            onSave={(qty, disc, note) => {
              setQty(active.id, qty);
              setDiscounts((d) => {
                const next = { ...d };
                if (disc > 0) next[active.id] = disc;
                else delete next[active.id];
                return next;
              });
              setCart((c) =>
                c.map((l) => (l.p.id === active.id ? { ...l, note: note || undefined } : l)),
              );
            }}
            onRemove={() => removeLine(active.id)}
            onClose={() => setLineId(null)}
          />
        )}
        {customerOpen && (
          <CustomerDialog
            customer={customer}
            onSave={setCustomer}
            onRemove={() => setCustomer({ name: "", phone: "" })}
            onClose={() => setCustomerOpen(false)}
          />
        )}
        {noteOpen && (
          <OrderNoteDialog
            note={orderNote}
            onSave={setOrderNote}
            onClose={() => setNoteOpen(false)}
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
            code={quickAdd.code}
            initialPrice={quickAdd.amount !== undefined ? String(quickAdd.amount) : undefined}
            custom={quickAdd.amount !== undefined}
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

/** Library / Keypad switch: the two ways Square lets a cashier ring up. */
function ModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** The note that travels with the whole ticket, separate from per-item notes. */
function OrderNoteDialog({
  note,
  onSave,
  onClose,
}: {
  note: string;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(note);
  const commit = () => {
    onSave(value.trim());
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden bg-card p-0">
        <DialogHeader className="space-y-0 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base">{t("till.orderNote")}</DialogTitle>
          <DialogDescription className="mt-1 text-[11px] leading-relaxed">
            {t("till.orderNoteHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4">
          <Field label={t("till.orderNote")}>
            <Input
              autoFocus
              maxLength={200}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("till.orderNotePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          </Field>
        </div>
        <DialogFooter className="flex-row gap-2 border-t border-border bg-secondary/35 px-5 py-4 sm:justify-between sm:space-x-0">
          <Button variant="ghost" size="lg" className="px-3" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" className="flex-1" onClick={commit}>
            {t("common.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Category filter chips: a scrollable row where the active chip is filled ink,
// so the row never wraps the toolbar.
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
        "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
