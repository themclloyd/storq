import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon, Logout02Icon, Search01Icon } from "@/lib/icons";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, PageHeader, Pager, fmtDate } from "@/components/pos/bits";
import {
  accessRunway,
  applyEntitlementChange,
  applyLifecycleChange,
  applyPurge,
  entitlementActions,
  journalPaymentCheck,
  lifecycleActionsFor,
  previewEntitlement,
  previewLifecycle,
  previewPurge,
  purgeWaitDaysLeft,
  graceDaysLeft,
  purgeWindowEnds,
  REASON_MAX_CHARS,
  REASON_MIN_CHARS,
  ROSTER_SEARCH_MAX,
  rosterFilters,
  rosterPage,
  rosterPageCount,
  usePlatformRole,
  useTenantAudit,
  useTenantRoster,
  usePendingPayments,
  type AuditAction,
  type AuditEntry,
  type EntitlementAction,
  type LifecycleAction,
  type OperatorRole,
  type PendingPayment,
  type RosterFilter,
  type TenantRow,
  type TenantState,
} from "@/lib/ops";
import { useI18n } from "@/lib/i18n";
import { fmtMoney } from "@/lib/billing";
import { verifySubscriptionPayment } from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/ops")({
  head: () => ({
    meta: [
      { title: "Tenants | Storq Ops" },
      {
        name: "description",
        content: "Storq platform operator console: cross-tenant roster.",
      },
      { property: "og:title", content: "Tenants | Storq Ops" },
      {
        property: "og:description",
        content: "Storq platform operator console: cross-tenant roster.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Ops,
});

// Tenant lifecycle is not a sale status, so it keeps its own vocabulary and its
// own soft tints rather than borrowing the shared <Status /> transaction map.
// Suspended and closed are the two states an operator decides, not the clocks:
// they sit above the money maths everywhere it is shown.
const stateStyle: Record<TenantState, string> = {
  active: "bg-success-soft text-success",
  trial: "bg-secondary text-muted-foreground",
  over_capacity: "bg-warning-soft text-warning-foreground",
  // Late but still trading: the tills are open on the courtesy window, so the
  // badge warns without reading like an outage.
  grace: "bg-warning-soft text-warning-foreground",
  expired: "bg-destructive-soft text-destructive",
  suspended: "bg-warning-soft text-warning-foreground",
  closed: "bg-destructive-soft text-destructive",
};
const stateLabelKey: Record<TenantState, string> = {
  active: "ops.stateActive",
  trial: "ops.stateTrial",
  over_capacity: "ops.stateOverCapacity",
  grace: "ops.stateGrace",
  expired: "ops.stateExpired",
  suspended: "ops.stateSuspended",
  closed: "ops.stateClosed",
};
const filterLabelKey: Record<RosterFilter, string> = {
  all: "common.all",
  ...stateLabelKey,
};
const roleLabelKey: Record<OperatorRole, string> = {
  support: "ops.roleSupport",
  billing: "ops.roleBilling",
  owner: "ops.roleOwner",
};
// One label and one hint per intent, so the dialog never has to guess which value
// control belongs to the action that was picked. Entitlement verbs change what a
// tenant bought; lifecycle verbs change whether they may trade at all.
const actionLabelKey: Record<AuditAction, string> = {
  slots: "ops.actionSlots",
  extend: "ops.actionExtend",
  until: "ops.actionUntil",
  trial: "ops.actionTrial",
  plan: "ops.actionPlan",
  suspend: "ops.actionSuspend",
  restore: "ops.actionRestore",
  close: "ops.actionClose",
  reopen: "ops.actionReopen",
  verify_payment: "ops.actionVerifyPayment",
};
const actionHintKey: Record<EntitlementAction | LifecycleAction | "purge", string> = {
  slots: "ops.hintSlots",
  extend: "ops.hintExtend",
  until: "ops.hintUntil",
  trial: "ops.hintTrial",
  plan: "ops.hintPlan",
  suspend: "ops.hintSuspend",
  restore: "ops.hintRestore",
  close: "ops.hintClose",
  reopen: "ops.hintReopen",
  purge: "ops.hintPurge",
};
// Which journalled key each action writes, for reading a history row back.
const auditField: Record<AuditAction, string> = {
  slots: "slots",
  extend: "until",
  until: "until",
  trial: "trial",
  plan: "plan",
  suspend: "suspended",
  restore: "suspended",
  close: "closed",
  reopen: "closed",
  verify_payment: "status",
};
/** The verb a purge confirmation carries, alongside the four lifecycle actions. */
type AccessChoice = LifecycleAction | "purge";
/** Verbs that restrict the tenant, so they are coloured as harm rather than repair. */
const harmful = (a: AccessChoice) => a === "suspend" || a === "close" || a === "purge";

/** A sensible starting value when the operator switches intent. */
function openingValue(row: TenantRow, action: EntitlementAction): string {
  if (action === "slots") return String(row.paid_store_limit);
  if (action === "plan") return row.plan ?? "monthly";
  return ""; // days and dates have no sensible default — they must be chosen
}

function Ops() {
  const { t } = useI18n();
  // Declared above every branch so hook order stays unconditional, as elsewhere
  // in the workspace; the roster hook is simply inert until the role resolves.
  const role = usePlatformRole();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [state, setState] = useState<RosterFilter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const dq = useDebouncedValue(q);
  const roster = useTenantRoster({ q: dq, state, page });
  const [managing, setManaging] = useState<TenantRow | null>(null);
  // Support reads; only billing and owner may change a tenant, which is also what
  // the RPC allows. Hiding the affordance here is courtesy, never the gate.
  const canWrite = role.data === "billing" || role.data === "owner";

  const total = roster.data?.total ?? 0;
  const rows = roster.data?.rows ?? [];
  const pageCount = rosterPageCount(total);
  const curPage = rosterPage(page, total);
  const filtered = state !== "all" || dq.trim() !== "";

  async function signOut() {
    qc.clear();
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort: the local session is cleared either way.
    }
    nav({ to: "/auth", replace: true });
  }

  function clearFilters() {
    setQ("");
    setState("all");
    setPage(0);
  }

  // The shell theme is defined for `.storq-workspace`, so the console opts into
  // it explicitly — no sidebar here, but the same tokens and overlay styling.
  return (
    <div className="storq-workspace min-h-screen bg-background px-6 py-8 sm:px-10">
      <div className="mx-auto w-full max-w-6xl">
        {role.isPending ? (
          <Empty>{t("ops.checking")}</Empty>
        ) : !role.data ? (
          <Card className="space-y-3 p-6 text-center">
            <p className="font-display text-lg">{t("ops.deniedTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("ops.deniedSub")}</p>
            <Button variant="outline" onClick={() => void signOut()}>
              <HugeiconsIcon icon={Logout02Icon} className="size-4" /> {t("nav.signOut")}
            </Button>
          </Card>
        ) : (
          <>
            <PageHeader
              breadcrumb={t("ops.breadcrumb")}
              title={t("ops.title")}
              sub={pluralize(total, t("ops.oneTenant"), t("ops.manyTenants"))}
              actions={
                <>
                  <div className="relative w-full max-w-xs">
                    <HugeiconsIcon
                      icon={Search01Icon}
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      className="h-9 pl-9"
                      maxLength={ROSTER_SEARCH_MAX}
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value.slice(0, ROSTER_SEARCH_MAX));
                        setPage(0);
                      }}
                      placeholder={t("ops.searchPlaceholder")}
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-9 bg-card">
                        <HugeiconsIcon icon={FilterIcon} /> {t("common.filter")}
                        {state !== "all" && (
                          <Badge variant="secondary" className="ml-0.5 rounded-full px-1.5">
                            1
                          </Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuRadioGroup
                        value={state}
                        onValueChange={(v) => {
                          setState(v as RosterFilter);
                          setPage(0);
                        }}
                      >
                        {rosterFilters.map((f) => (
                          <DropdownMenuRadioItem key={f} value={f}>
                            {t(filterLabelKey[f])}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                    <HugeiconsIcon icon={Logout02Icon} className="size-4" />
                    {t("ops.operatorAs", { role: t(roleLabelKey[role.data]) })}
                  </Button>
                </>
              }
            />
            <div className="mb-3 flex items-center justify-between border-b pb-3 text-[13px]">
              <p className="text-muted-foreground">
                {canWrite ? t("ops.writeHint") : t("ops.readOnlyHint")}
              </p>
              <p className="tabular text-muted-foreground">
                {roster.isFetching ? t("common.loading") : `${rows.length} / ${total}`}
              </p>
            </div>
            {roster.isError ? (
              <Empty>
                {t("ops.error")}{" "}
                <span className="text-destructive">{(roster.error as Error).message}</span>
              </Empty>
            ) : rows.length === 0 ? (
              <Empty>
                {filtered ? (
                  <>
                    {t("ops.emptyFiltered")}{" "}
                    <button type="button" onClick={clearFilters} className="font-medium underline">
                      {t("ops.clearFilters")}
                    </button>
                  </>
                ) : (
                  t("ops.emptyNone")
                )}
              </Empty>
            ) : (
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/3">{t("ops.colBusiness")}</TableHead>
                      <TableHead className="w-24">{t("ops.colStores")}</TableHead>
                      <TableHead className="hidden w-20 sm:table-cell">
                        {t("ops.colStaff")}
                      </TableHead>
                      <TableHead className="w-32">{t("ops.colStatus")}</TableHead>
                      <TableHead className="w-32">{t("ops.colRunway")}</TableHead>
                      <TableHead className="hidden w-36 lg:table-cell">
                        {t("ops.colLastSale")}
                      </TableHead>
                      {canWrite && (
                        <TableHead className="w-10 pr-4">
                          <span className="sr-only">{t("common.actions")}</span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TenantTr
                        key={r.id}
                        row={r}
                        canWrite={canWrite}
                        onManage={() => setManaging(r)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
            <Pager page={curPage} pageCount={pageCount} total={total} onPage={setPage} />
            {managing && (
              <ManageTenant row={managing} role={role.data} onClose={() => setManaging(null)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TenantTr({
  row,
  canWrite,
  onManage,
}: {
  row: TenantRow;
  canWrite: boolean;
  onManage: () => void;
}) {
  const { t } = useI18n();
  const runway = accessRunway(row, new Date());
  const over = row.store_count - row.paid_store_limit;
  // Runway wording follows the state, not just the clock: an over-capacity
  // tenant has time but the wrong number of slots, which is the actionable fact.
  // And a suspended or closed tenant has neither yet — what matters is when the
  // operator's decision was taken, because the clocks underneath keep running.
  const when =
    row.state === "suspended"
      ? t("ops.suspendedSince", { date: fmtDate(row.suspended_at ?? row.created_at) })
      : row.state === "closed"
        ? t("ops.closedSince", { date: fmtDate(row.closed_at ?? row.created_at) })
        : row.state === "over_capacity"
          ? t("ops.slotsOver", { over })
          : row.state === "grace"
            ? // Still trading on borrowed time, so count the window down rather
              // than printing a negative expiry a support call would misread.
              t("ops.graceLeft", { days: graceDaysLeft(row.paid_until) })
            : runway.days >= 0
              ? t("ops.daysLeft", { days: runway.days })
              : t("ops.daysOver", { days: -runway.days });
  return (
    <TableRow
      className={cn(canWrite && "cursor-pointer")}
      onClick={canWrite ? onManage : undefined}
    >
      <TableCell className="min-w-0">
        <div className="truncate font-medium">{row.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.owner_email || t("ops.noEmail")} · {row.currency}
        </div>
      </TableCell>
      <TableCell>
        <span className="tabular">
          {row.store_count} / {row.paid_store_limit}
        </span>
      </TableCell>
      <TableCell className="hidden tabular sm:table-cell">{row.staff_count}</TableCell>
      <TableCell>
        <Badge
          className={cn(
            "rounded-full border-transparent px-2.5 py-0.5",
            stateStyle[row.state] ?? "bg-secondary text-muted-foreground",
          )}
        >
          {t(stateLabelKey[row.state])}
        </Badge>
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground">{when}</TableCell>
      <TableCell className="hidden text-[13px] text-muted-foreground lg:table-cell">
        {row.last_sale_at ? fmtDate(row.last_sale_at) : t("ops.noSales")}
      </TableCell>
      {canWrite && (
        <TableCell className="pr-4">
          <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * One tenant's entitlement, their account state, and the single change an operator
 * wants to make. The preview is computed from the same rules the RPCs apply, so what
 * this dialog promises and what the database does are one sentence — the functions
 * still decide every rule for themselves, and their refusals are what `preview` and
 * `accessPreview` echo back.
 *
 * Entitlement and access are kept apart on purpose: a change to slots or expiry
 * needs a value, a change to the state needs none, and each gets its own reason
 * field so a justification typed for one intent can never ride into the other.
 */
function ManageTenant({
  row,
  role,
  onClose,
}: {
  row: TenantRow;
  role?: OperatorRole | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [action, setAction] = useState<EntitlementAction>("slots");
  const [value, setValue] = useState(() => openingValue(row, "slots"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AccessChoice | null>(null);
  const [why, setWhy] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const audit = useTenantAudit(row.id);
  const pendingPays = usePendingPayments(row.id);
  const verify = useServerFn(verifySubscriptionPayment);
  const [checking, setChecking] = useState<string | null>(null);

  const preview = previewEntitlement(row, action, value);
  const whyText = reason.trim();
  const canSend = preview.ok && whyText.length >= REASON_MIN_CHARS && !busy;

  // Which verbs this state and this role actually allow. The RPC re-checks both,
  // so offering fewer buttons is courtesy, never the gate.
  const verbs = lifecycleActionsFor(role).filter((a) =>
    a === "suspend"
      ? !row.closed_at && !row.suspended_at
      : a === "restore"
        ? !row.closed_at && !!row.suspended_at
        : a === "close"
          ? !row.closed_at
          : !!row.closed_at,
  );
  const canPurge = role === "owner" && !!row.closed_at;
  const waitUntil = row.closed_at ? purgeWindowEnds(row.closed_at) : null;
  const waitDays = row.closed_at ? purgeWaitDaysLeft(row.closed_at) : 0;
  // The two access previews keep their own types, so the state badge below can only
  // be read from the preview that actually carries one.
  const lifecyclePreview =
    pending && pending !== "purge" ? previewLifecycle(row, pending, role) : null;
  const accessState = lifecyclePreview?.ok === true ? lifecyclePreview.state : null;
  const accessPreview =
    pending === "purge" ? previewPurge(row, confirmName, why, role) : lifecyclePreview;
  const accessNameOk = pending !== "purge" || confirmName.trim() === row.name;
  const canSendAccess =
    !!pending &&
    !!accessPreview?.ok &&
    why.trim().length >= REASON_MIN_CHARS &&
    accessNameOk &&
    !busy;

  // A stuck charge: ask the provider once more, then record the operator's name
  // and reason beside the outcome. Activation, when it happens, is the server-side
  // verifier's decision — pressing this button cannot credit anyone by itself.
  async function verifyNow(payment: PendingPayment) {
    if (whyText.length < REASON_MIN_CHARS) {
      toast.error(t("ops.verifyNeedsReason"));
      return;
    }
    setChecking(payment.tx_ref);
    try {
      const res = await verify({ data: { tx_ref: payment.tx_ref } });
      await journalPaymentCheck(row.id, payment.tx_ref, res.ok, whyText);
      if (res.ok) toast.success(t("ops.verifyPaid"));
      else toast.error(res.message);
      await pendingPays.refetch();
      qc.invalidateQueries({ queryKey: ["ops", "roster"] });
      qc.invalidateQueries({ queryKey: ["ops", "audit", row.id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(null);
    }
  }

  async function apply() {
    if (!canSend) return;
    setBusy(true);
    try {
      await applyEntitlementChange(row, action, value, whyText);
      toast.success(t("ops.changed"));
      // The roster's status column is derived in SQL, so it is re-read rather than
      // patched from what this call sent.
      qc.invalidateQueries({ queryKey: ["ops", "roster"] });
      qc.invalidateQueries({ queryKey: ["ops", "audit", row.id] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  async function sendAccess(choice: AccessChoice) {
    if (!canSendAccess) return;
    setBusy(true);
    try {
      if (choice === "purge") await applyPurge(row, confirmName, why);
      else await applyLifecycleChange(row, choice, why);
      toast.success(
        choice === "purge" ? t("ops.purged", { name: row.name }) : t("ops.stateChanged"),
      );
      qc.invalidateQueries({ queryKey: ["ops", "roster"] });
      qc.invalidateQueries({ queryKey: ["ops", "audit", row.id] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  function openAccess(choice: AccessChoice) {
    setPending(choice);
    // A fresh intent starts with an empty justification, the same rule the
    // entitlement form follows with its value box.
    setWhy("");
    setConfirmName("");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t("ops.manageTitle", { name: row.name })}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-secondary/40 p-3 text-[13px]">
          <Current
            label={t("ops.colStores")}
            value={`${row.store_count} / ${row.paid_store_limit}`}
          />
          <Current label={t("ops.colStatus")} value={t(stateLabelKey[row.state])} />
          <Current
            label={t("ops.paidUntil")}
            value={row.paid_until ? fmtDate(row.paid_until) : t("ops.noValue")}
          />
          <Current label={t("ops.trialEnds")} value={fmtDate(row.trial_ends_at)} />
          <Current
            label={t("ops.planLabel")}
            value={
              row.plan === "yearly"
                ? t("ops.planYearly")
                : row.plan === "monthly"
                  ? t("ops.planMonthly")
                  : t("ops.noValue")
            }
          />
          <Current label={t("ops.colStaff")} value={String(row.staff_count)} />
          {row.suspended_at && (
            <Current
              label={t("ops.stateSuspended")}
              value={fmtDate(row.suspended_at)}
              tone="warning"
            />
          )}
          {row.closed_at && (
            <Current
              label={t("ops.stateClosed")}
              value={fmtDate(row.closed_at)}
              tone="destructive"
            />
          )}
        </div>

        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("ops.changeLabel")}
          </span>
          <Select
            value={action}
            onValueChange={(v) => {
              const next = v as EntitlementAction;
              setAction(next);
              // Switching intent resets the value, so a stale number never rides into
              // a different action.
              setValue(openingValue(row, next));
            }}
          >
            <SelectTrigger className="h-9 bg-card text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entitlementActions.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(actionLabelKey[a])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>

        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("ops.newValue")}</span>
          {action === "plan" ? (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t("ops.planMonthly")}</SelectItem>
                <SelectItem value="yearly">{t("ops.planYearly")}</SelectItem>
              </SelectContent>
            </Select>
          ) : action === "until" ? (
            <Input
              className="h-9"
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <Input
              className="h-9"
              inputMode="numeric"
              maxLength={4}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, "").slice(0, 4))}
            />
          )}
          <p className="text-[11px] text-muted-foreground">{t(actionHintKey[action])}</p>
        </Label>

        {preview.ok ? (
          <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-muted-foreground">{t("ops.becomes")}</span>
            <Badge
              className={cn(
                "rounded-full border-transparent px-2.5 py-0.5",
                stateStyle[preview.state],
              )}
            >
              {t(stateLabelKey[preview.state])}
            </Badge>
            <span className="text-muted-foreground">
              {preview.days >= 0
                ? t("ops.daysLeft", { days: preview.days })
                : t("ops.daysOver", { days: -preview.days })}
            </span>
          </p>
        ) : (
          // An empty box is not a mistake — the hint under the field already says
          // what to type, so the refusal only appears once there is something to refuse.
          value.trim() !== "" && <p className="text-[13px] text-destructive">{preview.error}</p>
        )}

        <Label className="block space-y-1">
          <span className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>{t("ops.reasonLabel")}</span>
            <span className="tabular">
              {why.length}/{REASON_MAX_CHARS}
            </span>
          </span>
          <Textarea
            rows={2}
            value={reason}
            maxLength={REASON_MAX_CHARS}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("ops.reasonPlaceholder")}
          />
        </Label>

        {!!pendingPays.data?.length && (
          <div className="space-y-2 rounded-2xl border border-warning/40 bg-warning/10 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("ops.pendingPayments")}
            </p>
            {pendingPays.data.map((p) => (
              <div key={p.tx_ref} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-[12px]">
                  <div className="tabular truncate font-medium">{p.tx_ref}</div>
                  <div className="text-muted-foreground">
                    {fmtMoney(p.currency === "USD" ? "USD" : "MWK", Number(p.amount))} ·{" "}
                    {t("ops.pendingSlots", { count: p.stores })} · {fmtDate(p.created_at)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={checking !== null}
                  onClick={() => void verifyNow(p)}
                >
                  {checking === p.tx_ref ? t("common.saving") : t("ops.verifyNow")}
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">{t("ops.verifyHint")}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="flex-1" disabled={!canSend} onClick={() => void apply()}>
            {busy ? t("common.saving") : t("common.apply")}
          </Button>
        </div>

        {(verbs.length > 0 || canPurge) && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-[11px] font-medium text-muted-foreground">{t("ops.accessTitle")}</p>
            {pending ? (
              <div className="space-y-2 rounded-2xl border p-3">
                <p className="text-[13px] text-muted-foreground">{t(actionHintKey[pending])}</p>
                {accessState && (
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
                    <span className="text-muted-foreground">{t("ops.becomes")}</span>
                    <Badge
                      className={cn(
                        "rounded-full border-transparent px-2.5 py-0.5",
                        stateStyle[accessState],
                      )}
                    >
                      {t(stateLabelKey[accessState])}
                    </Badge>
                  </p>
                )}
                {pending === "purge" && (
                  <Label className="block space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t("ops.purgeNameLabel", { name: row.name })}
                    </span>
                    <Input
                      className="h-9"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                    />
                  </Label>
                )}
                <Label className="block space-y-1">
                  <span className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>{t("ops.reasonLabel")}</span>
                    <span className="tabular">
                      {why.length}/{REASON_MAX_CHARS}
                    </span>
                  </span>
                  <Textarea
                    rows={2}
                    value={why}
                    maxLength={REASON_MAX_CHARS}
                    onChange={(e) => setWhy(e.target.value)}
                    placeholder={t("ops.reasonPlaceholder")}
                  />
                </Label>
                {!accessPreview?.ok && (
                  <p className="text-[13px] text-destructive">{accessPreview?.error}</p>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setPending(null)}>
                    {t("common.back")}
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={!canSendAccess}
                    onClick={() => void sendAccess(pending)}
                  >
                    {busy
                      ? t("common.saving")
                      : pending === "purge"
                        ? t("ops.purgeButton")
                        : t("common.confirm")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {verbs.map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      variant={harmful(a) ? "destructive" : "outline"}
                      onClick={() => openAccess(a)}
                    >
                      {t(actionLabelKey[a])}
                    </Button>
                  ))}
                  {canPurge && (
                    <Button size="sm" variant="destructive" onClick={() => openAccess("purge")}>
                      {t("ops.actionPurge")}
                    </Button>
                  )}
                </div>
                {canPurge && waitUntil && waitDays > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("ops.purgeWait", { date: fmtDate(waitUntil.toISOString()) })}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-medium text-muted-foreground">{t("ops.recentTitle")}</p>
          {audit.isError ? (
            <p className="text-[12px] text-destructive">{(audit.error as Error).message}</p>
          ) : audit.isPending ? (
            <p className="text-[12px] text-muted-foreground">{t("common.loading")}</p>
          ) : !audit.data?.length ? (
            <p className="text-[12px] text-muted-foreground">{t("ops.recentEmpty")}</p>
          ) : (
            audit.data.map((e) => <HistoryRow key={e.id} entry={e} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Current({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "destructive";
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate font-medium",
          tone === "warning" && "text-warning-foreground",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** One journalled change: what moved, who moved it, and the reason they gave. */
function HistoryRow({ entry }: { entry: AuditEntry }) {
  const { t } = useI18n();
  const key = auditField[entry.action];
  const shown = (v: unknown) => {
    if (v === null || v === undefined || v === "") return t("ops.noValue");
    if (entry.action === "slots") return String(v);
    if (entry.action === "plan") return t(v === "yearly" ? "ops.planYearly" : "ops.planMonthly");
    const at = new Date(String(v));
    return Number.isNaN(at.getTime()) ? String(v) : fmtDate(at.toISOString());
  };
  return (
    <div className="text-[12px]">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-medium">{t(actionLabelKey[entry.action])}</span>
        <span className="tabular text-muted-foreground">
          {shown(entry.before[key])} → {shown(entry.after[key])}
        </span>
      </div>
      <p className="text-muted-foreground">{entry.reason}</p>
      <p className="text-[11px] text-muted-foreground">
        {entry.actor} · {fmtDate(entry.created_at)}
      </p>
    </div>
  );
}
