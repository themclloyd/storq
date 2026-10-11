import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Download01Icon, QrCode01Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  codeSlug,
  qrPath,
  qrSide,
  qrPngDataUrl,
  qrSvgString,
  saveFile,
  type QrMatrix,
} from "@/lib/qr";
import { useQrMatrix } from "@/components/pos/use-qr";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The code image itself. Black on white is deliberate: a QR is document
 * artwork, not UI chrome, and a themed light-on-dark tile scans poorly and
 * would not match the printed label.
 */
export function QrImage({
  matrix,
  className,
  label,
}: {
  matrix: QrMatrix;
  className?: string;
  label: string;
}) {
  const side = qrSide(matrix, 1);
  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("block size-full", className)}
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrPath(matrix)} fill="#09090b" />
    </svg>
  );
}

export type CodeItem = { name: string; code: string; price?: number | string | null };

/**
 * Code + QR for one item, with the export buttons. Shared by the item dialog
 * preview and the inventory "Code" row action so both show the identical image.
 */
export function ItemCodeCard({
  item,
  className,
  compact,
}: {
  item: CodeItem;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const matrix = useQrMatrix(item.code);
  const slug = codeSlug(item.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.code);
      toast.success(t("code.copied"));
    } catch {
      toast.error(t("code.copyFailed"));
    }
  }

  async function savePng() {
    try {
      saveFile(`storq-${slug}.png`, await qrPngDataUrl(item.code, 640));
    } catch {
      toast.error(t("code.renderFailed"));
    }
  }

  function saveSvg() {
    if (!matrix) return;
    saveFile(`storq-${slug}.svg`, new Blob([qrSvgString(matrix)], { type: "image/svg" }));
  }

  if (!item.code.trim())
    return <p className={cn("text-xs text-muted-foreground", className)}>{t("code.noneYet")}</p>;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "shrink-0 overflow-hidden rounded-xl border border-input bg-white p-1.5",
          compact ? "size-20" : "size-28",
        )}
      >
        {matrix ? <QrImage matrix={matrix} label={t("code.aria", { code: item.code })} /> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="truncate text-sm font-medium">{item.name}</div>
        <button
          type="button"
          onClick={copy}
          title={t("code.copyTitle")}
          className="tabular inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs font-semibold hover:bg-muted/70"
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5 shrink-0" />
          <span className="truncate">{item.code}</span>
        </button>
        {!compact && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={!matrix} onClick={savePng}>
              <HugeiconsIcon icon={Download01Icon} /> PNG
            </Button>
            <Button size="sm" variant="outline" disabled={!matrix} onClick={saveSvg}>
              <HugeiconsIcon icon={Download01Icon} /> SVG
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full code dialog from the inventory table: preview, single-code exports and a
 * printed label sheet for the shelf/stock. Copies default to a usable strip.
 */
export function ItemQrDialog({
  item,
  onClose,
  onPrintLabels,
}: {
  item: CodeItem;
  onClose: () => void;
  onPrintLabels: (copies: number) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [copies, setCopies] = useState("12");
  const n = Math.min(240, Math.max(1, Math.trunc(Number(copies) || 1)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("code.title")}</DialogTitle>
          <DialogDescription>{t("code.sub")}</DialogDescription>
        </DialogHeader>
        <ItemCodeCard item={item} />
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("code.copiesLabel")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              className="max-w-24"
              inputMode="numeric"
              maxLength={3}
              value={copies}
              onChange={(e) => setCopies(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <Button className="flex-1" onClick={() => onPrintLabels(n)}>
              <HugeiconsIcon icon={QrCode01Icon} /> {t("code.printLabels")}
            </Button>
          </div>
        </Label>
      </DialogContent>
    </Dialog>
  );
}
