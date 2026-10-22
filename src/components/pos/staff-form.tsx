import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ShieldCheckIcon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import type { StaffDraft } from "@/lib/staff";
import {
  AREAS,
  AREA_DESC_KEYS,
  AREA_GRANTS,
  AREA_LABEL_KEYS,
  areaAccess,
  expandPermissions,
  toPermissions,
  type Area,
  type Permission,
} from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import { LIMITS, requireText, sanitizeText, validatePin } from "@/lib/validate";
import { PageHeader } from "@/components/pos/bits";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * One person's screen, used by both `/app/staff/new` and `/app/staff/$id`.
 *
 * The owner is not editable: they are the business. Everybody else is edited
 * as a pair of boxes per area — view and change — because that is what the
 * database enforces. A change grant always includes its view grant, so the view
 * box reads on and locked whenever change is ticked, and unticking change
 * leaves the view box on: losing the ability to act should not also blind them.
 */
export function StaffForm({ person }: { person?: Partial<StaffDraft> }) {
  const { can, staff: me, rpc, stores } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const owner = !!person?.is_owner;
  const self = !!person?.id && person.id === me?.id;
  const [f, setF] = useState(() => ({
    name: person?.name ?? "",
    store: person?.store_id ?? "all",
    perms: owner ? [] : toPermissions(person?.permissions),
    pin: "",
    active: person?.active ?? true,
  }));

  if (!can("staff"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("staff.onlyAdmins")}</Card>
    );

  const access = { owner: !!me?.owner, permissions: me?.permissions ?? [] };
  // An editor may hand out what they hold themselves; the server compares the
  // same expanded lists, so a stock manager may also grant the view of stock.
  const mine = new Set<Permission>(expandPermissions(access.permissions));
  const locked = (p: Permission) => !!me && !me.owner && !mine.has(p);
  const needPin = !person?.id;
  const pinBad = f.pin.length > 0 && validatePin(f.pin) !== null;
  const blocked =
    !f.name ||
    (!owner && f.perms.length === 0) ||
    (needPin && f.pin.length < LIMITS.pinMin) ||
    pinBad;

  function setBox(area: Area, box: "view" | "change", on: boolean) {
    const g = AREA_GRANTS[area];
    setF((prev) => {
      const rest = prev.perms.filter((p) => p !== g.view && p !== g.change);
      if (box === "change") {
        // Turning change off keeps the read box on; the owner can untick it.
        return { ...prev, perms: [...rest, on ? g.change : g.view] };
      }
      // View is implied while change is on, so there is nothing to store.
      if (prev.perms.includes(g.change)) return prev;
      return { ...prev, perms: on ? [...rest, g.view] : rest };
    });
  }

  async function save() {
    const nameErr = requireText(f.name, t("common.name"), LIMITS.name);
    if (nameErr) {
      toast.error(nameErr);
      return;
    }
    if (f.pin) {
      const pinErr = validatePin(f.pin);
      if (pinErr) {
        toast.error(pinErr);
        return;
      }
    }
    try {
      await rpc("save_staff", {
        p_id: person?.id ?? null,
        p_name: sanitizeText(f.name, LIMITS.name),
        p_permissions: owner ? [...AREAS.map((a) => AREA_GRANTS[a].change)] : f.perms,
        p_pin: f.pin || null,
        p_store: f.store === "all" ? null : f.store,
        p_active: owner ? true : f.active,
      });
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["staff-names"] });
      nav({ to: "/app/staff" });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        back={{ to: "/app/staff", label: t("staff.title") }}
        title={person?.id ? (person.name ?? t("staff.editTitle")) : t("staff.addBtn")}
        sub={owner ? t("staff.ownerDesc") : t("staff.sub")}
      />
      <div className="grid max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card className="space-y-3 p-5">
          <div>
            <h3 className="font-display text-base font-medium">{t("staff.detailsTitle")}</h3>
            <p className="text-[13px] text-muted-foreground">{t("staff.detailsDesc")}</p>
          </div>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("common.name")}
            </span>
            <Input
              maxLength={LIMITS.name}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value.slice(0, LIMITS.name) })}
            />
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("staff.storeLabel")}
            </span>
            <Select value={f.store} onValueChange={(v) => setF({ ...f, store: v })}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("sales.allStores")}</SelectItem>
                {stores.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {person?.id ? t("staff.newPin") : t("staff.pinLabel")}
            </span>
            <PasswordInput
              inputMode="numeric"
              maxLength={LIMITS.pinMax}
              value={f.pin}
              onChange={(e) =>
                setF({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, LIMITS.pinMax) })
              }
            />
          </Label>
          {person?.id && !owner && (
            <Label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={f.active}
                disabled={self}
                onCheckedChange={(v) => setF({ ...f, active: v === true })}
              />
              {t("staff.active")}
            </Label>
          )}
          <Button className="w-full" disabled={blocked} onClick={save}>
            {t("common.save")}
          </Button>
        </Card>

        <Card className="p-5">
          <h3 className="font-display text-base font-medium">{t("staff.accessTitle")}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t("staff.accessHint")}</p>
          {owner ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-[13px]">
              <HugeiconsIcon
                icon={ShieldCheckIcon}
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span className="text-muted-foreground">{t("staff.ownerDesc")}</span>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] items-center gap-2 border-b pb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span />
                <span className="text-center">{t("staff.viewColumn")}</span>
                <span className="text-center">{t("staff.changeColumn")}</span>
              </div>
              {AREAS.map((area) => {
                const st = areaAccess({ owner, permissions: f.perms }, area);
                const g = AREA_GRANTS[area];
                // The owner account and your own staff box are fixed points.
                const changeLocked = locked(g.change) || (self && area === "staff");
                const viewLocked = st.change || locked(g.view);
                return (
                  <div
                    key={area}
                    className="grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] items-center gap-2 border-b py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{t(AREA_LABEL_KEYS[area])}</div>
                      <p className="text-xs text-muted-foreground">{t(AREA_DESC_KEYS[area])}</p>
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        aria-label={`${t(AREA_LABEL_KEYS[area])} · ${t("staff.viewColumn")}`}
                        checked={st.view}
                        disabled={viewLocked}
                        onCheckedChange={(v) => setBox(area, "view", v === true)}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        aria-label={`${t(AREA_LABEL_KEYS[area])} · ${t("staff.changeColumn")}`}
                        checked={st.change}
                        disabled={changeLocked}
                        onCheckedChange={(v) => setBox(area, "change", v === true)}
                      />
                    </div>
                  </div>
                );
              })}
              {f.perms.length === 0 && (
                <p className="mt-3 text-xs text-destructive">{t("staff.pickOne")}</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {me?.owner ? t("staff.manageIncludesView") : t("staff.cannotGrant")}
              </p>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
