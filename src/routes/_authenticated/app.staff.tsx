import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { supabase } from "@/integrations/supabase/client";
import { roleLabel, usePos, type Role } from "@/lib/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, Field, NativeSelect, PageHeader } from "@/components/pos/bits";

export const Route = createFileRoute("/_authenticated/app/staff")({ component: Staff });

type StaffRow = { id: string; name: string; role: Role; store_id: string | null; active: boolean };

function Staff() {
  const { can, stores } = usePos();
  const [edit, setEdit] = useState<Partial<StaffRow> | null>(null);
  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff").select("id,name,role,store_id,active").order("created_at");
      if (error) throw error;
      return data as StaffRow[];
    },
  });
  if (!can("admin")) return <Empty>Only admins can manage staff.</Empty>;
  return (
    <>
      <PageHeader title="Staff" sub="Each person unlocks this device with their own 4-digit PIN. Their PIN decides what they can do."
        actions={<Button variant="accent" onClick={() => setEdit({ role: "cashier", active: true })}><HugeiconsIcon icon={PlusSignIcon} /> Add staff</Button>} />
      <div className="mb-6 grid gap-3 text-sm sm:grid-cols-3">
        <div className="pos-card p-4"><b>Admin</b><p className="text-muted-foreground">Everything: staff, stores, stock, approvals.</p></div>
        <div className="pos-card p-4"><b>Manager / Approver</b><p className="text-muted-foreground">Sell, approve invoices, manage stock and stock takes.</p></div>
        <div className="pos-card p-4"><b>Cashier</b><p className="text-muted-foreground">Sell, create invoices, take layby payments, count stock.</p></div>
      </div>
      <div className="pos-card divide-y">
        {staff.data?.map((s) => (
          <div key={s.id} className="flex items-center gap-4 px-5 py-3">
            <span className="grid size-9 place-items-center rounded-full bg-secondary text-sm font-bold">{s.name.slice(0, 1).toUpperCase()}</span>
            <div className="flex-1">
              <div className="font-semibold">{s.name} {!s.active && <span className="text-xs text-destructive">(inactive)</span>}</div>
              <div className="text-xs text-muted-foreground">{roleLabel[s.role]} · {stores.find((x) => x.id === s.store_id)?.name ?? "All stores"}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit(s)}>Edit</Button>
          </div>
        ))}
      </div>
      {edit && <StaffDialog s={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function StaffDialog({ s, onClose }: { s: Partial<StaffRow>; onClose: () => void }) {
  const { rpc, stores } = usePos();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: s.name ?? "", role: s.role ?? "cashier", store: s.store_id ?? "", pin: "", active: s.active ?? true });
  async function save() {
    try {
      await rpc("save_staff", { p_id: s.id ?? null, p_name: f.name, p_role: f.role, p_pin: f.pin || null, p_store: f.store || null, p_active: f.active });
      toast.success("Saved"); qc.invalidateQueries(); onClose();
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{s.id ? "Edit staff" : "Add staff"}</DialogTitle></DialogHeader>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <NativeSelect value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="cashier">Cashier</option><option value="manager">Manager / Approver</option><option value="admin">Admin</option>
            </NativeSelect>
          </Field>
          <Field label="Store">
            <NativeSelect value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })}>
              <option value="">All stores</option>
              {stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label={s.id ? "New PIN (leave blank to keep)" : "4-digit PIN"}>
          <Input inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} />
        </Field>
        {s.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
        <Button size="lg" disabled={!f.name || (!s.id && f.pin.length !== 4) || (f.pin.length > 0 && f.pin.length !== 4)} onClick={save}>Save</Button>
      </DialogContent>
    </Dialog>
  );
}
