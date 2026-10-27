import { useMemo, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, BanknoteIcon, Delete02Icon, PlusSignIcon, Tick02Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Field, Money, NativeSelect } from "@/components/pos/bits";
import { PasswordInput } from "@/components/password-input";
import { NumberPad } from "@/components/pos/till/NumberPad";
import type { TicketCustomer, TicketRow } from "@/components/pos/till/Ticket";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { isCashMethod, methodIcon, methodLabel } from "@/lib/payment-methods";
import { round2 } from "@/lib/products";
import { validatePin } from "@/lib/validate";
import { cn } from "@/lib/utils";
import {
  cashPresets,
  changeDue,
  depositPresets,
  tenderTotal,
  type SaleForm,
  type TenderPart,
} from "@/lib/till";

type Stage = "pick" | "cash";

/**
 * The tender screen: a full-viewport, high-focus surface with Square's two
 * shortcuts — one-tap smart cash bills, and a number pad for anything else.
 * Everything the checkout RPC needs is assembled here and handed to the
 * register as one `SaleForm`; this component never talks to the database.
 */
export function TenderScreen({
  kind,
  total,
  approval,
  needsPin,
  customer,
  note: initialNote,
  rows: orderRows,
  onClose,
  onDone,
}: {
  kind: "sale" | "layby";
  total: number;
  approval: boolean;
  needsPin: boolean;
  customer: TicketCustomer;
  note: string;
  /** What is being paid for, shown beside the pad so the cashier never has to
   *  go back to the sale to check the basket. */
  rows: TicketRow[];
  onClose: () => void;
  onDone: (form: SaleForm) => Promise<void>;
}) {
  const { money, paymentMethods } = usePos();
  const { t } = useI18n();
  // Cash is the default tender for a straight sale, so the pad and the amount
  // are on screen from the first frame. Choosing a method before you can type
  // an amount is a step for the minority, not the counter's default.
  const cashFirst = !approval && kind === "sale" && paymentMethods.some(isCashMethod);
  const [stage, setStage] = useState<Stage>(cashFirst ? "cash" : "pick");
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [extra, setExtra] = useState<{ method: string; amount: string }[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [note, setNote] = useState(initialNote);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const presets = useMemo(() => cashPresets(total), [total]);
  const deposits = useMemo(() => depositPresets(total), [total]);
  const methodOpts = paymentMethods.map((code) => ({ value: code, label: methodLabel(code) }));
  const nextMethod = paymentMethods.find((code) => !isCashMethod(code)) ?? "cash";
  const pay = Number(tendered || 0);
  const itemCount = orderRows.reduce((a, r) => a + r.qty, 0);

  // The tenders this screen would send right now, before any clamping.
  const rows: TenderPart[] = useMemo(() => {
    if (approval) return [];
    if (splitting) {
      return [
        { method, amount: round2(pay) },
        ...extra.map((e) => ({ method: e.method, amount: Number(e.amount || 0) })),
      ].filter((row) => row.amount > 0);
    }
    if (kind === "layby") return pay > 0 ? [{ method, amount: round2(Math.min(pay, total)) }] : [];
    if (isCashMethod(method)) return [{ method: "cash", amount: round2(pay || total) }];
    return [{ method, amount: total }];
  }, [approval, splitting, kind, method, pay, extra, total]);

  const sumT = tenderTotal(rows);
  const covered = approval
    ? total
    : splitting || isCashMethod(method) || kind === "layby"
      ? sumT
      : total;
  const short = round2(Math.max(0, total - covered));
  const change = kind === "sale" && !approval ? changeDue(rows, total, "sale") : 0;
  const pinBad = needsPin && validatePin(pin) !== null;

  const canSubmit = (() => {
    if (busy || pinBad) return false;
    if (approval) return true;
    if (kind === "layby") return !!name.trim() && sumT <= total;
    if (splitting) return sumT >= total && sumT <= total * 2;
    if (isCashMethod(method)) return pay >= total;
    return true;
  })();

  const submit = async (tenders: TenderPart[], payment: number, pm: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await onDone({
        payment,
        method: pm,
        tenders,
        name: name.trim(),
        phone: phone.trim(),
        note: note.trim(),
        overridePin: needsPin ? pin : null,
      });
    } finally {
      setBusy(false);
    }
  };

  const complete = () => {
    if (!canSubmit) return;
    const pm = splitting
      ? new Set(rows.map((r) => r.method)).size > 1
        ? "split"
        : (rows[0]?.method ?? "cash")
      : method;
    // An approval invoice records no money: the approver takes payment later.
    const payment = approval ? 0 : kind === "layby" ? round2(Math.min(sumT, total)) : total;
    void submit(rows, payment, pm);
  };

  const cta = approval
    ? t("till.sendForApproval")
    : kind === "layby"
      ? t("till.openLayby")
      : t("till.completeSale", { amount: money(total) });

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-md" />
        {/* Built on the raw primitive, not the shared card: "inset: 0" on a fixed
            element stretches it to the viewport without any width/height/translate
            overrides, so the tender cannot fall back to a centred card. */}
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background outline-none">
          <DialogPrimitive.Title className="sr-only">
            {kind === "layby" ? t("till.titleStartLayby") : t("till.titleTakePayment")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t("till.selectMethod")}
          </DialogPrimitive.Description>

          <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-3 sm:px-5">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              <HugeiconsIcon icon={ArrowLeft01Icon} />
              {t("till.tenderBack")}
            </Button>
            <div className="min-w-0 flex-1">
              <h2 className="font-display truncate text-lg leading-tight">
                {kind === "layby" ? t("till.titleStartLayby") : t("till.titleTakePayment")}
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {t("till.itemsCount", { count: itemCount })}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {approval ? t("till.invoiceTotal") : t("till.totalDueLabel")}
              </div>
              <Money
                value={money(total)}
                className="tabular text-2xl leading-none font-extrabold"
              />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
              <div className="min-w-0 space-y-5">
                {approval ? (
                  <section className="rounded-[12px] border border-warning/40 bg-warning/15 px-4 py-3 text-[12px] leading-relaxed text-warning-foreground">
                    {t("till.approvalNote")}
                  </section>
                ) : stage === "cash" ? (
                  <section className="space-y-3">
                    <div className="rounded-[12px] border border-border bg-card px-4 py-3">
                      <div className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                        {t("till.cashReceived")}
                      </div>
                      <Money
                        value={money(pay)}
                        className={cn(
                          "tabular block text-right text-4xl leading-tight font-extrabold",
                          pay <= 0 && "text-muted-foreground/50",
                        )}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                      <NumberPad value={tendered} onChange={setTendered} decimal />
                      <div className="flex flex-col gap-2">
                        <PresetKey
                          amount={total}
                          sub={t("till.cashExact")}
                          active={pay === total}
                          onClick={() => setTendered(String(total))}
                        />
                        {presets.slice(1).map((p) => (
                          <PresetKey
                            key={p.amount}
                            amount={p.amount}
                            sub={t("till.cashNext", { amount: money(p.change) })}
                            active={pay === p.amount}
                            onClick={() => setTendered(String(p.amount))}
                          />
                        ))}
                        {tendered !== "" && (
                          <Button size="sm" variant="ghost" onClick={() => setTendered("")}>
                            {t("till.keyClear")}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setStage("pick")}>
                          {t("till.otherPayment")}
                        </Button>
                      </div>
                    </div>
                    {change > 0 && <ChangeBanner change={change} money={money} t={t} />}
                  </section>
                ) : (
                  <>
                    {!approval && (
                      <section>
                        <SectionTitle>{t("till.otherPayment")}</SectionTitle>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {paymentMethods.map((code) => (
                            <MethodButton
                              key={code}
                              code={code}
                              active={!splitting && method === code}
                              onClick={() => {
                                setMethod(code);
                                if (isCashMethod(code)) {
                                  setSplitting(false);
                                  setStage("cash");
                                  setTendered("");
                                }
                              }}
                            />
                          ))}
                          {kind === "sale" && (
                            <button
                              type="button"
                              aria-pressed={splitting}
                              onClick={() => {
                                setSplitting((s) => !s);
                                if (!splitting) setMethod(nextMethod);
                              }}
                              className={cn(
                                "flex h-14 items-center gap-3 rounded-[12px] border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
                                splitting
                                  ? "border-primary bg-primary-soft"
                                  : "border-border bg-card hover:bg-muted/60",
                              )}
                            >
                              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground">
                                <HugeiconsIcon icon={PlusSignIcon} />
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                                {t("doc.split")}
                              </span>
                              {splitting && (
                                <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
                              )}
                            </button>
                          )}
                        </div>
                      </section>
                    )}

                    {kind === "layby" && !approval && (
                      <section className="space-y-3">
                        <SectionTitle>{t("till.depositLabel")}</SectionTitle>
                        <div className="flex flex-wrap gap-2">
                          {deposits.map((v) => (
                            <Chip key={v} active={pay === v} onClick={() => setTendered(String(v))}>
                              {v === total
                                ? t("till.tenderFullAmount")
                                : t("till.tenderHalfAmount")}{" "}
                              · {money(v)}
                            </Chip>
                          ))}
                        </div>
                        <Field label={t("till.labelDepositPaidNow")}>
                          <Input
                            inputMode="decimal"
                            className="tabular h-12 text-right text-lg font-semibold"
                            value={tendered}
                            onChange={(e) => setTendered(e.target.value.replace(/[^0-9.]/g, ""))}
                            placeholder="0.00"
                          />
                        </Field>
                      </section>
                    )}

                    {splitting && (
                      <section className="space-y-2">
                        <SectionTitle>{t("till.splitTender")}</SectionTitle>
                        <div className="flex items-center gap-2">
                          <NativeSelect
                            className="w-40"
                            value={method}
                            onChange={setMethod}
                            options={methodOpts}
                          />
                          <Input
                            inputMode="decimal"
                            aria-label={t("till.ariaPaymentAmount", { no: 1 })}
                            className="tabular h-10 flex-1 text-right"
                            value={tendered}
                            onChange={(e) => setTendered(e.target.value.replace(/[^0-9.]/g, ""))}
                            placeholder="0.00"
                          />
                        </div>
                        {extra.map((e, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <NativeSelect
                              className="w-40"
                              value={e.method}
                              onChange={(v) =>
                                setExtra((x) =>
                                  x.map((r, j) => (j === i ? { ...r, method: v } : r)),
                                )
                              }
                              options={methodOpts}
                            />
                            <Input
                              inputMode="decimal"
                              aria-label={t("till.ariaPaymentAmount", { no: i + 2 })}
                              value={e.amount}
                              onChange={(ev) =>
                                setExtra((x) =>
                                  x.map((r, j) =>
                                    j === i ? { ...r, amount: ev.target.value } : r,
                                  ),
                                )
                              }
                              placeholder="0.00"
                              className="tabular h-10 flex-1 text-right"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-10 shrink-0"
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
                            setExtra((x) => [...x, { method: nextMethod, amount: "" }])
                          }
                        >
                          <HugeiconsIcon icon={PlusSignIcon} />
                          {t("till.addAnotherPayment")}
                        </Button>
                      </section>
                    )}

                    {(kind === "layby" || approval) && (
                      <section className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label={
                            kind === "layby"
                              ? t("till.customerNameRequired")
                              : t("till.customerName")
                          }
                        >
                          <Input
                            maxLength={120}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t("till.customerNamePlaceholder")}
                          />
                        </Field>
                        <Field label={t("till.phoneLabel")}>
                          <Input
                            inputMode="tel"
                            maxLength={32}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder={t("till.customerPhonePlaceholder")}
                          />
                        </Field>
                      </section>
                    )}

                    <section className="space-y-3">
                      <Field label={approval ? t("till.noteForApprover") : t("till.orderNote")}>
                        <Input
                          maxLength={200}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={t("till.orderNotePlaceholder")}
                        />
                      </Field>
                    </section>
                  </>
                )}

                {needsPin && (
                  <section>
                    <Field label={t("till.managerPinOverCap")}>
                      <PasswordInput
                        inputMode="numeric"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        placeholder={t("till.enterManagerPin")}
                        className="tabular"
                      />
                    </Field>
                  </section>
                )}

                {change > 0 && stage === "pick" && (
                  <ChangeBanner change={change} money={money} t={t} />
                )}
              </div>

              {!approval && (
                <OrderSummary rows={orderRows} total={total} received={pay} change={change} />
              )}
            </div>
          </div>

          <footer className="border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-6">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
              <div className="min-w-0 flex-1">
                {short > 0 ? (
                  <>
                    <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("till.remainingDue")}
                    </div>
                    <div className="tabular text-xl font-extrabold">{money(short)}</div>
                  </>
                ) : change > 0 ? (
                  <>
                    <div className="text-[11px] font-semibold tracking-wider text-success uppercase">
                      {t("till.changeDue")}
                    </div>
                    <div className="tabular text-xl font-extrabold text-success">
                      {money(change)}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <HugeiconsIcon icon={BanknoteIcon} className="size-4 shrink-0" />
                    <span className="line-clamp-2">
                      {approval
                        ? t("till.noPaymentApproval")
                        : stage === "cash"
                          ? t("till.enterAmount")
                          : t("till.selectMethod")}
                    </span>
                  </div>
                )}
              </div>
              <Button
                variant="charge"
                size="lg"
                className="h-14 min-w-44 px-5 text-base"
                disabled={!canSubmit}
                onClick={complete}
              >
                {busy ? t("common.saving") : cta}
              </Button>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/**
 * What is being paid for, pinned beside the pad. The till should never ask a
 * cashier to go back to the sale to check what the customer is paying for.
 */
function OrderSummary({
  rows,
  total,
  received,
  change,
}: {
  rows: TicketRow[];
  total: number;
  received: number;
  change: number;
}) {
  const { t } = useI18n();
  const { money } = usePos();
  const count = rows.reduce((a, r) => a + r.qty, 0);
  return (
    <aside className="hidden self-start rounded-[12px] border border-border bg-card lg:block">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-bold">{t("till.summaryTitle")}</h3>
        <p className="text-[11px] text-muted-foreground">{t("till.itemsCount", { count })}</p>
      </div>
      <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto px-4">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
            <span className="tabular w-6 shrink-0 text-muted-foreground">{r.qty}×</span>
            <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
            <span className="tabular shrink-0 font-semibold">{money(r.net)}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 border-t border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">
            {t("common.total")}
          </span>
          <Money value={money(total)} className="tabular text-xl font-extrabold" />
        </div>
        {received > 0 && (
          <div className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
            <span>{t("till.summaryReceived")}</span>
            <span className="tabular">{money(received)}</span>
          </div>
        )}
        {change > 0 && (
          <div className="flex items-baseline justify-between gap-2 text-[12px] font-semibold text-success">
            <span>{t("till.summaryChange")}</span>
            <span className="tabular">{money(change)}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

/** One quick-cash bill: the amount it hands over and what it leaves as change. */
function PresetKey({
  amount,
  sub,
  active,
  onClick,
}: {
  amount: number;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  const { money } = usePos();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "till-key flex h-12 items-center justify-between gap-2 border px-3 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        active
          ? "border-primary bg-primary-soft text-primary-soft-foreground"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      <span className="tabular text-[15px] font-extrabold">{money(amount)}</span>
      <span className="truncate text-[11px] font-medium opacity-70">{sub}</span>
    </button>
  );
}

function MethodButton({
  code,
  active,
  onClick,
}: {
  code: string;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-14 items-center gap-3 rounded-[12px] border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        active ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[10px]",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={methodIcon(code)} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{methodLabel(code)}</span>
        {isCashMethod(code) && (
          <span className="block truncate text-[11px] text-muted-foreground">
            {t("till.cashCustom")}
          </span>
        )}
      </span>
      {active && <HugeiconsIcon icon={Tick02Icon} className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

function Chip({
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
        "tabular inline-flex h-9 items-center rounded-full border px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ChangeBanner({
  change,
  money,
  t,
}: {
  change: number;
  money: (n: number) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] bg-success px-4 py-3 text-success-foreground">
      <span className="text-[11px] font-bold tracking-wider uppercase">{t("till.changeDue")}</span>
      <span className="tabular text-2xl font-extrabold">{money(change)}</span>
    </div>
  );
}
