import { useMemo, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, BanknoteIcon, Delete02Icon, PlusSignIcon, Tick02Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Field, NativeSelect } from "@/components/pos/bits";
import { PasswordInput } from "@/components/password-input";
import { NumberPad } from "@/components/pos/till/NumberPad";
import type { TicketCustomer } from "@/components/pos/till/Ticket";
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
  onClose,
  onDone,
}: {
  kind: "sale" | "layby";
  total: number;
  approval: boolean;
  needsPin: boolean;
  customer: TicketCustomer;
  note: string;
  onClose: () => void;
  onDone: (form: SaleForm) => Promise<void>;
}) {
  const { money, paymentMethods } = usePos();
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>("pick");
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

  /** A quick-cash bill is intent plus amount: take it and show the change. */
  const quickCash = (amount: number) => void submit([{ method: "cash", amount }], total, "cash");

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

          <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-3 sm:px-5">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              <HugeiconsIcon icon={ArrowLeft01Icon} />
              {t("till.tenderBack")}
            </Button>
            <div className="ml-auto text-right">
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {approval ? t("till.invoiceTotal") : t("till.totalDueLabel")}
              </div>
              <div className="tabular text-2xl leading-none font-extrabold">{money(total)}</div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5 sm:px-6">
              {approval ? (
                <section className="rounded-[12px] border border-warning/40 bg-warning/15 px-4 py-3 text-[12px] leading-relaxed text-warning-foreground">
                  {t("till.approvalNote")}
                </section>
              ) : stage === "cash" ? (
                <section>
                  <SectionTitle>{t("till.cashReceived")}</SectionTitle>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="space-y-2">
                      <div className="rounded-[10px] border border-border bg-card px-3 py-2 text-right">
                        <span className="tabular block truncate text-3xl leading-tight font-extrabold">
                          {pay > 0 ? money(pay) : "—"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Chip active={pay === total} onClick={() => setTendered(String(total))}>
                          {t("till.tenderExact")} · {money(total)}
                        </Chip>
                        {presets.slice(1).map((p) => (
                          <Chip
                            key={p.amount}
                            active={pay === p.amount}
                            onClick={() => setTendered(String(p.amount))}
                          >
                            {money(p.amount)}
                          </Chip>
                        ))}
                        {tendered !== "" && (
                          <Chip active={false} onClick={() => setTendered("")}>
                            {t("till.keyClear")}
                          </Chip>
                        )}
                        <Chip active={false} onClick={() => setStage("pick")}>
                          {t("till.otherPayment")}
                        </Chip>
                      </div>
                    </div>
                    <NumberPad value={tendered} onChange={setTendered} decimal />
                  </div>
                  {change > 0 && <ChangeBanner change={change} money={money} t={t} />}
                </section>
              ) : (
                <>
                  {kind === "sale" && !approval && (
                    <section>
                      <SectionTitle>{t("till.quickCash")}</SectionTitle>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {presets.map((p) => (
                          <button
                            key={p.amount}
                            type="button"
                            disabled={busy || needsPin}
                            onClick={() => quickCash(p.amount)}
                            className={cn(
                              "till-key flex flex-col items-center justify-center gap-0.5 border px-2 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-40",
                              p.exact
                                ? "border-primary bg-primary-soft text-primary-soft-foreground"
                                : "border-border bg-card text-foreground hover:bg-muted",
                            )}
                          >
                            <span className="text-[10px] font-semibold tracking-wide uppercase opacity-80">
                              {p.exact
                                ? t("till.cashExact")
                                : t("till.cashNext", { amount: money(p.change) })}
                            </span>
                            <span className="tabular text-base font-extrabold">
                              {money(p.amount)}
                            </span>
                          </button>
                        ))}
                      </div>
                      {needsPin && (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {t("till.managerPinRequired")}
                        </p>
                      )}
                    </section>
                  )}

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
                            {v === total ? t("till.tenderFullAmount") : t("till.tenderHalfAmount")}{" "}
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
                        onClick={() => setExtra((x) => [...x, { method: nextMethod, amount: "" }])}
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
                          kind === "layby" ? t("till.customerNameRequired") : t("till.customerName")
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
          </div>

          <footer className="border-t border-border bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                {short > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {t("till.remainingDue")}
                    </div>
                    <div className="tabular text-xl font-extrabold">{money(short)}</div>
                  </>
                ) : change > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold tracking-wider text-success uppercase">
                      {t("till.changeDue")}
                    </div>
                    <div className="tabular text-xl font-extrabold text-success">
                      {money(change)}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <HugeiconsIcon icon={BanknoteIcon} className="size-4 shrink-0" />
                    <span className="line-clamp-2">
                      {approval ? t("till.noPaymentApproval") : t("till.selectMethod")}
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
