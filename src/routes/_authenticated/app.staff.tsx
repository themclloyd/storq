import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { supabase } from "@/integrations/supabase/client";
import { roleLabel, usePos, type Role } from "@/lib/pos";
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
      { title: "Staff — Storq" },
      { name: "description", content: "Manage staff access and PINs in Storq." },
      { property: "og:title", content: "Staff — Storq" },
      { property: "og:description", content: "Manage staff access and PINs in Storq." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Staff,
});

type StaffRow = { id: string; name: string; role: Role; store_id: string | null; active: boolean };

const roleOptions: { value: Role; label: string }[] = [
  { value: "cashier", label: "Cashier" },
  { value: "manager", label: "Manager / Approver" },
  { value: "admin", label: "Admin" },
];

function Staff() {
  const { can, stores } = usePos();
  const [edit, setEdit] = useState<Partial<StaffRow> | null>(null);
  const staff = useQuery({
    queryKey: ["staff"],
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
      <Card className="p-6 text-center text-sm text-muted-foreground shadow-none">
        Only admins can manage staff.
      </Card>
    );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Staff</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Each person unlocks this device with their own 4-digit PIN. Their PIN decides what they
            can do.
          </p>
        </div>
        <Button variant="accent" onClick={() => setEdit({ role: "cashier", active: true })}>
          <HugeiconsIcon icon={PlusSignIcon} /> Add staff
        </Button>
      </div>
      <div className="mb-4 grid gap-2 text-[13px] sm:grid-cols-3">
        <Card className="p-3 shadow-none">
          <b>Admin</b>
          <p className="text-muted-foreground">Everything: staff, stores, stock, approvals.</p>
        </Card>
        <Card className="p-3 shadow-none">
          <b>Manager / Approver</b>
          <p className="text-muted-foreground">
            Sell, approve invoices, manage stock and stock takes.
          </p>
        </Card>
        <Card className="p-3 shadow-none">
          <b>Cashier</b>
          <p className="text-muted-foreground">
            Sell, create invoices, take layby payments, count stock.
          </p>
        </Card>
      </div>
      <Card className="divide-y p-0 shadow-none">
        {staff.data?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold">
              {s.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {s.name} {!s.active && <span className="text-xs text-destructive">(inactive)</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {roleLabel[s.role]} ·{" "}
                {stores.find((x) => x.id === s.store_id)?.name ?? "All stores"}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>
              Edit
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
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: s.name ?? "",
    role: s.role ?? "cashier",
    store: s.store_id ?? "all",
    pin: "",
    active: s.active ?? true,
  });
  async function save() {
    const nameErr = requireText(f.name, "Name", LIMITS.name);
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
      toast.success("Saved");
      qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.id ? "Edit staff" : "Add staff"}</DialogTitle>
        </DialogHeader>
        <Label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Name</span>
          <Input
            maxLength={LIMITS.name}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value.slice(0, LIMITS.name) })}
          />
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Role</span>
            <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v as Role })}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Store</span>
            <Select value={f.store} onValueChange={(v) => setF({ ...f, store: v })}>
              <SelectTrigger className="h-9 bg-card text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stores</SelectItem>
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
            {s.id ? "New PIN (leave blank to keep)" : "4-digit PIN"}
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
            Active
          </Label>
        )}
        <Button
          disabled={
            !f.name || (!s.id && f.pin.length !== 4) || (f.pin.length > 0 && f.pin.length !== 4)
          }
          onClick={save}
        >
          Save
        </Button>
      </DialogContent>
    </Dialog>
  );
}
