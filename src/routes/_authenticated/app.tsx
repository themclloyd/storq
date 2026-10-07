import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { BoxesIcon, ClipboardCheckIcon, Delete02Icon, FileCheckIcon, SquareLockIcon, Logout02Icon, PackageIcon, ReceiptIcon, ShoppingBag01Icon, StoreIcon, UserMultipleIcon, Wallet01Icon, BarChartIcon, BanknoteIcon } from "@hugeicons/core-free-icons";
import { supabase } from "@/integrations/supabase/client";
import { PosProvider, roleLabel, usePos, type Role } from "@/lib/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, StoreTypeTag } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Register — Storq" },
      { name: "description", content: "Storq point of sale register." },
      { property: "og:title", content: "Register — Storq" },
      { property: "og:description", content: "Storq point of sale register." },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useRouteContext();
  return (
    <PosProvider userId={user.id}>
      <Gate />
    </PosProvider>
  );
}

function Gate() {
  const { business, staff } = usePos();
  if (business === undefined) return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  if (business === null) return <Setup />;
  if (!staff) return <PinPad />;
  return <Shell />;
}

function useSignOut() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  };
}

function Setup() {
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [f, setF] = useState({ name: "", currency: "R", store: "Main store", type: "direct", owner: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await (supabase.rpc as any)("setup_business", {
      p_name: f.name, p_currency: f.currency, p_store_name: f.store, p_store_type: f.type, p_owner_name: f.owner, p_pin: f.pin,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Business ready. Enter your PIN.");
    qc.invalidateQueries();
  }
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <form onSubmit={submit} className="pos-card w-full max-w-lg space-y-4 p-8">
        <div>
          <h1 className="text-2xl font-bold">Set up your business</h1>
          <p className="mt-1 text-sm text-muted-foreground">You can add more stores and staff later.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="Business name"><Input required value={f.name} onChange={set("name")} /></Field></div>
          <Field label="Currency"><Input required value={f.currency} onChange={set("currency")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First store"><Input required value={f.store} onChange={set("store")} /></Field>
          <Field label="Store type">
            <NativeSelect value={f.type} onChange={set("type")}>
              <option value="direct">Direct sale</option>
              <option value="approval">Approval based</option>
            </NativeSelect>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your name"><Input required value={f.owner} onChange={set("owner")} /></Field>
          <Field label="Your admin PIN">
            <Input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={f.pin} onChange={set("pin")} />
          </Field>
        </div>
        <Button className="w-full" size="lg" disabled={busy}>Create business</Button>
        <button type="button" onClick={signOut} className="w-full text-sm text-muted-foreground">Sign out of this device</button>
      </form>
    </div>
  );
}

function PinPad() {
  const { business, unlock } = usePos();
  const signOut = useSignOut();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length !== 4) return;
    setBusy(true);
    unlock(pin)
      .catch(() => { setErr(true); setPin(""); })
      .finally(() => setBusy(false));
  }, [pin]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const press = (d: string) => { setErr(false); setPin((p) => (p.length < 4 ? p + d : p)); };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{business?.name}</p>
      <h1 className="mt-2 text-2xl font-bold">Enter your PIN</h1>
      <div className={cn("mt-8 flex gap-4", err && "animate-pulse")}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("size-4 rounded-full border-2 border-primary", i < pin.length && "bg-primary", err && "border-destructive")} />
        ))}
      </div>
      <p className="mt-3 h-5 text-sm text-destructive">{err ? "Wrong PIN, try again" : busy ? "" : ""}</p>
      <div className="mt-6 grid grid-cols-3 gap-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} disabled={busy} onClick={() => press(d)} className="pos-key size-20 bg-card text-2xl font-semibold shadow-[var(--shadow-card)] hover:bg-secondary">{d}</button>
        ))}
        <span />
        <button disabled={busy} onClick={() => press("0")} className="pos-key size-20 bg-card text-2xl font-semibold shadow-[var(--shadow-card)] hover:bg-secondary">0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} className="pos-key grid size-20 place-items-center text-muted-foreground hover:bg-secondary"><HugeiconsIcon icon={Delete02Icon} className="size-6" /></button>
      </div>
      <button onClick={signOut} className="mt-10 flex items-center gap-2 text-sm text-muted-foreground"><HugeiconsIcon icon={Logout02Icon} className="size-4" /> Sign out of this device</button>
    </div>
  );
}

type NavItem = { to: string; label: string; icon: typeof BoxesIcon; roles: Role[] };
const nav: NavItem[] = [
  { to: "/app", label: "Register", icon: ShoppingBag01Icon, roles: ["admin", "manager", "cashier"] },
  { to: "/app/invoices", label: "Invoices", icon: FileCheckIcon, roles: ["admin", "manager", "cashier"] },
  { to: "/app/laybys", label: "Laybys", icon: Wallet01Icon, roles: ["admin", "manager", "cashier"] },
  { to: "/app/sales", label: "Sales", icon: ReceiptIcon, roles: ["admin", "manager", "cashier"] },
  { to: "/app/expenses", label: "Expenses", icon: BanknoteIcon, roles: ["admin", "manager", "cashier"] },
  { to: "/app/reports", label: "Reports", icon: BarChartIcon, roles: ["admin", "manager"] },
  { to: "/app/inventory", label: "Inventory", icon: PackageIcon, roles: ["admin", "manager"] },
  { to: "/app/stocktake", label: "Stock take", icon: ClipboardCheckIcon, roles: ["admin", "manager", "cashier"] },
  { to: "/app/staff", label: "Staff", icon: UserMultipleIcon, roles: ["admin"] },
  { to: "/app/stores", label: "Stores", icon: StoreIcon, roles: ["admin"] },
];

function Shell() {
  const { staff, stores, store, setStoreId, lock, can } = usePos();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = nav.filter((n) => can(...n.roles));
  const lockedToStore = staff?.role === "cashier" && !!staff.store_id;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r bg-rail md:flex">
        <div className="flex items-center gap-2 px-5 py-5 text-lg font-extrabold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><HugeiconsIcon icon={BoxesIcon} className="size-4" /></span>
          Storq
        </div>
        <div className="px-3">
          <NativeSelect value={store?.id ?? ""} disabled={lockedToStore} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          {store && <div className="mt-2 px-1"><StoreTypeTag type={store.store_type} /></div>}
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 px-3">
          {items.map((n) => {
            const active = n.to === "/app" ? path === "/app" || path === "/app/" : path.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold", active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary")}>
                <n.icon className="size-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <div className="px-2 pb-2">
            <div className="text-sm font-bold">{staff?.name}</div>
            <div className="text-xs text-muted-foreground">{staff && roleLabel[staff.role]}</div>
          </div>
          <Button variant="outline" className="w-full" onClick={lock}><HugeiconsIcon icon={SquareLockIcon} /> Lock</Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-rail px-4 py-3 md:hidden">
          <NativeSelect className="flex-1" value={store?.id ?? ""} disabled={lockedToStore} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          <span className="text-sm font-semibold">{staff?.name}</span>
          <Button size="icon" variant="outline" onClick={lock}><HugeiconsIcon icon={SquareLockIcon} /></Button>
        </header>
        <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t bg-rail md:hidden">
          {items.map((n) => {
            const active = n.to === "/app" ? path === "/app" || path === "/app/" : path.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={cn("flex min-w-[72px] flex-1 flex-col items-center gap-1 py-2 text-[11px] font-semibold", active ? "text-accent" : "text-muted-foreground")}>
                <n.icon className="size-5" /> {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
