import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "lucide-react";
import {
  DashboardSquare01Icon,
  BoxesIcon,
  Delete02Icon,
  SquareLockIcon,
  Logout02Icon,
  PackageIcon,
  ReceiptIcon,
  ShoppingBag01Icon,
  StoreIcon,
  BarChartIcon,
} from "@hugeicons/core-free-icons";
import { supabase } from "@/integrations/supabase/client";
import { PosProvider, roleLabel, usePos } from "@/lib/pos";
import {
  workspaceNavigation,
  workspacePageAt,
  type WorkspaceGroup,
} from "@/lib/workspace-navigation";
import { WorkspaceTabs } from "@/components/pos/WorkspaceTabs";
import { useSubscription } from "@/lib/billing";
import { Billing } from "@/components/pos/Billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Field, NativeSelect, StoreTypeTag } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Register — Storq" },
      { name: "description", content: "Storq point of sale register." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useRouteContext();
  return (
    <PosProvider userId={user.id}>
      <div className="min-h-screen">
        <Gate />
      </div>
    </PosProvider>
  );
}

function Gate() {
  const { business, staff, stores } = usePos();
  const sub = useSubscription(business?.id, stores.length);
  if (business === undefined)
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>
    );
  if (business === null) return <Setup />;
  if (!staff) return <PinPad />;
  if (sub.isPending)
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Checking subscription…
      </div>
    );
  if (sub.isError)
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="space-y-4 text-center">
          <p>Subscription could not be checked.</p>
          <Button onClick={() => sub.refetch()}>Try again</Button>
        </div>
      </div>
    );
  if (sub.data && !sub.data.active)
    return (
      <div className="min-h-screen bg-background p-4">
        <Billing locked />
      </div>
    );
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
  const [f, setF] = useState({
    name: "",
    currency: "R",
    store: "Main store",
    type: "direct",
    owner: "",
    pin: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await (supabase.rpc as any)("setup_business", {
      p_name: f.name,
      p_currency: f.currency,
      p_store_name: f.store,
      p_store_type: f.type,
      p_owner_name: f.owner,
      p_pin: f.pin,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Business ready. Enter your PIN.");
    qc.invalidateQueries();
  }
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <form onSubmit={submit} className="pos-card w-full max-w-lg space-y-3 p-5">
        <div>
          <h1 className="text-xl font-bold">Set up your business</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You can add more stores and staff later.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="col-span-2">
            <Field label="Business name">
              <Input required value={f.name} onChange={set("name")} />
            </Field>
          </div>
          <Field label="Currency">
            <Input required value={f.currency} onChange={set("currency")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="First store">
            <Input required value={f.store} onChange={set("store")} />
          </Field>
          <Field label="Store type">
            <NativeSelect
              value={f.type}
              onChange={(v) => setF({ ...f, type: v })}
              options={[
                { value: "direct", label: "Direct sale" },
                { value: "approval", label: "Approval based" },
              ]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Your name">
            <Input required value={f.owner} onChange={set("owner")} />
          </Field>
          <Field label="Your admin PIN">
            <Input
              required
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={f.pin}
              onChange={set("pin")}
            />
          </Field>
        </div>
        <Button className="w-full" disabled={busy}>
          Create business
        </Button>
        <button type="button" onClick={signOut} className="w-full text-sm text-muted-foreground">
          Sign out of this device
        </button>
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
      .catch(() => {
        setErr(true);
        setPin("");
      })
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

  const press = (d: string) => {
    setErr(false);
    setPin((p) => (p.length < 4 ? p + d : p));
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {business?.name}
      </p>
      <h1 className="mt-2 text-2xl font-bold">Enter your PIN</h1>
      <div className={cn("mt-8 flex gap-4", err && "animate-pulse")}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "size-4 rounded-full border-2 border-primary",
              i < pin.length && "bg-primary",
              err && "border-destructive",
            )}
          />
        ))}
      </div>
      <p className="mt-3 h-5 text-sm text-destructive">
        {err ? "Wrong PIN, try again" : busy ? "" : ""}
      </p>
      <div className="mt-6 grid grid-cols-3 gap-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            disabled={busy}
            onClick={() => press(d)}
            className="pos-key size-20 bg-card text-2xl font-semibold shadow-[var(--shadow-card)] hover:bg-secondary"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          disabled={busy}
          onClick={() => press("0")}
          className="pos-key size-20 bg-card text-2xl font-semibold shadow-[var(--shadow-card)] hover:bg-secondary"
        >
          0
        </button>
        <button
          onClick={() => setPin((p) => p.slice(0, -1))}
          className="pos-key grid size-20 place-items-center text-muted-foreground hover:bg-secondary"
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-6" />
        </button>
      </div>
      <button
        onClick={signOut}
        className="mt-10 flex items-center gap-2 text-sm text-muted-foreground"
      >
        <HugeiconsIcon icon={Logout02Icon} className="size-4" /> Sign out of this device
      </button>
    </div>
  );
}

