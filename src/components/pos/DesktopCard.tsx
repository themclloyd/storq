/**
 * "This computer": what the installed Windows till knows about itself.
 *
 * The website offers the installer from the rail. The installed app has nowhere
 * to download to, so the same slot in Business settings names the build the
 * operator is running, shows where its durable local copy lives, and lets them
 * pull a newer signed release on demand instead of waiting for the startup
 * check. Nothing here decides anything: an update is still verified against the
 * minisign key baked into the shell before it installs.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import {
  appInfo,
  checkForUpdate,
  deviceStats,
  DESKTOP_DOWNLOAD_URL,
  installUpdate,
  isDesktop,
  openExternal,
  type AppInfo,
  type DeviceStats,
  type UpdateInfo,
} from "@/lib/desktop";

/** File size for the local copy, in the units an operator reads at a glance. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function DesktopCard() {
  const { t } = useI18n();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
    let live = true;
    void appInfo().then((found) => {
      if (live) setInfo(found);
    });
    // The mirror is what makes an offline till safe, so its size and contents
    // are worth stating: "nothing cached" is a fact, not a guess.
    void deviceStats().then((found) => {
      if (live) setStats(found);
    });
    return () => {
      live = false;
    };
  }, []);

  // A browser tab is not an install: the card belongs to the packaged app only.
  if (!isDesktop()) return null;

  async function check() {
    setChecking(true);
    // `checkForUpdate` answers null for both "already newest" and "could not
    // reach the feed", so the connection decides which sentence is honest.
    const found = await checkForUpdate();
    setChecking(false);
    if (found) {
      setUpdate(found);
      return;
    }
    if (navigator.onLine) toast.success(t("desktop.aboutUpToDate"));
    else toast.error(t("desktop.aboutCheckFailed"));
  }

  async function install() {
    setBusy(true);
    try {
      // A successful install restarts the app, so nothing after this await runs.
      await installUpdate();
    } catch {
      setBusy(false);
      toast.error(t("desktop.updateFailed"));
    }
  }

  return (
    <Card className="space-y-2 p-4">
      <div className="space-y-0.5">
        <h2 className="text-[13px] font-semibold">{t("desktop.aboutTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("desktop.aboutDesc")}</p>
      </div>
      <dl className="divide-y text-[13px]">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="text-muted-foreground">{t("desktop.aboutVersion")}</dt>
          <dd className="tabular font-medium">{info ? `${info.name} ${info.version}` : "…"}</dd>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-2 py-2">
          <dt className="shrink-0 text-muted-foreground">{t("desktop.aboutData")}</dt>
          <dd
            className="max-w-full flex-1 truncate text-right font-mono text-[11px]"
            title={stats?.path ?? info?.dataDir ?? undefined}
          >
            {stats?.path ?? info?.dataDir ?? "…"}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="text-muted-foreground">{t("desktop.aboutCache")}</dt>
          <dd className="tabular font-medium">{stats ? stats.cacheRows : "…"}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="text-muted-foreground">{t("desktop.aboutQueued")}</dt>
          <dd className="tabular font-medium">{stats ? stats.queuedSales : "…"}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <dt className="text-muted-foreground">{t("desktop.aboutSize")}</dt>
          <dd className="tabular font-medium">{stats ? formatBytes(stats.bytes) : "…"}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("desktop.aboutDataHint")}</p>
      {/* A copy opened straight from the download folder is portable by nature:
          Windows has no shortcut for it, and the updater would install a second
          copy elsewhere. Saying so, with the installer one click away, answers
          the "it did not install" question at the till. */}
      {info && !info.installed && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs text-warning-foreground">{t("desktop.aboutPortable")}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openExternal(DESKTOP_DOWNLOAD_URL)}
          >
            <HugeiconsIcon icon={Download01Icon} />
            {t("desktop.aboutPortableAction")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {update ? (
          <>
            <span className="text-[13px] font-medium">
              {t("desktop.updateReady", { version: update.version })}
            </span>
            <Button size="sm" disabled={busy} onClick={() => void install()}>
              {busy ? t("desktop.updateInstalling") : t("desktop.updateInstall")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={checking} onClick={() => void check()}>
            <HugeiconsIcon icon={Download01Icon} />
            {checking ? t("desktop.aboutChecking") : t("desktop.aboutCheck")}
          </Button>
        )}
      </div>
    </Card>
  );
}
