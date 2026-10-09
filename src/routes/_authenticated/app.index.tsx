import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
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
import { useProducts, useStock, type Product } from "@/lib/products";
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
import { Empty, Field, StoreTypeTag } from "@/components/pos/bits";
import { ReceiptModal } from "@/components/pos/ReceiptModal";
import type { Receipt } from "@/lib/receipts";
import { cn } from "@/lib/utils";
import { useCollections, salePrice } from "@/lib/collections";

export const Route = createFileRoute("/_authenticated/app/")({ head: () => ({ meta: [{ title: "Register — Storq" }, { name: "description", content: "Ring up sales and create layby or approval invoices." }, { property: "og:title", content: "Register — Storq" }, { property: "og:description", content: "Ring up sales and create layby or approval invoices." }, { name: "robots", content: "noindex, nofollow" }] }), component: Register });

const tiles = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5", "bg-tile-6"];
const tileFor = (s: string) => tiles[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % tiles.length];


type Line = { p: Product; qty: number };

function Register() {
  const { store, money, business, staff, checkout } = usePos();
  const qc = useQueryClient();
  const products = useProducts();
  const stock = useStock(store?.id);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [dlg, setDlg] = useState<null | "sale" | "layby">(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const list = (products.data ?? []).filter((p) => p.active);
  const cols = useCollections();
  const price = (p: Product) => salePrice(p, cols.data);
  const cats = (cols.data?.list ?? []).map((c) => c.id);
  const catName = (id: string) => cols.data?.list.find((c) => c.id === id)?.name ?? "";
  const shown = list.filter(
    (p) => (!cat || (cols.data?.byProduct[p.id] ?? []).includes(cat)) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku?.toLowerCase().includes(q.toLowerCase())),
  );
  const sub = useMemo(() => cart.reduce((a, l) => a + l.qty * price(l.p), 0), [cart, cols.data]);
  const rate = Number(business?.tax_rate ?? 0);
  const incl = business?.tax_inclusive ?? true;
  const tax = rate > 0 ? (incl ? sub - sub / (1 + rate / 100) : sub * rate / 100) : 0;
  const total = rate > 0 && !incl ? sub + tax : sub;
  const approval = store?.store_type === "approval";

  const add = (p: Product) =>
    setCart((c) => (c.find((l) => l.p.id === p.id) ? c.map((l) => (l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { p, qty: 1 }]));
  const setQty = (id: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.p.id !== id) : c.map((l) => (l.p.id === id ? { ...l, qty } : l))));

  async function finish(kind: "sale" | "layby", f: { payment: number; method: string; name: string; phone: string; note: string; tendered: number }) {
    if (!store) return;
    const lines = cart.map((l) => ({ name: l.p.name, qty: l.qty, price: price(l.p), total: l.qty * price(l.p) }));
    try {
      const r = await checkout({
        p_store: store.id, p_kind: kind, p_items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })),
        p_payment: f.payment, p_method: f.method, p_customer_name: f.name || null, p_customer_phone: f.phone || null, p_note: f.note || null,
      }, { offlineOk: kind === "sale" && !approval, estTotal: Math.round(total * 100) / 100 });
      if (r.offline) {
        setCart([]); setDlg(null);
        const change = f.method === "cash" ? Math.max(0, (f.tendered || 0) - r.total) : 0;
        toast.success(`No internet — sale of ${money(r.total)} saved on this device and will sync automatically.${change ? ` Change: ${money(change)}` : ""}`);
        return;
      }
      setCart([]);
      setDlg(null);
      invalidateKeys(qc, SALE_TOUCHED);
      // Approval invoices carry no payment yet, so only completed sales / laybys get a receipt.
      if (r.status !== "pending_approval") {
        const isCash = f.method === "cash";
        const change = kind === "sale" && isCash ? Math.max(0, (f.tendered || 0) - r.total) : 0;
        setReceipt({
          number: r.number,
          kind,
          status: r.status,
          bizName: business?.name ?? "Storq",
          storeName: store.name,
          cashier: staff?.name ?? "Staff",
          date: new Date().toISOString(),
          lines,
          subtotal: sub,
          tax: r.tax,
          taxRate: rate,
          taxInclusive: incl,
          total: r.total,
          method: f.method,
          paid: kind === "layby" ? f.payment : r.total,
          change,
          customerName: f.name || null,
          customerPhone: f.phone || null,
          note: f.note || null,
        });
      } else {
        toast.success(`Invoice #${r.number} sent for approval`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!store) return <Empty>Add a store first.</Empty>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="min-w-0">
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Label htmlFor="pos-search" className="sr-only">Search items or SKU</Label>
            <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="pos-search" className="h-11 bg-card pl-9" placeholder="Search items or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <StoreTypeTag type={store.store_type} />
        </div>
        {cats.length > 0 && (
          <ToggleGroup
            type="single"
            value={cat ?? "all"}
            onValueChange={(v) => setCat(v && v !== "all" ? v : null)}
            className="mb-4 justify-start gap-2 overflow-x-auto"
          >
            <ToggleGroupItem value="all" className="shrink-0 rounded-full px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">All</ToggleGroupItem>
            {cats.map((id) => (
              <ToggleGroupItem key={id} value={id} className="shrink-0 rounded-full px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{catName(id)}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {shown.length === 0 ? (
          <Empty>{list.length === 0 ? "No items yet. An admin or manager can add them under Inventory." : "No matching items."}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => {
              const s = stock.data?.[p.id] ?? 0;
              return (
                <button key={p.id} onClick={() => add(p)} className="pos-tile pos-card overflow-hidden text-left hover:shadow-[var(--shadow-pop)]">
                    <div className={cn("grid h-20 place-items-center text-2xl font-extrabold text-tile-foreground", tileFor(p.name))}>
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="p-3">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 flex justify-between text-xs">
                      <span className="tabular font-semibold">{price(p) < Number(p.price) && <span className="mr-1 font-normal text-muted-foreground line-through">{money(p.price)}</span>}{money(price(p))}</span>
                      <span className={cn("tabular", s <= 0 ? "text-destructive" : "text-muted-foreground")}>{s} in stock</span>
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
          <CardTitle className="font-bold">Current {approval ? "invoice" : "sale"}</CardTitle>
          <CardDescription className="text-xs">{store.name}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="max-h-[45vh]">
            <div className="divide-y">
            {cart.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Tap items to add them.</p>}
            {cart.map((l) => (
              <div key={l.p.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{l.p.name}</div>
                  <div className="tabular text-xs text-muted-foreground">{money(price(l.p))} each</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="size-7" onClick={() => setQty(l.p.id, l.qty - 1)}>{l.qty === 1 ? <HugeiconsIcon icon={Delete02Icon} /> : <HugeiconsIcon icon={MinusSignIcon} />}</Button>
                  <span className="tabular w-7 text-center text-sm font-bold">{l.qty}</span>
                  <Button size="icon" variant="outline" className="size-7" onClick={() => setQty(l.p.id, l.qty + 1)}><HugeiconsIcon icon={PlusSignIcon} /></Button>
                </div>
                <div className="tabular w-20 text-right text-sm font-semibold">{money(l.qty * price(l.p))}</div>
              </div>
            ))}
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3 border-t bg-secondary/25 p-5 pt-5">
          {rate > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>VAT {rate}% {incl ? "(included)" : "(added)"}</span>
              <span className="tabular">{money(tax)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="tabular text-3xl font-extrabold">{money(total)}</span>
          </div>
          <Button size="xl" variant="default" className="w-full" disabled={!cart.length} onClick={() => setDlg("sale")}>
            {approval ? "Send for approval" : `Charge ${money(total)}`}
          </Button>
          <Button size="lg" variant="outline" className="w-full" disabled={!cart.length} onClick={() => setDlg("layby")}>
            {approval ? "Layby invoice" : "Start layby"}
          </Button>
        </CardFooter>
      </Card>

      {dlg && <CheckoutDialog kind={dlg} total={total} approval={approval} onClose={() => setDlg(null)} onDone={(f) => finish(dlg, f)} />}
      {receipt && <ReceiptModal receipt={receipt} money={money} onClose={() => setReceipt(null)} />}
    </div>
  );
}

const payMethods = [
  { v: "cash", t: "Cash", i: BanknoteIcon },
  { v: "card", t: "Card", i: CreditCardIcon },
  { v: "mobile", t: "Mobile money", i: Simcard01Icon },
] as const;

const sectionLabel = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

function CheckoutDialog({ kind, total, approval, onClose, onDone }: {
  kind: "sale" | "layby"; total: number; approval: boolean; onClose: () => void;
  onDone: (f: { payment: number; method: string; name: string; phone: string; note: string; tendered: number }) => Promise<void>;
}) {
  const { money, store, business } = usePos();
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pay = Number(tendered || 0);
  const change = kind === "sale" && method === "cash" ? Math.max(0, pay - total) : 0;
  const takingTender = !approval && (kind === "layby" || method === "cash");
  const rate = Number(business?.tax_rate ?? 0);
  const currency = business?.currency ?? "R";
  // Notes a cashier is likely holding: the next round amounts above the total.
  const step = total >= 5000 ? 5000 : total >= 1000 ? 1000 : 100;
  const upTo = (m: number) => Math.ceil(total / m) * m;
  const notes = [...new Set([upTo(step), upTo(step * 2), upTo(step * 4)])].filter((v) => v > total).slice(0, 2);

  const submit = async () => {
    setBusy(true);
    await onDone({ payment: approval ? 0 : kind === "sale" ? total : pay, method, name, phone, note, tendered: pay });
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden bg-card p-0 shadow-[var(--shadow-pop)]">
        <DialogHeader className="space-y-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>
            {approval
              ? kind === "layby" ? "Layby invoice for approval" : "Invoice for approval"
              : kind === "layby" ? "Start layby" : "Take payment"}
          </DialogTitle>
          <DialogDescription className="mt-1.5 truncate text-xs">
            {store?.name} · {approval ? "Approval invoice" : kind === "layby" ? "Layby" : "Direct sale"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-5">
          <div className="rounded-lg bg-secondary/45 px-4 py-3 text-center">
            <div className={sectionLabel}>{approval ? "Invoice total" : "Amount due"}</div>
            <div className="tabular mt-1 text-3xl font-extrabold">{money(total)}</div>
            {rate > 0 && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                VAT {rate}% {business?.tax_inclusive ? "included" : "added"}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {approval ? (
            <Alert className="border-warning/40 bg-warning/15 text-warning-foreground">
              <AlertDescription className="text-xs [&_p]:leading-relaxed">
                An approver must approve this before stock leaves the store and payment is recorded.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label className={sectionLabel}>Payment method</Label>
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
                    <span className="truncate">{m.t}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          {takingTender && (
            <div className="space-y-2">
              <Field label={kind === "layby" ? "Deposit paid now" : "Cash received"}>
                <Input
                  inputMode="decimal"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder="0.00"
                  className="tabular h-12 bg-card text-right text-xl font-bold md:text-xl"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Tender active={pay === total} onClick={() => setTendered(String(total))}>
                  {kind === "layby" ? "Full amount" : "Exact"}
                </Tender>
                {notes.map((v) => (
                  <Tender key={v} active={pay === v} onClick={() => setTendered(String(v))}>
                    {currency} {v.toLocaleString("en-ZA")}
                  </Tender>
                ))}
              </div>
            </div>
          )}

          {change > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-success/10 px-4 py-3">
              <span className="text-sm font-semibold text-success">Change due</span>
              <span className="tabular text-lg font-extrabold text-success">{money(change)}</span>
            </div>
          )}

          {(kind === "layby" || approval) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={kind === "layby" ? "Customer name *" : "Customer name"}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Phone"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            </div>
          )}
          {approval && <Field label="Note for approver"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        </div>

        <DialogFooter className="flex-row gap-3 border-t bg-secondary/35 px-5 py-4 sm:justify-between sm:space-x-0">
          <Button variant="ghost" size="lg" className="px-4" onClick={onClose}>Cancel</Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={busy || (kind === "layby" && !name.trim()) || (kind === "sale" && !approval && method === "cash" && tendered !== "" && pay < total)}
            onClick={submit}
          >
            {approval ? "Send for approval" : kind === "layby" ? "Open layby" : `Complete sale · ${money(total)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tender({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? "secondary" : "outline"} aria-pressed={active} onClick={onClick}>
      {children}
    </Button>
  );
}

