import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  SquareLockIcon,
  Logout02Icon,
  Settings01Icon,
  LanguagesIcon,
  Alert02Icon,
} from "@/lib/icons";
import { supabase } from "@/integrations/supabase/client";
import { PosProvider, usePos } from "@/lib/pos";
import { usePendingApprovals } from "@/lib/sales";
import { workspaceNavigation, workspacePageAt } from "@/lib/workspace-navigation";
import { WorkspaceTabs } from "@/components/pos/WorkspaceTabs";
import { WorkspaceRail } from "@/components/pos/WorkspaceRail";
import { navIcons } from "@/components/pos/nav-icons";
import { DrawerChip } from "@/components/pos/DrawerChip";
import { useSubscription } from "@/lib/billing";
import { useOnce } from "@/hooks/use-once";
import { Billing } from "@/components/pos/Billing";
import { GraceBanner } from "@/components/pos/GraceBanner";
import { ResetPinDialog } from "@/components/pos/ResetPinDialog";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, NativeSelect, StoreTypeTag } from "@/components/pos/bits";
import { CurrencyField, PaymentMethodPicker } from "@/components/pos/payment-methods";
import { useI18n, type Locale } from "@/lib/i18n";
import { PIN_BACKOFF, clearGate, formatWait, gateRemaining, noteFailure } from "@/lib/attempt-gate";
import {
  LIMITS,
  firstError,
  requireText,
  sanitizeText,
  validateCurrency,
  validatePin,
} from "@/lib/validate";
import { cn } from "@/lib/utils";
import { getDeviceId, staffStorageKey } from "@/lib/staff-session";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Register | Storq" },
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
  const { t } = useI18n();
  const { business, staff, stores } = usePos();
  const sub = useSubscription(business?.id, stores.length);
  // Cool the "Try again" click so a session cannot hammer the entitlement
  // query when Supabase is briefly unreachable.
  const { run: retrySub, running: retryingSub } = useOnce(() => sub.refetch(), 3_000);
  if (business === undefined)
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  if (business === null) return <Setup />;
  if (!staff) return <PinPad />;
  // Only block on a first-ever check; afterwards the cached entitlement renders
  // instantly and refreshes silently. The database still rejects expired writes.
  if (sub.isPending && !sub.hasRow)
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        {t("setup.checkingSubscription")}
      </div>
    );
  if (sub.isError && !sub.hasRow)
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="space-y-4 text-center">
          <p>{t("setup.subscriptionError")}</p>
          <Button disabled={retryingSub} onClick={() => void retrySub()}>
            {t("common.tryAgain")}
          </Button>
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
    // End only the session this device holds. The business login is shared, so
    // signing out here must not knock every other till offline.
    try {
      // New RPC (added by the account lifecycle migration) is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("lock_device", { p_device_id: getDeviceId() });
    } catch {
      // Best-effort: we still clear the local session even if the server call fails.
    }
    const { data } = await supabase.auth.getUser();
    if (data.user) localStorage.removeItem(staffStorageKey(data.user.id));
    qc.clear();
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  };
}

