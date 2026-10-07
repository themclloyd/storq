import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, PageHeader, Status, fmtDate } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/stocktake")({ head: () => ({ meta: [{ title: "Stock take — Storq" }, { name: "description", content: "Count and reconcile store inventory with your staff." }, { property: "og:title", content: "Stock take — Storq" }, { property: "og:description", content: "Count and reconcile store inventory with your staff." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: StockTake });

type Take = { id: string; status: string; created_at: string; closed_at: string | null };
type LineRow = { product_id: string; expected: number; counted: number | null };

function StockTake() {
  const { store, can, rpc } = usePos();
  const qc = useQueryClient();
  const takes = useQuery({
    queryKey: ["takes", store?.id],
    enabled: !!store,
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_takes").select("id,status,created_at,closed_at").eq("store_id", store!.id).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as Take[];
    },
  });
  const open = takes.data?.find((t) => t.status === "open");

  async function start() {
    try { await rpc("start_stock_take", { p_store: store!.id }); toast.success("Stock take started"); qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <PageHeader
        title="Stock take"
        sub={open ? `Counting ${store?.name} since ${fmtDate(open.created_at)}. Each person can count on their own device.` : `Count what is physically in ${store?.name}.`}
        actions={!open && can("admin", "manager") ? <Button variant="accent" onClick={start}>Start stock take</Button> : undefined}
      />
      {open ? <Counting take={open} /> : (
        <>
          {!can("admin", "manager") && <Empty>No stock take is open. Ask a manager to start one.</Empty>}
          <div className="pos-card mt-4 divide-y">
            {takes.data?.filter((t) => t.status === "closed").map((t) => (
              <div key={t.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <Status s={t.status} /><span>Started {fmtDate(t.created_at)}</span><span className="text-muted-foreground">Closed {t.closed_at && fmtDate(t.closed_at)}</span>
              </div>
            ))}
            {!takes.data?.some((t) => t.status === "closed") && <p className="p-6 text-center text-sm text-muted-foreground">No past stock takes.</p>}
          </div>
        </>
      )}
    </>
  );
}

function Counting({ take }: { take: Take }) {
  const { can, rpc } = usePos();
  const qc = useQueryClient();
  const products = useProducts();
  const [q, setQ] = useState("");
  const [onlyLeft, setOnlyLeft] = useState(false);
  const lines = useQuery({
    queryKey: ["take-lines", take.id],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_take_lines").select("product_id,expected,counted").eq("stock_take_id", take.id);
      if (error) throw error;
      return data as LineRow[];
    },
  });
  const name = (id: string) => products.data?.find((p) => p.id === id)?.name ?? "…";
  const rows = (lines.data ?? [])
    .filter((l) => (!onlyLeft || l.counted === null) && (!q || name(l.product_id).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => name(a.product_id).localeCompare(name(b.product_id)));
  const counted = lines.data?.filter((l) => l.counted !== null).length ?? 0;

  async function save(pid: string, v: string) {
    if (v === "") return;
    try { await rpc("count_stock", { p_take: take.id, p_product: pid, p_counted: Number(v) }); qc.invalidateQueries({ queryKey: ["take-lines", take.id] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function close() {
    if (!confirm("Close the stock take? Counted items will replace the current stock levels.")) return;
    try { await rpc("close_stock_take", { p_take: take.id }); toast.success("Stock levels updated"); qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="w-64 bg-card" placeholder="Find item" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant={onlyLeft ? "default" : "outline"} onClick={() => setOnlyLeft(!onlyLeft)}>Not counted yet</Button>
        <span className="text-sm text-muted-foreground">{counted} / {lines.data?.length ?? 0} counted</span>
        {can("admin", "manager") && <Button variant="success" className="ml-auto" onClick={close}>Finish & update stock</Button>}
      </div>
      <div className="pos-card divide-y">
        {rows.map((l) => {
          const diff = l.counted === null ? null : Number(l.counted) - Number(l.expected);
          return (
            <div key={l.product_id} className="flex items-center gap-4 px-5 py-3">
              <span className="flex-1 font-semibold">{name(l.product_id)}</span>
              {can("admin", "manager") && <span className="tabular w-24 text-right text-sm text-muted-foreground">System {Number(l.expected)}</span>}
              <Input
                key={`${l.product_id}-${l.counted}`}
                className="tabular w-24 text-right"
                inputMode="decimal"
                defaultValue={l.counted ?? ""}
                placeholder="Count"
                onBlur={(e) => e.target.value !== String(l.counted ?? "") && save(l.product_id, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {can("admin", "manager") && (
                <span className={cn("tabular w-16 text-right text-sm font-bold", diff === null ? "text-muted-foreground" : diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : "")}>
                  {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                </span>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nothing to show.</p>}
      </div>
    </>
  );
}
