import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon, Settings01Icon } from "@/lib/icons";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/desktop";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WorkspaceGroup, WorkspacePath } from "@/lib/workspace-navigation";
import { navIcons } from "@/components/pos/nav-icons";

type RailEntry = { group: WorkspaceGroup; labelKey: string; to: WorkspacePath };

const RAIL_ITEM =
  "press relative grid size-11 place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30";
const RAIL_ACTIVE = "bg-primary-soft text-primary-soft-foreground";
const RAIL_IDLE = "text-muted-foreground hover:bg-secondary hover:text-foreground";

/** Small count pill riding the corner of a rail glyph. */
function CountBadge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "tabular grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[9px] font-bold text-warning-foreground",
        className,
      )}
      aria-hidden
    >
      {value}
    </span>
  );
}

/**
 * The desktop icon rail: brand, the location switcher, one glyph per area, then
 * the account tools. Sub-pages of an area live in the page's own tab row.
 */
export function WorkspaceRail({
  items,
  activeGroup,
  pendingCount,
  settingsTo,
  storeMenu,
  userMenu,
}: {
  items: RailEntry[];
  activeGroup: WorkspaceGroup | undefined;
  /** Live approvals count, badged onto the sales glyph until the queue clears. */
  pendingCount: number;
  settingsTo: string | undefined;
  /** Location control (initials + store menu) under the brand. */
  storeMenu: ReactNode;
  /** Account control (avatar + menu) docked at the foot of the rail. */
  userMenu: ReactNode;
}) {
  const { t } = useI18n();
  const badge = pendingCount >= 100 ? "99+" : String(pendingCount);
  return (
    <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-center border-r border-border/70 bg-rail px-2 pt-3 pb-3 md:flex">
      <Link
        to="/app/dashboard"
        aria-label="Storq"
        className="press grid size-11 shrink-0 place-items-center rounded-xl transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
      >
        <img src="/logo.svg" alt="" className="size-8 rounded-[9px]" />
      </Link>
      <div className="mt-1.5">{storeMenu}</div>
      <nav aria-label="Storq" className="mt-1 flex w-full flex-col items-center gap-1">
        {items.map((entry) => {
          const active = entry.group === activeGroup;
          return (
            <Link
              key={entry.group}
              to={entry.to}
              title={t(entry.labelKey)}
              aria-label={t(entry.labelKey)}
              aria-current={active ? "page" : undefined}
              className={cn(RAIL_ITEM, active ? RAIL_ACTIVE : RAIL_IDLE)}
            >
              <HugeiconsIcon icon={navIcons[entry.group]} className="size-5" />
              {entry.group === "sales" && pendingCount > 0 && (
                <CountBadge value={badge} className="absolute top-0.5 right-0.5" />
              )}
            </Link>
          );
        })}
      </nav>
      {/* Tools sit at the foot so the icons above stay a short, stable list. */}
      <div className="mt-auto flex w-full flex-col items-center gap-1">
        {settingsTo && (
          <Link
            to={settingsTo}
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
            aria-current={activeGroup === "settings" ? "page" : undefined}
            className={cn(RAIL_ITEM, activeGroup === "settings" ? RAIL_ACTIVE : RAIL_IDLE)}
          >
            <HugeiconsIcon icon={Settings01Icon} className="size-5" />
          </Link>
        )}
        <a
          href={DESKTOP_DOWNLOAD_URL}
          download
          target="_blank"
          rel="noopener noreferrer"
          title={t("nav.downloadDesktop")}
          aria-label={t("nav.downloadDesktop")}
          className={cn(RAIL_ITEM, RAIL_IDLE)}
        >
          <HugeiconsIcon icon={Download01Icon} className="size-5" />
        </a>
        <div className="mt-1">{userMenu}</div>
      </div>
    </aside>
  );
}