function Setup() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [f, setF] = useState({
    name: "",
    currency: "MWK",
    store: "Main store",
    type: "direct",
    owner: "",
    pin: "",
    methods: ["cash"] as string[],
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Same standards the setup_business RPC enforces, so the user gets a
    // readable toast instead of a raw server error.
    const err = firstError(
      requireText(f.name, t("setup.businessName"), LIMITS.businessName),
      validateCurrency(f.currency),
      requireText(f.store, t("setup.storeName"), LIMITS.storeName),
      requireText(f.owner, t("setup.yourName"), LIMITS.name),
      validatePin(f.pin),
    );
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("setup_business", {
      p_name: sanitizeText(f.name, LIMITS.businessName),
      p_currency: f.currency.trim(),
      p_store_name: sanitizeText(f.store, LIMITS.storeName),
      p_store_type: f.type,
      p_owner_name: sanitizeText(f.owner, LIMITS.name),
      p_pin: f.pin,
      p_payment_methods: f.methods,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("setup.businessReady"));
    qc.invalidateQueries();
  }
  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <form onSubmit={submit} className="pos-card w-full max-w-lg space-y-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{t("setup.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("setup.subtitle")}</p>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="col-span-2">
            <Field label={t("setup.businessName")}>
              <Input
                required
                maxLength={LIMITS.businessName}
                value={f.name}
                onChange={set("name")}
              />
            </Field>
          </div>
          <Field label={t("setup.currency")}>
            <CurrencyField value={f.currency} onChange={(v) => setF({ ...f, currency: v })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t("setup.firstStore")}>
            <Input required maxLength={LIMITS.storeName} value={f.store} onChange={set("store")} />
          </Field>
          <Field label={t("setup.storeType")}>
            <NativeSelect
              value={f.type}
              onChange={(v) => setF({ ...f, type: v })}
              options={[
                { value: "direct", label: t("setup.directSale") },
                { value: "approval", label: t("setup.approvalBased") },
              ]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t("setup.yourName")}>
            <Input required maxLength={LIMITS.name} value={f.owner} onChange={set("owner")} />
          </Field>
          <Field label={t("setup.yourAdminPin")}>
            <PasswordInput
              required
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={f.pin}
              onChange={set("pin")}
            />
          </Field>
        </div>
        <div className="space-y-2 border-t pt-3">
          <p className="text-[13px] font-medium">{t("setup.paymentMethods")}</p>
          <PaymentMethodPicker value={f.methods} onChange={(methods) => setF({ ...f, methods })} />
          <p className="text-xs text-muted-foreground">{t("setup.paymentMethodsHint")}</p>
        </div>
        <Button className="w-full" disabled={busy}>
          {t("setup.createBusiness")}
        </Button>
        <button type="button" onClick={signOut} className="w-full text-sm text-muted-foreground">
          {t("setup.signOutDevice")}
        </button>
      </form>
    </div>
  );
}

