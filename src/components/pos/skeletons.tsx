import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatRow } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The workspace's loading vocabulary: a query in flight keeps the screen's
 * shape instead of collapsing to a line of text. Figures, columns and rows sit
 * where the data will land, so a slow read cannot pass for an empty shop and a
 * placeholder zero cannot be read as a real one.
 *
 * Use a screen-level placeholder for a whole page or panel. Inside a screen
 * that already has data, never flash one: leave the value alone and let the
 * query swap it in place.
 *
 * Screen readers still hear the loading line: every placeholder is a polite,
 * busy region with the same `common.loading` text that sighted users used to
 * read, so this is a visual upgrade, not a quieter one.
 */
function LoadingRegion({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      {/* Layout classes belong to the shape itself, not to the announcement. */}
      <div aria-hidden className={className}>
        {children}
      </div>
    </div>
  );
}

/** Bars standing in for a paragraph or a few stacked fields. */
function Bars({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/**
 * A data table before its rows arrive: the header line and one row per page
 * slot, so the list does not jump from a one-line card to a full table.
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <LoadingRegion className={className}>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b px-4 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-2.5", c === 0 ? "w-16 shrink-0" : "flex-1")} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton
                key={c}
                className={cn(
                  "h-4",
                  c === 0 ? "w-16 shrink-0" : c === columns - 1 ? "w-10 shrink-0" : "flex-1",
                )}
              />
            ))}
          </div>
        ))}
      </Card>
    </LoadingRegion>
  );
}

/** Page-level list of cards (transfers, receipts and other one-row-per-card lists). */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <LoadingRegion className={className ?? "space-y-2"}>
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40 max-w-[45%]" />
              <Skeleton className="h-3 w-full max-w-sm" />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </Card>
      ))}
    </LoadingRegion>
  );
}

/** Compact line items inside a panel that is already on screen (devices, reorder list). */
export function RowsSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <LoadingRegion className={cn("space-y-2.5 py-1", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-4 w-12 shrink-0" />
        </div>
      ))}
    </LoadingRegion>
  );
}

/** The KPI row before the aggregate answers, in the same `StatRow` grid. */
export function StatSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <LoadingRegion className={className}>
      <StatRow>
        {Array.from({ length: count }, (_, i) => (
          <Card key={i} className="p-3.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-2 h-7 w-28" />
          </Card>
        ))}
      </StatRow>
    </LoadingRegion>
  );
}

/** The register's catalogue grid: two flat tiles per row, at the tile height. */
export function TileSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <LoadingRegion className={cn("grid grid-cols-2 gap-2 sm:gap-2.5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[112px] w-full rounded-xl" />
      ))}
    </LoadingRegion>
  );
}

/** One panel of content, for a form or a detail card that has not loaded yet. */
export function PanelSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <LoadingRegion>
      <Card className={cn("space-y-3 p-4", className)}>
        <Skeleton className="h-4 w-1/3" />
        <Bars lines={lines} />
      </Card>
    </LoadingRegion>
  );
}

/**
 * The workspace before its first read: the rail, a page header, its tab row and
 * the blocks the screen is about to fill.
 *
 * The installed app waits here while SQLite restores its snapshot, and a slow
 * first query waits here too, so the till never opens on a blank window or a
 * centred line of text that could be mistaken for an empty shop.
 */
export function WorkspaceSkeleton({ tiles = 6 }: { tiles?: number }) {
  return (
    <LoadingRegion className="storq-workspace flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-center border-r border-border/70 bg-rail px-2 pt-3 pb-3 md:flex">
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="mt-1.5 size-11 rounded-xl" />
        <div className="mt-2 flex w-full flex-col items-center gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="size-11 rounded-xl" />
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Skeleton className="size-11 rounded-xl" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[1400px] space-y-3 p-4 md:px-6 md:pt-6 lg:px-11 lg:pt-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-full" />
            ))}
          </div>
          <StatRow>
            {Array.from({ length: 3 }, (_, i) => (
              <Card key={i} className="p-3.5">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="mt-2 h-7 w-28" />
              </Card>
            ))}
          </StatRow>
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
            {Array.from({ length: tiles }, (_, i) => (
              <Skeleton key={i} className="h-[112px] w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

/** A whole detail page: the header block, then its panel. */
export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <LoadingRegion className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <Card className="space-y-3 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Bars lines={6} />
      </Card>
    </LoadingRegion>
  );
}
