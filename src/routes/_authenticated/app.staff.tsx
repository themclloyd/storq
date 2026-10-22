import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, PlusSignIcon, ShieldCheckIcon } from "@/lib/icons";
import { staffQuery, type StaffRow } from "@/lib/staff";
import { usePos } from "@/lib/pos";
import {
  AREAS,
  AREA_LABEL_KEYS,
  areaAccess,
  expandPermissions,
  toPermissions,
} from "@/lib/permissions";
import { NativeSelect, PageHeader } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/app/staff")({
  head: () => ({
    meta: [
      { title: "Staff | Storq" },
      { name: "description", content: "Manage staff access and PINs in Storq." },
      { property: "og:title", content: "Staff | Storq" },
      { property: "og:description", content: "Manage staff access and PINs in Storq." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Staff,
});

export type { StaffRow };

function Staff() {
  const { can, staff: me, stores, autoLockMinutes, setAutoLockMinutes } = usePos();
  const { t } = useI18n();
  const manage = can("staff");
  const roster = useQuery(staffQuery);
  if (!can("staff", "view_staff"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("staff.onlyAdmins")}</Card>
    );

  // Which people this session may open: nobody above its own ceiling, and
  // never the owner account, which edits itself nowhere.
  const mine = new Set(expandPermissions(me?.permissions ?? []));
  const openable = (s: StaffRow) =>
    manage &&
    !s.is_owner &&
    (!!me?.owner || toPermissions(s.permissions).every((p) => mine.has(p)));

  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("nav.staff")}`}
        title={t("staff.title")}
        sub={t("staff.sub")}
        actions={
          manage ? (
            <Link to="/app/staff/new">
              <Button>
                <HugeiconsIcon icon={PlusSignIcon} /> {t("staff.addBtn")}
              </Button>
            </Link>
          ) : undefined
        }
      />
      <Card className="mb-4 p-4 text-[13px]">
        <div className="font-medium">{t("staff.howTitle")}</div>
        <p className="mt-0.5 text-muted-foreground">{t("staff.howDesc")}</p>
      </Card>
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-[13px]">
          <div className="font-medium">{t("staff.autoLockTitle")}</div>
          <p className="mt-0.5 text-muted-foreground">{t("staff.autoLockDesc")}</p>
        </div>
        <NativeSelect
          className="w-40"
          value={String(autoLockMinutes)}
          onChange={(v) => setAutoLockMinutes(Number(v))}
          options={[
            { value: "2", label: t("staff.afterMin", { n: 2 }) },
            { value: "5", label: t("staff.afterMin", { n: 5 }) },
            { value: "10", label: t("staff.afterMin", { n: 10 }) },
            { value: "15", label: t("staff.afterMin", { n: 15 }) },
            { value: "0", label: t("staff.never") },
          ]}
        />
      </Card>
      <Card className="divide-y p-0">
        {roster.data?.map((s) => {
          const access = { owner: s.is_owner, permissions: s.permissions };
          const shown = AREAS.map((area) => ({ area, ...areaAccess(access, area) })).filter(
            (x) => x.view,
          );
          const row = (
            <>
              <span className="font-display grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="truncate">{s.name}</span>
                  {s.is_owner && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      <HugeiconsIcon icon={ShieldCheckIcon} className="size-3" />
                      {t("staff.owner")}
                    </span>
                  )}
                  {!s.active && (
                    <span className="text-xs text-destructive">{t("staff.inactive")}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {s.is_owner ? (
                    <span className="text-xs text-muted-foreground">{t("staff.fullAccess")}</span>
                  ) : shown.length ? (
                    shown.map(({ area, change }) => (
                      <span
                        key={area}
                        className={
                          change
                            ? "rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
                            : "rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        }
                      >
                        {t(AREA_LABEL_KEYS[area])}
                        {!change && ` · ${t("staff.viewOnly")}`}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("staff.noAccessYet")}</span>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {stores.find((x) => x.id === s.store_id)?.name ?? t("sales.allStores")}
                </div>
              </div>
              {openable(s) && (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={16}
                  className="mt-1 shrink-0 text-muted-foreground"
                />
              )}
            </>
          );
          return openable(s) ? (
            <Link
              key={s.id}
              to="/app/staff/$id"
              params={{ id: s.id }}
              className="flex items-start gap-3 px-4 py-3 text-[13px] transition-colors hover:bg-muted/50"
            >
              {row}
            </Link>
          ) : (
            <div key={s.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
              {row}
            </div>
          );
        })}
      </Card>
      {manage && <p className="mt-3 text-xs text-muted-foreground">{t("staff.openHint")}</p>}
    </>
  );
}
