import { Link } from "@tanstack/react-router";
import { fmtDate } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";
import { useOpenDrawer } from "@/lib/shifts";
import { cn } from "@/lib/utils";

/**
 * Drawer state in the shell header.
 *
 * The server opens the drawer by itself on the first sale of a PIN session, so
 * the one way it still gets forgotten is by never saying so. This chip sits on
 * every workspace screen, closed and "open since yesterday" both read as a
 * warning, and doubles as the link to the count-and-close screen.
 */
export function DrawerChip({
  storeId,
  compact = false,
}: {
  storeId?: string | null | undefined;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { data: drawer, isPending, isError } = useOpenDrawer(storeId);
  // Nothing to report until the store is known; an empty chip would shift the
  // header around on every load.
  if (isPending) return null;
  const stale = !!drawer && new Date(drawer.opened_at).toDateString() !== new Date().toDateString();
  // Offline the state is unknown: say nothing rather than claim the drawer is shut.
  const unknown = isError && !drawer;
  const needsAttention = !unknown && (!drawer || stale);
  const label = unknown
    ? t("drawer.short")
    : !drawer
      ? t("drawer.closed")
      : stale
        ? t("drawer.stale")
        : t("drawer.open");
  return (
    <Link
      to="/app/shifts"
      title={drawer ? `${label} · ${fmtDate(drawer.opened_at)}` : label}
      aria-label={`${t("drawer.status")}: ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
        unknown
          ? "text-muted-foreground"
          : needsAttention
            ? "text-warning-foreground"
            : "text-success",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          unknown ? "bg-muted-foreground" : needsAttention ? "bg-warning" : "bg-success",
        )}
      />
      {compact ? t("drawer.short") : label}
    </Link>
  );
}
