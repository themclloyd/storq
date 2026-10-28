/**
 * "A newer till is ready" banner for the installed Windows app.
 *
 * A packaged till is picked up by whoever opens the shop, so it may sit on an
 * old build for months. The shell checks the signed update feed once, a few
 * seconds after the workspace opens (never on the PIN pad or during a sale), and
 * only offers the install when there really is a newer signed build.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { checkForUpdate, installUpdate, isDesktop, type UpdateInfo } from "@/lib/desktop";

export function UpdateBanner() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
    let live = true;
    // Let the till open and the first reads settle before spending the link on
    // an update check the operator did not ask for.
    const timer = setTimeout(() => {
      void checkForUpdate().then((found) => {
        if (live && found) setInfo(found);
      });
    }, 4_000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  if (!info || dismissed) return null;

  async function install() {
    setBusy(true);
    try {
      // The app restarts itself once the signed payload is installed, so nothing
      // after this await runs in a successful install.
      await installUpdate();
    } catch {
      setBusy(false);
      toast.error(t("desktop.updateFailed"));
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 text-[13px] text-primary-soft-foreground"
    >
      <HugeiconsIcon icon={Download01Icon} className="size-4 shrink-0" />
      <span className="font-medium">{t("desktop.updateReady", { version: info.version })}</span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          {t("desktop.updateLater")}
        </button>
        <Button size="sm" disabled={busy} onClick={() => void install()}>
          {busy ? t("desktop.updateInstalling") : t("desktop.updateInstall")}
        </Button>
      </div>
    </div>
  );
}
