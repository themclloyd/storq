import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, PrinterIcon, Share01Icon, Tick02Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadReceiptPdf } from "@/lib/pdf";
import { useI18n } from "@/lib/i18n";
import {
  printReceipt,
  receiptText,
  receiptTitle,
  type MoneyFmt,
  type Receipt,
} from "@/lib/receipts";

export function ReceiptModal({
  receipt,
  money,
  onClose,
}: {
  receipt: Receipt;
  money: MoneyFmt;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const doneLabel =
    receipt.status === "layby_completed"
      ? t("till.laybyFullyPaid")
      : receipt.kind === "layby"
        ? t("till.laybyOpened")
        : t("till.saleComplete");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* One flat surface: no shadow, no tinted bands and no rules between the
          outcome, the change due and the actions. */}
      <DialogContent className="max-w-md gap-0 overflow-hidden bg-card p-0 shadow-none">
        <DialogHeader className="items-center gap-2 px-5 pt-6 pb-5 text-center sm:text-center">
          <span className="grid size-11 place-items-center rounded-full bg-success/15 text-success">
            <HugeiconsIcon icon={Tick02Icon} className="size-6" />
          </span>
          <DialogTitle className="text-lg">{doneLabel}</DialogTitle>
          <DialogDescription className="text-xs">
            {receiptTitle(receipt)} #{receipt.number} · {money(receipt.total)}
          </DialogDescription>
        </DialogHeader>

        {/* The one number the cashier must read from across the counter, set in
            the success colour rather than a filled strip. */}
        {receipt.change > 0 && (
          <div className="flex items-baseline justify-between gap-3 px-5 pb-5">
            <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              {t("till.changeDue")}
            </span>
            <span className="tabular text-4xl leading-none font-extrabold text-success">
              {money(receipt.change)}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 px-5 pb-6">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => {
                // Same 80mm roll as the Print sheet, just saved as a PDF.
                void downloadReceiptPdf(receipt, money).then(() =>
                  toast.success(t("till.receiptDownloaded")),
                );
              }}
            >
              <HugeiconsIcon icon={Download01Icon} /> PDF
            </Button>
            <Button
              size="lg"
              variant="accent"
              className="flex-1"
              onClick={() => {
                if (!printReceipt(receipt, money)) toast.error(t("till.printPopupBlock"));
              }}
            >
              <HugeiconsIcon icon={PrinterIcon} /> {t("till.print")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => {
                // Digital receipt: straight to the customer's chat when we have a number.
                const text = encodeURIComponent(receiptText(receipt, money));
                const digits = (receipt.customerPhone ?? "").replace(/\D/g, "");
                const url = digits
                  ? `https://wa.me/${digits}?text=${text}`
                  : `https://wa.me/?text=${text}`;
                window.open(url, "_blank", "noopener");
              }}
            >
              <HugeiconsIcon icon={Share01Icon} /> {t("till.whatsapp")}
            </Button>
            <Button variant="ghost" size="lg" className="flex-1" onClick={onClose}>
              {t("till.newSale")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
