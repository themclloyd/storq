import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@/lib/icons";
import { supabase } from "@/integrations/supabase/client";
import { usePos, type Role } from "@/lib/pos";
import { NativeSelect, PageHeader } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";
import { LIMITS, validatePin, requireText, sanitizeText } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

type StaffRow = { id: string; name: string; role: Role; store_id: string | null; active: boolean };

const roleOptions: { value: Role; labelKey: string }[] = [
  { value: "cashier", labelKey: "staff.roleCashier" },
  { value: "manager", labelKey: "staff.roleManager" },
  { value: "admin", labelKey: "staff.roleAdmin" },
];

// Staff role is a stored code; only its display label is localized. The
// manager label gains "/ Approver" only once some store actually routes
// invoices for approval, so direct-sale teams never see that vocabulary.
const ROLE_LABEL_KEYS: Record<Role, string> = {
  cashier: "staff.roleCashier",
  manager: "staff.roleManager",
  admin: "staff.roleAdmin",
};
const roleLabelKey = (role: Role, approval: boolean) =>
  role === "manager" && approval ? "staff.roleManagerApproval" : ROLE_LABEL_KEYS[role];
const descKey = (base: string, approval: boolean) =>
  approval ? `staff.${base}Approval` : `staff.${base}`;

function Staff() {
  const { can, stores, autoLockMinutes, setAutoLockMinutes } = usePos();
  const { t } = useI18n();
  const approval = stores.some((x) => x.store_type === "approval");
  const [edit, setEdit] = useState<Partial<StaffRow> | null>(null);
  const staff = useQuery({
    queryKey: ["staff"],
    // Roster changes only through this screen, which wipes the cache on save;
    // a long staleTime keeps it resident instead of re-pulling on every mount.
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("id,name,role,store_id,active")
        .order("created_at");
      if (error) throw error;
      return data as StaffRow[];
    },
  });
  if (!can("admin"))
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">{t("staff.onlyAdmins")}</Card>
    );
  return (
    <>
      <PageHeader
        breadcrumb={`${t("nav.settings")} / ${t("nav.staff")}`}
        title={t("staff.title")}
        sub={t("staff.sub")}
        actions={
          <Button onClick={() => setEdit({ role: "cashier", active: true })}>
            <HugeiconsIcon icon={PlusSignIcon} /> {t("staff.addBtn")}
          </Button>
        }
      />
      <div className="mb-4 grid gap-2 text-[13px] sm:grid-cols-3">
        <Card className="p-4">
          <div className="font-medium">{t("staff.roleAdmin")}</div>
          <p className="mt-0.5 text-muted-foreground">{t(descKey("roleAdminDesc", approval))}</p>
        </Card>
        <Card className="p-4">
          <div className="font-medium">
            {t(approval ? "staff.roleManagerApproval" : "staff.roleManager")}
          </div>
          <p className="mt-0.5 text-muted-foreground">{t(descKey("roleManagerDesc", approval))}</p>
        </Card>
        <Card className="p-4">
          <div className="font-medium">{t("staff.roleCashier")}</div>
          <p className="mt-0.5 text-muted-foreground">{t(descKey("roleCashierDesc", approval))}</p>
        </Card>
      </div>
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
        {staff.data?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
            <span className="font-display grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
              {s.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {s.name}{" "}
                {!s.active && (
                  <span className="text-xs text-destructive">{t("staff.inactive")}</span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {t(roleLabelKey(s.role, approval))} ·{" "}
                {stores.find((x) => x.id === s.store_id)?.name ?? t("sales.allStores")}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>
              {t("common.edit")}
            </Button>
          </div>
        ))}
      </Card>
      {edit && <StaffDialog s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function StaffDialog({ s, onClose }: { s: Partial<StaffRow>; onClose: () => void }) {
  const { rpc, stores } = usePos();
  const { t } = useI18n();
  const approval = stores.some((x) => x.store_type === "approval");
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: s.name ?? "",
    role: s.role ?? "cashier",
    store: s.store_id ?? "all",
    pin: "",
    active: s.active ?? true,
  });
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
        p_id: s.id ?? null,
        p_name: sanitizeText(f.name, LIMITS.name),
        p_role: f.role,
        p_pin: f.pin || null,
        p_store: f.store === "all" ? null : f.store,
        p_active: f.active,
      });
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["staff-names"] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{s.id ? t("staff.editTitle") : t("staff.addBtn")}</DialogTitle>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">{t("common.name")}</span>
          <Input
            maxLength={LIMITS.name}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value.slice(0, LIMITS.name) })}
          />
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("staff.roleLabel")}
            </span>
            <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v as Role })}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(roleLabelKey(o.value, approval))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        </div>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {s.id ? t("staff.newPin") : t("staff.pinLabel")}
          </span>
          <Input
            inputMode="numeric"
            maxLength={4}
            value={f.pin}
            onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })}
          />
        </Label>
        {s.id && (
          <Label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={f.active}
              onCheckedChange={(v) => setF({ ...f, active: v === true })}
            />
            {t("staff.active")}
          </Label>
        )}
        <Button
          disabled={
            !f.name || (!s.id && f.pin.length !== 4) || (f.pin.length > 0 && f.pin.length !== 4)
          }
          onClick={save}
        >
          {t("common.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