function PinPad() {
  const { t } = useI18n();
  const { business, unlock, userId } = usePos();
  const signOut = useSignOut();
  // The gate is scoped to this account and survives a reload, so closing the
  // tab cannot hand the next person a fresh set of guesses.
  const scope = `pin:${userId}`;
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [wait, setWait] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const busyRef = useRef(false);

  // Adopt a lock left by the previous page load, then tick it down.
  useEffect(() => {
    setWait(gateRemaining(scope));
  }, [scope]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait(gateRemaining(scope)), 500);
    return () => clearInterval(id);
  }, [wait, scope]);

  async function submit(value: string) {
    if (busyRef.current || gateRemaining(scope) > 0) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await unlock(value);
      if (res.ok) {
        clearGate(scope);
        return;
      }
      setErr(true);
      setPin("");
      // A server lock sets the countdown; a plain miss backs off locally so a
      // stuck key cannot fire a request per digit.
      const gate =
        res.code === "throttled"
          ? noteFailure(scope, PIN_BACKOFF, {
              blockedUntil: Date.now() + res.retryAfter * 1000,
            })
          : noteFailure(scope, PIN_BACKOFF);
      setLeft(res.code === "throttled" ? 0 : res.attemptsLeft);
      setWait(Math.max(0, gate.blockedUntil - Date.now()));
    } catch (e) {
      // A transport or server failure is not a wrong PIN: report it without
      // spending one of the five attempts, and clear the entry so the effect
      // cannot immediately retry the same digits in a loop.
      setPin("");
      toast.error((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Submit once a full PIN is entered and any cooldown has elapsed. `submit`
  // sets its own in-flight guard; pin/wait/busy are the real triggers.
  useEffect(() => {
    if (pin.length < LIMITS.pinMin || wait > 0 || busy) return;
    void submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, wait, busy]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Ignore keystrokes while a request is in flight or the pad is locked;
      // otherwise a fifth digit could fire a second attempt for the same entry.
      if (busyRef.current || gateRemaining(scope) > 0) return;
      if (/^[0-9]$/.test(e.key)) {
        setErr(false);
        setPin((p) => (p.length < LIMITS.pinMax ? p + e.key : p));
      }
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [scope]);

  const press = (d: string) => {
    setErr(false);
    setPin((p) => (p.length < LIMITS.pinMax ? p + d : p));
  };
  const disabled = busy || wait > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {business?.name}
      </p>
      <h1 className="mt-2 text-2xl font-bold">{t("pin.enterPin")}</h1>
      <div className={cn("mt-8 flex gap-4", err && "animate-pulse")}>
        {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
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
      <p className="mt-3 h-5 text-sm text-destructive" aria-live="polite">
        {wait > 0
          ? t("pin.tooMany", { time: formatWait(wait) })
          : err
            ? left && left > 0
              ? t("pin.attemptsLeft", { count: left })
              : t("pin.wrongPin")
            : ""}
      </p>
      <div className="mt-6 grid grid-cols-3 gap-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            disabled={disabled}
            onClick={() => press(d)}
            className="pos-key size-20 border border-border bg-card text-2xl font-semibold hover:bg-secondary"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          disabled={disabled}
          onClick={() => press("0")}
          className="pos-key size-20 border border-border bg-card text-2xl font-semibold hover:bg-secondary"
        >
          0
        </button>
        <button
          disabled={disabled}
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
        <HugeiconsIcon icon={Logout02Icon} className="size-4" /> {t("pin.signOutDevice")}
      </button>
      <button
        type="button"
        onClick={() => setResetOpen(true)}
        className="mt-3 text-sm text-muted-foreground underline underline-offset-4"
      >
        {t("pin.forgot")}
      </button>
      <ResetPinDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        onReset={async (next) => {
          // The reset ended every PIN session; unlock again with the new PIN so
          // the till opens instead of dropping back to the pad.
          const res = await unlock(next);
          if (res.ok) {
            clearGate(scope);
            setErr(false);
            setPin("");
            return true;
          }
          toast.error(t("pin.resetFailed"));
          return false;
        }}
      />
    </div>
  );
}

/**
 * Staff menu: settings, lock, language and sign out live here so the rail stays
 * a short list of work screens. The rail foot and the mobile header share it.
 */
function UserMenu({ settingsTo }: { settingsTo: string | undefined }) {
  const { t, locale, setLocale } = useI18n();
  const { staff, lock } = usePos();
  const signOut = useSignOut();
  const initial = staff?.name.slice(0, 2).toUpperCase() ?? "";
  const avatar = (
    <Avatar className="size-8 border">
      <AvatarFallback className="text-xs">{initial}</AvatarFallback>
    </Avatar>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("nav.menu")}
          title={t("nav.menu")}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {avatar}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        {settingsTo && (
          <DropdownMenuItem asChild>
            <Link to={settingsTo}>
              <HugeiconsIcon icon={Settings01Icon} className="size-4" /> {t("nav.settings")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void lock()}>
          <HugeiconsIcon icon={SquareLockIcon} className="size-4" /> {t("nav.lockWorkspace")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <HugeiconsIcon icon={LanguagesIcon} className="size-4" /> {t("nav.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ny">Chichewa</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={() => void signOut()}>
          <HugeiconsIcon icon={Logout02Icon} className="size-4" /> {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The persistent "invoices awaiting you" signal for the store currently
 * selected: it appears the moment a cashier sends an invoice there and only
 * clears when that store's queue has been approved or rejected. Each location
 * keeps its own count, so switching stores never carries a pending alert from
 * one branch to another, the whole point of approval mode is that whoever is
 * at a till sees what *that* store is waiting on.
 */
function ApprovalsAlert({
  count,
  compact,
  onGo,
}: {
  count: number;
  compact?: boolean;
  onGo: () => void;
}) {
  const { t } = useI18n();
  if (!count) return null;
  const label = count >= 100 ? "99+" : String(count);
  const aria = t("dashboard.alertInvoices", { count });
  return (
    <button
      type="button"
      onClick={onGo}
      aria-label={aria}
      title={aria}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 px-2 py-1 text-[11px] font-semibold text-warning-foreground transition-colors hover:bg-warning/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !compact && "px-2.5",
      )}
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-70" />
        <span className="relative inline-flex size-2 rounded-full bg-warning" />
      </span>
      <span className="tabular">{label}</span>
      {!compact && (
        <span className="flex items-center gap-1">
          <HugeiconsIcon icon={Alert02Icon} className="size-3.5" />
          <span className="hidden lg:inline">{t("nav.approvals")}</span>
        </span>
      )}
    </button>
  );
}

function Shell() {
  const { t } = useI18n();
  const { staff, stores, store, setStoreId, lock } = usePos();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const items = staff ? workspaceNavigation(staff, store?.store_type) : [];
  // Settings moves into the user-menu card, so the sidebar only lists work screens.
  const settingsEntry = items.find((n) => n.group === "settings");
  const navItems = items.filter((n) => n.group !== "settings");
  const current = workspacePageAt(path);
  const lockedToStore = !!staff?.store_id;
  // Mode chips only mean something when stores actually differ; a single-mode
  // business never sees "Approval"/"Direct sale" vocabulary in the switcher.
  const mixedModes =
    stores.some((x) => x.store_type === "approval") &&
    stores.some((x) => x.store_type !== "approval");
  // Live approvals signal for the selected store only, switching locations
  // never drags another store's pending count along with it.
  const pending = usePendingApprovals();
  const pendingCount = pending.data?.length ?? 0;
  const pendingBadge = pendingCount >= 100 ? "99+" : String(pendingCount);
  function goToApprovals() {
    void navigate({ to: "/app/invoices" });
  }

  // The approvals screen guards its own store type and says so in place
  // (`invoices.directSaleNotice`). A shell-level redirect away from it only
  // moved the person somewhere they did not ask for, with no explanation.

  // Quick-lock hotkey: Ctrl/Cmd+Shift+L locks the till back to the PIN pad.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        void lock();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lock]);

  // A location belongs to the whole workspace, so its switcher rides the rail
  // under the brand rather than inside one page's header.
  const storeSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={lockedToStore}>
        <button
          title={store?.name ?? t("nav.selectStore")}
          aria-label={t("nav.stores")}
          className="press grid size-11 shrink-0 place-items-center rounded-xl border border-border/70 bg-background text-[11px] font-semibold tracking-wide transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-primary/30 focus-visible:outline-none disabled:opacity-60"
        >
          {store?.name.slice(0, 2).toUpperCase() ?? "S"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-56">
        <DropdownMenuLabel>{t("nav.stores")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {stores.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => setStoreId(s.id)}>
            <span className="truncate">{s.name}</span>
            {mixedModes && (
              <span className="ml-auto shrink-0">
                <StoreTypeTag type={s.store_type} />
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="storq-workspace flex min-h-screen bg-background">
      <WorkspaceRail
        items={navItems}
        activeGroup={current?.group}
        pendingCount={pendingCount}
        settingsTo={settingsEntry?.to}
        storeMenu={storeSwitcher}
        userMenu={<UserMenu settingsTo={settingsEntry?.to} />}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-bar sticky top-0 z-30 flex items-center gap-2 border-b border-border/60 px-3 py-2.5 md:hidden">
          <NativeSelect
            className="flex-1"
            value={store?.id ?? ""}
            disabled={lockedToStore}
            onChange={setStoreId}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
          />
          <DrawerChip storeId={store?.id} compact />
          <ApprovalsAlert count={pendingCount} compact onGo={goToApprovals} />
          <UserMenu settingsTo={settingsEntry?.to} />
        </header>
        {/* The grace window is a business-wide state, so it appears exactly once per
            screen: here above every workspace page, and inside Billing on the billing
            page itself. */}
        {path !== "/app/billing" && (
          <div className="mx-auto w-full max-w-[1400px] px-4 pt-3 md:px-6 lg:px-11">
            <GraceBanner />
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] pt-4 md:px-6 md:pt-6 md:pb-6 lg:px-11 lg:pt-7">
          {/* An area holds several pages, so the rail needs a row for them once
              it is on screen; below md the bottom bar carries the areas. */}
          {staff && (
            <WorkspaceTabs
              path={path}
              access={staff}
              storeType={store?.store_type}
              pendingCount={pendingCount}
            />
          )}
          {/* Keyed on the route so each screen arrives with the short rise a
              pushed view gets; the store id keeps a store switch remounting too. */}
          <div key={`${store?.id}-${path}`} className="screen-in">
            <Outlet />
          </div>
        </main>
        <nav className="glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-border/60 pb-[env(safe-area-inset-bottom,0px)] md:hidden">
          <div className="no-scrollbar flex overflow-x-auto">
            {navItems.map((n) => {
              const active = current?.group === n.group;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "press flex min-w-[68px] flex-1 basis-0 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-semibold",
                    active ? "text-primary-soft-foreground" : "text-muted-foreground",
                  )}
                >
                  {/* Active tab borrows the iOS pill: the glyph sits in a tinted
                      capsule instead of only recolouring the label. */}
                  <span
                    className={cn(
                      "grid h-7 w-12 place-items-center rounded-full transition-colors duration-200",
                      active && "bg-primary-soft",
                    )}
                  >
                    <HugeiconsIcon icon={navIcons[n.group]} className="size-5" />
                  </span>
                  <span className="flex items-center gap-1">
                    {t(n.labelKey)}
                    {n.group === "sales" && pendingCount > 0 && (
                      <span
                        className="tabular rounded-full bg-warning-soft px-1 text-[10px] font-bold leading-4 text-warning-foreground"
                        aria-hidden
                      >
                        {pendingBadge}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
