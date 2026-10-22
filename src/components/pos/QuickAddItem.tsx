import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { invalidateKeys } from "@/lib/cache-invalidation";
import { type Product } from "@/lib/products";
import { normalizeCode } from "@/lib/item-codes";
import {
  LIMITS,
  firstError,
  requireText,
  sanitizeText,
  validateAmount,
  validateSku,
} from "@/lib/validate";
import { useI18n } from "@/lib/i18n";
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

/**
 * A scanned code the catalog does not know yet (a new product, or a label
 * printed on another device). Admins and managers can register the item on the
 * spot — the code is already filled in, so the till never waits on the
 * Inventory screen — and it drops straight into the basket.
 */
export function QuickAddItem({
  code,
  onCreated,
  onClose,
}: {
  code: string;
  onCreated: (p: Product) => void;
  onClose: () => void;
}) {
  const { rpc, can, store } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const itemCode = normalizeCode(code);

  async function save() {
    const err = firstError(
      requireText(name, t("common.name"), LIMITS.productName),
      validateSku(itemCode),
      validateAmount(price, {
        label: t("inv.sellingPrice"),
        required: true,
        min: 0,
        max: 1_000_000_000,
      }),
    );
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const pid = (await rpc("save_product", {
        p_store: store?.id ?? null,
        p_id: null,
        p_name: sanitizeText(name, LIMITS.productName),
        p_sku: itemCode || null,
        p_category: null,
        p_price: Number(price || 0),
        p_cost: 0,
        p_active: true,
        // Every save_product call sends the full argument set: the RPC has a
        // defaulted tail, so a short call would not resolve to one function.
        p_reorder_point: null,
      })) as string | null;
      invalidateKeys(qc, [["products"], ["stock"], ["collections"], ["dash-alerts"]]);
      const p: Product = {
        id: pid ?? "",
        name: sanitizeText(name, LIMITS.productName),
        sku: itemCode || null,
        category: null,
        price: Number(price || 0),
        cost: 0,
        active: true,
        reorder_point: null,
      };
      toast.success(t("till.itemCreated", { name: p.name }));
      if (p.id) onCreated(p);
      else onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!can("stock")) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("till.quickAddTitle")}</DialogTitle>
          <DialogDescription>{t("till.quickAddSub", { code: itemCode || "—" })}</DialogDescription>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("common.name")}</span>
          <Input
            autoFocus
            maxLength={LIMITS.productName}
            placeholder={t("till.quickAddName")}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, LIMITS.productName))}
            onKeyDown={(e) => e.key === "Enter" && !busy && save()}
          />
        </Label>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("inv.sellingPrice")}
          </span>
          <Input
            inputMode="decimal"
            maxLength={14}
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && !busy && save()}
          />
        </Label>
        <p className="text-xs text-muted-foreground">{t("till.quickAddStockNote")}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button className="flex-1" disabled={busy || !name || !price} onClick={save}>
            <HugeiconsIcon icon={PlusSignIcon} />
            {busy ? t("common.saving") : t("till.quickAddBtn")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
