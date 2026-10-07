import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, PlusSignIcon, Search01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { useProducts, useStock, type Product } from "@/lib/products";
import { usePos } from "@/lib/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, StoreTypeTag } from "@/components/pos/bits";
import { cn } from "@/lib/utils";
import { useCollections, salePrice } from "@/lib/collections";

export const Route = createFileRoute("/_authenticated/app/")({ component: Register });

const tiles = ["bg-tile-1", "bg-tile-2", "bg-tile-3", "bg-tile-4", "bg-tile-5", "bg-tile-6"];
const tileFor = (s: string) => tiles[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % tiles.length];


type Line = { p: Product; qty: number };

function Register() {
  const { store, money, rpc, business } = usePos();
  const qc = useQueryClient();
  const products = useProducts();
  const stock = useStock(store?.id);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [dlg, setDlg] = useState<null | "sale" | "layby">(null);

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

  async function finish(kind: "sale" | "layby", f: { payment: number; method: string; name: string; phone: string; note: string }) {
    try {
      const r = await rpc<{ number: number; status: string }>("checkout", {
        p_store: store!.id, p_kind: kind, p_items: cart.map((l) => ({ product_id: l.p.id, qty: l.qty })),
        p_payment: f.payment, p_method: f.method, p_customer_name: f.name || null, p_customer_phone: f.phone || null, p_note: f.note || null,
      });
      toast.success(
        r.status === "pending_approval" ? `Invoice #${r.number} sent for approval` : kind === "layby" ? `Layby #${r.number} opened` : `Sale #${r.number} complete`,
      );
      setCart([]);
      setDlg(null);
      qc.invalidateQueries();
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
            <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 bg-card pl-9" placeholder="Search items or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <StoreTypeTag type={store.store_type} />
        </div>
        {cats.length > 0 && (
          <div className="mb-4 flex gap-2 overflow-x-auto">
            {[null, ...cats].map((c) => (
              <button key={c ?? "all"} onClick={() => setCat(c)} className={cn("whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold", cat === c ? "bg-primary text-primary-foreground" : "bg-card shadow-[var(--shadow-card)]")}>
                {c ? catName(c) : "All"}
              </button>
            ))}
          </div>
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

      <aside className="pos-card flex h-fit flex-col lg:sticky lg:top-8">
        <div className="border-b px-5 py-4">
          <h2 className="font-bold">Current {approval ? "invoice" : "sale"}</h2>
          <p className="text-xs text-muted-foreground">{store.name}</p>
        </div>
        <div className="max-h-[45vh] flex-1 divide-y overflow-y-auto">
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
        <div className="space-y-3 border-t p-5">
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
          <Button size="xl" variant="accent" className="w-full" disabled={!cart.length} onClick={() => setDlg("sale")}>
            {approval ? "Send for approval" : `Charge ${money(total)}`}
          </Button>
          <Button size="lg" variant="outline" className="w-full" disabled={!cart.length} onClick={() => setDlg("layby")}>
            {approval ? "Layby invoice" : "Start layby"}
          </Button>
        </div>
      </aside>

      {dlg && <CheckoutDialog kind={dlg} total={total} approval={approval} onClose={() => setDlg(null)} onDone={(f) => finish(dlg, f)} />}
    </div>
  );
}

function CheckoutDialog({ kind, total, approval, onClose, onDone }: {
  kind: "sale" | "layby"; total: number; approval: boolean; onClose: () => void;
  onDone: (f: { payment: number; method: string; name: string; phone: string; note: string }) => Promise<void>;
}) {
  const { money } = usePos();
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pay = Number(tendered || 0);
  const change = kind === "sale" && method === "cash" ? Math.max(0, pay - total) : 0;

  const submit = async () => {
    setBusy(true);
    await onDone({ payment: kind === "sale" ? total : pay, method, name, phone, note });
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approval ? (kind === "layby" ? "Layby invoice for approval" : "Invoice for approval") : kind === "layby" ? "Start layby" : "Take payment"}
          </DialogTitle>
        </DialogHeader>
        <div className="tabular text-center text-4xl font-extrabold">{money(total)}</div>
        {approval && <p className="text-center text-sm text-muted-foreground">An approver must approve this before stock leaves the store and payment is recorded.</p>}
        <div className="space-y-3">
          {(!approval || kind === "sale") && (
            <div className="grid grid-cols-3 gap-2">
              {["cash", "card", "mobile"].map((m) => (
                <button key={m} onClick={() => setMethod(m)} className={cn("rounded-lg border py-3 text-sm font-semibold capitalize", method === m ? "border-accent bg-accent/10 text-accent" : "bg-card")}>{m === "mobile" ? "Mobile money" : m}</button>
              ))}
            </div>
          )}
          {!approval && (kind === "layby" || method === "cash") && (
            <Field label={kind === "layby" ? "Deposit paid now" : "Cash received"}>
              <Input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0.00" />
            </Field>
          )}
          {change > 0 && <p className="text-center font-semibold text-success">Change: {money(change)}</p>}
          {(kind === "layby" || approval) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={kind === "layby" ? "Customer name *" : "Customer name"}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Phone"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            </div>
          )}
          {approval && <Field label="Note for approver"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        </div>
        <Button size="xl" variant={approval ? "default" : "success"} disabled={busy || (kind === "layby" && !name.trim()) || (kind === "sale" && !approval && method === "cash" && tendered !== "" && pay < total)} onClick={submit}>
          {approval ? "Send for approval" : kind === "layby" ? "Open layby" : "Complete sale"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
