import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";
import type { TicketCustomer } from "@/components/pos/till/Ticket";

/** The phone format app.checkout accepts; caught here so the sale never stalls. */
const PHONE_RE = /^[+0-9()\- ]{6,32}$/;

/**
 * Customer on the ticket: a name and a phone, enough to print on the receipt,
 * send it over WhatsApp, and find the sale later. Kept on this sale only, the
 * till has no customer register to keep in sync while it trades.
 */
export function CustomerDialog({
  customer,
  onSave,
  onRemove,
  onClose,
}: {
  customer: TicketCustomer;
  onSave: (customer: TicketCustomer) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);

  const save = () => {
    const next = { name: name.trim(), phone: phone.trim() };
    if (!next.name) {
      toast.error(t("till.customerName"));
      return;
    }
    if (next.phone && !PHONE_RE.test(next.phone)) {
      toast.error(t("till.phoneInvalid"));
      return;
    }
    onSave(next);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden bg-card p-0">
        <DialogHeader className="space-y-0 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle>{t("till.customerTitle")}</DialogTitle>
          <DialogDescription className="mt-1 text-[11px] leading-relaxed">
            {t("till.customerSub")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <Field label={t("till.customerNameRequired")}>
            <Input
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("till.customerNamePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </Field>
          <Field label={t("till.phoneLabel")}>
            <Input
              inputMode="tel"
              maxLength={32}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("till.customerPhonePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </Field>
        </div>

        <DialogFooter className="flex-row gap-2 border-t border-border bg-secondary/35 px-5 py-4 sm:justify-between sm:space-x-0">
          {customer.name ? (
            <Button
              variant="ghost"
              size="lg"
              className="px-3 text-destructive hover:bg-destructive-soft hover:text-destructive"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              {t("till.remove")}
            </Button>
          ) : (
            <Button variant="ghost" size="lg" className="px-3" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          )}
          <Button size="lg" className="flex-1" onClick={save}>
            {t("till.saveCustomer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
