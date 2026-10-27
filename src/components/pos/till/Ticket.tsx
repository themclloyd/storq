import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Delete02Icon,
  MinusSignIcon,
  Note01Icon,
  PauseIcon,
  PercentIcon,
  PlusSignIcon,
  ShoppingCart01Icon,
  UserPlusIcon,
} from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/pos/bits";
import { usePos } from "@/lib/pos";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { tileInitials } from "@/components/pos/till/tiles";

/** One line of the ticket, already priced (unit, gross, discount, net). */
export type TicketRow = {
  id: string;
  name: string;
  unit: number;
  qty: number;
  note?: string | undefined;
  gross: number;
  disc: number;
  net: number;
};

export type TicketTotals = {
  gross: number;
  discount: number;
  tax: number;
  rate: number;
  incl: boolean;
  total: number;
};

export type TicketCustomer = { name: string; phone: string };

/**
 * The receipt-tape side of the counter: who it is for, the actions that act on
 * the whole ticket, the lines, and the totals that end in the Charge button.
 * It is rendered once and reused by the desktop pane and the phone sheet so the
 * two surfaces cannot drift apart.
 */
export function Ticket({
  title,
  storeName,
  rows,
  totals,
  customer,
  note,
  approval,
  className,
  onCustomer,
  onClear,
  onHold,
  onDiscount,
  onNote,
  onOpenLine,
  onQty,
  onCharge,
  onLayby,
}: {
  title: string;
  storeName: string;
  rows: TicketRow[];
  totals: TicketTotals;
  customer: TicketCustomer;
  note: string;
  approval: boolean;
  className?: string;
  onCustomer: () => void;
  onClear: () => void;
  onHold: () => void;
  onDiscount: () => void;
  onNote: () => void;
  onOpenLine: (id: string) => void;
  /** Step a line up or down without opening the line sheet. */
  onQty: (id: string, qty: number) => void;
  onCharge: () => void;
  onLayby: () => void;
}) {
  const { money } = usePos();
  const { t } = useI18n();
  const has = rows.length > 0;
  const count = rows.reduce((a, r) => a + r.qty, 0);

  return (
    <section className={cn("till-surface flex min-h-0 flex-col overflow-hidden", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold">{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {storeName} · {t("till.itemsCount", { count })}
          </p>
        </div>
        {has && (
          <button
            type="button"
            onClick={onClear}
            aria-label={t("till.clear")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-4" />
          </button>
        )}
      </header>

      {/* Customer first, the way Square pins "+ Add customer" above the ticket. */}
      <button
        type="button"
        onClick={onCustomer}
        className="flex w-full items-center gap-2.5 border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-[3px] focus-visible:ring-primary/30"
      >
        {customer.name ? (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-bold text-primary-soft-foreground">
              {tileInitials(customer.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{customer.name}</span>
              {customer.phone && (
                <span className="tabular block truncate text-[11px] text-muted-foreground">
                  {customer.phone}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-primary">
              {t("till.changeWord")}
            </span>
          </>
        ) : (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-input text-muted-foreground">
              <HugeiconsIcon icon={UserPlusIcon} className="size-4" />
            </span>
            <span className="text-[13px] font-semibold text-primary">{t("till.addCustomer")}</span>
          </>
        )}
      </button>

      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <TicketAction
          icon={PauseIcon}
          label={t("till.holdCart")}
          disabled={!has}
          onClick={onHold}
        />
        <TicketAction
          icon={PercentIcon}
          label={t("till.addDiscount")}
          disabled={!has}
          onClick={onDiscount}
        />
        <TicketAction icon={Note01Icon} label={t("till.orderNote")} onClick={onNote} />
      </div>

      {note && (
        <button
          type="button"
          onClick={onNote}
          className="flex items-start gap-1.5 border-b border-border bg-warning-soft/60 px-4 py-1.5 text-left text-[11px] font-medium text-warning-foreground focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-[3px] focus-visible:ring-primary/30"
        >
          <HugeiconsIcon icon={Note01Icon} className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-2">{note}</span>
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!has ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <HugeiconsIcon icon={ShoppingCart01Icon} className="size-5" />
            </span>
            <p className="text-[13px] text-muted-foreground">{t("till.tapItems")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div
                key={r.id}
                className="pos-row flex w-full items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  onClick={() => onOpenLine(r.id)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                >
                  <span className="block truncate text-[13px] font-semibold">{r.name}</span>
                  <span className="tabular block truncate text-[11px] text-muted-foreground">
                    {money(r.unit)} {t("till.eachWord")}
                    {r.disc > 0 && <span className="ml-1">· −{money(r.disc)}</span>}
                  </span>
                  {r.note && (
                    <span className="block truncate text-[11px] italic text-muted-foreground">
                      {r.note}
                    </span>
                  )}
                </button>
                <span className="tabular shrink-0 pt-0.5 text-right text-[13px] font-bold">
                  {r.disc > 0 && (
                    <span className="block text-[11px] font-normal text-muted-foreground line-through">
                      {money(r.gross)}
                    </span>
                  )}
                  {money(r.net)}
                </span>
                <span className="flex shrink-0 items-center gap-0.5 pt-0.5">
                  <button
                    type="button"
                    aria-label={t("till.decrease")}
                    onClick={() => onQty(r.id, Math.max(1, r.qty - 1))}
                    disabled={r.qty <= 1}
                    className="grid size-7 place-items-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:bg-muted disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  >
                    <HugeiconsIcon icon={MinusSignIcon} className="size-3.5" />
                  </button>
                  <span className="tabular w-6 text-center text-[12px] font-bold">{r.qty}</span>
                  <button
                    type="button"
                    aria-label={t("till.increase")}
                    onClick={() => onQty(r.id, r.qty + 1)}
                    className="grid size-7 place-items-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="space-y-2.5 border-t border-border bg-card px-4 pt-3 pb-4">
        <div className="space-y-1 text-[12px]">
          <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
            <span>{t("doc.subtotal")}</span>
            <span className="tabular">{money(totals.gross)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">{t("doc.discount")}</span>
              <span className="tabular font-semibold text-success">−{money(totals.discount)}</span>
            </div>
          )}
          {totals.rate > 0 && (
            <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
              <span>
                {t("till.vat")} {totals.rate}% {totals.incl ? t("till.included") : t("till.added")}
              </span>
              <span className="tabular">{money(totals.tax)}</span>
            </div>
          )}
        </div>

        <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
          <span className="text-[13px] font-semibold text-muted-foreground">
            {t("common.total")}
          </span>
          <Money
            value={money(totals.total)}
            className="tabular text-[30px] leading-none font-extrabold tracking-tight"
          />
        </div>

        <Button
          variant="charge"
          className="h-16 w-full text-base"
          disabled={!has}
          onClick={onCharge}
        >
          {approval
            ? t("till.sendForApproval")
            : has
              ? t("till.charge", { amount: money(totals.total) })
              : t("till.chargeShort")}
        </Button>
        <Button size="lg" variant="outline" className="w-full" disabled={!has} onClick={onLayby}>
          {approval ? t("till.laybyInvoice") : t("till.startLayby")}
        </Button>
      </footer>
    </section>
  );
}

function TicketAction({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-[3px] focus-visible:ring-primary/30"
    >
      <HugeiconsIcon icon={icon} className="size-4" />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