const navIcons: Record<WorkspaceGroup, typeof BoxesIcon> = {
  dashboard: DashboardSquare01Icon,
  register: ShoppingBag01Icon,
  sales: ReceiptIcon,
  inventory: PackageIcon,
  finance: BarChartIcon,
  settings: StoreIcon,
};

function Shell() {
  const { staff, stores, store, setStoreId, lock } = usePos();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const items = staff ? workspaceNavigation(staff.role, store?.store_type) : [];
  const current = workspacePageAt(path);
  const groupNav = items.find((n) => n.group === current?.group);
  const lockedToStore = staff?.role === "cashier" && !!staff.store_id;
  const unavailableApproval = current?.approvalOnly && store?.store_type !== "approval";

  useEffect(() => {
    if (store && unavailableApproval) void navigate({ to: "/app/sales", replace: true });
  }, [store?.id, unavailableApproval, navigate]);

  return (
    <SidebarProvider className="storq-workspace bg-background">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5 text-lg font-semibold">
            <img src="/logo.svg" alt="Storq logo" className="size-7 rounded-lg" />
            <span className="group-data-[collapsible=icon]:hidden">Storq</span>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={lockedToStore}>
                  <SidebarMenuButton>
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/10 text-[10px] font-bold text-primary">
                      {store?.name.slice(0, 2).toUpperCase() ?? "S"}
                    </span>
                    <span className="truncate font-medium group-data-[collapsible=icon]:hidden">
                      {store?.name ?? "Select store"}
                    </span>
                    <ChevronDownIcon className="ml-auto group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" sideOffset={14} className="w-56">
                  <DropdownMenuLabel>Stores</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {stores.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => setStoreId(s.id)}>
                      <span className="truncate">{s.name}</span>
                      <span className="ml-auto shrink-0">
                        <StoreTypeTag type={s.store_type} />
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((n) => {
                  const active = current?.group === n.group;
                  return (
                    <SidebarMenuItem key={n.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={n.label}
                        aria-current={active ? "page" : undefined}
                      >
                        <Link to={n.to}>
                          <HugeiconsIcon icon={navIcons[n.group]} />
                          <span>{n.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:hidden">
            <Avatar className="size-8 border">
              <AvatarFallback className="text-xs">
                {staff?.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left">
              <span className="truncate text-[13px] font-bold">{staff?.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {staff && roleLabel[staff.role]}
              </span>
            </div>
          </div>
          <SidebarMenuButton onClick={lock} tooltip="Lock workspace">
            <HugeiconsIcon icon={SquareLockIcon} />
            <span>Lock</span>
          </SidebarMenuButton>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden h-12 items-center justify-between border-b px-5 text-[13px] md:flex lg:px-6">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {groupNav ? (
                    <BreadcrumbLink asChild>
                      <Link to={groupNav.to}>{groupNav.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Workspace</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{current?.label ?? "Storq"}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">
                {staff?.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground">{staff?.name}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Lock workspace"
              title="Lock workspace"
              onClick={lock}
            >
              <HugeiconsIcon icon={SquareLockIcon} />
            </Button>
          </div>
        </header>
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-rail px-4 py-3 md:hidden">
          <NativeSelect
            className="flex-1"
            value={store?.id ?? ""}
            disabled={lockedToStore}
            onChange={setStoreId}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
          />
          <span className="text-sm font-semibold">{staff?.name}</span>
          <Button size="icon" variant="outline" onClick={lock}>
            <HugeiconsIcon icon={SquareLockIcon} />
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-20 md:p-5 md:pb-6 lg:p-6">
          {staff && <WorkspaceTabs path={path} role={staff.role} storeType={store?.store_type} />}
          <div key={store?.id}>
            <Outlet />
          </div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t bg-rail md:hidden">
          {items.map((n) => {
            const active = current?.group === n.group;
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-[72px] flex-1 flex-col items-center gap-1 py-2 text-[11px] font-semibold",
                  active ? "text-accent" : "text-muted-foreground",
                )}
              >
                <HugeiconsIcon icon={navIcons[n.group]} className="size-5" /> {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </SidebarProvider>
  );
}
