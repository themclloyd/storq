import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  menuNavigationGroups,
  pageLabelKey,
  visibleWorkspacePages,
  workspacePageAt,
  type WorkspaceGroup,
} from "@/lib/workspace-navigation";
import type { Store } from "@/lib/pos";
import type { Access } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";

const GROUP_LABEL_KEY: Record<WorkspaceGroup, string> = {
  dashboard: "nav.dashboard",
  register: "nav.pos",
  sales: "nav.sales",
  inventory: "nav.inventory",
  finance: "nav.reports",
  settings: "nav.settings",
};

export function WorkspaceTabs({
  path,
  access,
  storeType,
  pendingCount,
}: {
  path: string;
  access: Access | null | undefined;
  storeType?: Store["store_type"] | undefined;
  /** Live pending-approval count, badged onto the Approvals tab until cleared. */
  pendingCount?: number;
}) {
  const { t } = useI18n();
  const current = workspacePageAt(path);
  const group = current?.group ?? "sales";
  const pages = visibleWorkspacePages(access, storeType).filter(
    (page) => page.group === current?.group,
  );
  // Some groups move their sibling pages into the page's own actions menu; the
  // shell tab row would only repeat the menu there.
  if (pages.length < 2 || menuNavigationGroups.includes(group)) return null;
  // Segmented-control look (spec §3) rendered over the existing group URLs, so
  // the switcher replaces the old tab row without introducing new routes.
  return (
    <nav
      aria-label={t(GROUP_LABEL_KEY[group])}
      className="mb-4 inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-muted p-1"
    >
      {pages.map((page) => {
        const active = current?.to === page.to;
        return (
          <Link
            key={page.to}
            to={page.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
              active
                ? "bg-card text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(pageLabelKey(page, storeType))}
            {page.approvalOnly && pendingCount ? (
              <span
                className="tabular ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-warning-soft px-1.5 py-0.5 text-[11px] font-bold text-warning-foreground"
                aria-hidden
              >
                {pendingCount >= 100 ? "99+" : pendingCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
