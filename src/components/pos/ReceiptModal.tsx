import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, PrinterIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  downloadReceipt,
  printReceipt,
  receiptHtml,
  receiptTitle,
  type MoneyFmt,
  type Receipt,
} from "@/lib/receipts";

/** On-screen thermal styling mirroring the 80mm print sheet. */
const THERMAL =
  ".thermal{font-family:'Courier New',ui-monospace,monospace;color:#111;background:#fff;width:288px;margin:0 auto;padding:16px 12px;font-size:12px;line-height:1.5;border-radius:4px}" +
  ".thermal .hd{font-size:16px;font-weight:800;text-align:center;letter-spacing:1px}" +
  ".thermal .sub,.thermal .ft,.thermal .bc{text-align:center}.thermal .sub{font-size:11px;margin-top:2px}" +
  ".thermal .ttl{text-align:center;font-weight:700;margin:6px 0 2px}" +
  ".thermal .chip{border:1px solid #111;border-radius:3px;padding:0 4px;font-size:9px;vertical-align:middle}" +
  ".thermal .dashed{border-top:1px dashed #999;margin:6px 0}" +
  ".thermal .lr{display:flex;justify-content:space-between;gap:8px}.thermal .lr.b{font-weight:800;font-size:14px}" +
  ".thermal .it{margin:3px 0}.thermal .it .nm{font-weight:600}" +
  ".thermal .ft{margin-top:8px;font-size:11px}.thermal .bc{margin-top:4px;letter-spacing:2px}";

export function ReceiptModal({
  receipt,
  money,
  onClose,
}: {
  receipt: Receipt;
  money: MoneyFmt;
  onClose: () => void;
}) {
  const doneLabel =
    receipt.status === "layby_completed"
      ? "Layby fully paid"
      : receipt.kind === "layby"
        ? "Layby opened"
        : "Sale complete";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden bg-card p-0 shadow-[var(--shadow-pop)]">
        <style>{THERMAL}</style>
        <div className="flex flex-col items-center gap-2 border-b px-5 py-5 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-success/15 text-success">
            <HugeiconsIcon icon={Tick02Icon} className="size-6" />
          </span>
          <h2 className="text-lg font-bold">{doneLabel}</h2>
          <p className="text-xs text-muted-foreground">
            {receiptTitle(receipt)} #{receipt.number} · {money(receipt.total)}
          </p>
        </div>

        <div className="max-h-[46vh] overflow-y-auto bg-secondary/30 px-5 py-5">
          <div className="thermal" dangerouslySetInnerHTML={{ __html: receiptHtml(receipt, money) }} />
        </div>

        <div className="flex items-center gap-3 border-t bg-secondary/35 px-5 py-4">
          <Button
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={() => {
              downloadReceipt(receipt, money);
              toast.success("Receipt exported.");
            }}
          >
            <HugeiconsIcon icon={Download01Icon} /> Export
          </Button>
          <Button
            size="lg"
            variant="accent"
            className="flex-1"
            onClick={() => {
              if (!printReceipt(receipt, money)) toast.error("Allow pop-ups to print the receipt.");
            }}
          >
            <HugeiconsIcon icon={PrinterIcon} /> Print
          </Button>
        </div>
        <div className="border-t px-5 py-3">
          <Button variant="ghost" size="lg" className="w-full" onClick={onClose}>
            New sale
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
