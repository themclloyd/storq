import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Workspace-styled confirmation for destructive actions. The caller owns `open`
 * and closes it once the mutation settles, so a failed attempt leaves the
 * prompt on screen and can be retried in place.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  children,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  // Callers often build the sentence from the row they are about to act on, so
  // "no description" arrives as undefined rather than a missing prop.
  description?: string | undefined;
  confirmLabel: string;
  busy?: boolean;
  /** Extra context, such as the numbers the action is about to apply. */
  children?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={busy}
            onClick={(e) => {
              // Keep the prompt open while the RPC runs; callers close it after
              // success instead of letting the action dismiss it straight away.
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? t("common.confirming") : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
