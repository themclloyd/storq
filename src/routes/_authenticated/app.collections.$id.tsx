import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useDeferredValue } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Delete02Icon, Share01Icon, Cancel01Icon } from "@/lib/icons";
import { usePos } from "@/lib/pos";
import { useProducts } from "@/lib/products";
import { useCollections, shareUrl } from "@/lib/collections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, Field, PageHeader } from "@/components/pos/bits";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/collections/$id")({
  head: () => ({
    meta: [
      { title: "Edit collection — Storq" },
      {
        name: "description",
        content: "Edit collection details, discounts and product membership.",
      },
      { property: "og:title", content: "Edit collection — Storq" },
      {
        property: "og:description",
        content: "Edit collection details, discounts and product membership.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CollectionPage,
});

function CollectionPage() {
  const { id } = Route.useParams();
  const isNew = id === "new";
  const { can, rpc, money } = usePos();
  const { t } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const cols = useCollections();
  const products = useProducts();
  const c = isNew ? undefined : cols.data?.list.find((x) => x.id === id);

  const [f, setF] = useState({ name: "", discount: "0", shared: true });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded || !cols.data) return;
    if (c) {
      setF({ name: c.name, discount: String(c.discount_pct), shared: c.is_shared });
      setSel(
        new Set(
          Object.entries(cols.data.byProduct)
            .filter(([, ids]) => ids.includes(c.id))
            .map(([pid]) => pid),
        ),
      );
    }
    setLoaded(true);
  }, [cols.data, c, loaded]);

  // Memoized and driven by a deferred term so filtering a large catalog stays
  // responsive. Derived above the role/existence guards to keep hook order.
  const dq = useDeferredValue(q);
  const inCol = useMemo(
    () => (products.data ?? []).filter((p) => sel.has(p.id)),
    [products.data, sel],
  );
  const available = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) => !sel.has(p.id) && (!needle || p.name.toLowerCase().includes(needle)),
    );
  }, [products.data, sel, dq]);

  if (!can("admin", "manager")) return <Empty>{t("col.onlyAdmins")}</Empty>;
  if (!isNew && cols.data && !c) return <Empty>{t("col.notFound")}</Empty>;
  const pct = Number(f.discount || 0);
  const toggle = (pid: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });

  async function save() {
    setSaving(true);
    try {
      const newId =
        (await rpc<string>("save_collection", {
          p_id: c?.id ?? null,
          p_name: f.name,
          p_discount: pct,
          p_shared: f.shared,
        })) ?? c?.id;
      await rpc("set_collection_products", { p_collection: newId, p_products: [...sel] });
      toast.success(t("col.saved"));
      await qc.invalidateQueries();
      if (isNew && newId) nav({ to: "/app/collections/$id", params: { id: newId }, replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!c || !confirm(t("col.deleteConfirm"))) return;
    try {
      await rpc("delete_collection", { p_id: c.id });
      await qc.invalidateQueries();
      nav({ to: "/app/collections" });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function share() {
    if (!c) return;
    const url = shareUrl(c.share_slug);
    try {
      if (navigator.share) await navigator.share({ title: c.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t("col.linkCopied"));
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <>
      <Link
        to="/app/collections"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} /> {t("col.title")}
      </Link>
      <PageHeader
        title={isNew ? t("col.newCollection") : f.name || t("col.collectionWord")}
        sub={
          t("col.itemsCount", { count: sel.size }) +
          (pct > 0 ? ` · ${t("col.offPct", { pct })}` : "")
        }
        actions={
          <div className="flex gap-1.5">
            {c && c.is_shared && (
              <Button size="sm" variant="outline" onClick={share}>
                <HugeiconsIcon icon={Share01Icon} /> {t("col.share")}
              </Button>
            )}
            {c && (
              <Button size="sm" variant="ghost" onClick={remove}>
                <HugeiconsIcon icon={Delete02Icon} /> {t("common.delete")}
              </Button>
            )}
            <Button size="sm" disabled={!f.name || saving} onClick={save}>
              {saving ? t("col.saving") : t("common.save")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="pos-card flex flex-col gap-3 self-start p-4">
          <div className="font-display text-sm font-medium">{t("col.details")}</div>
          <Field label={t("common.name")}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t("col.discountPct")}>
            <Input
              inputMode="decimal"
              value={f.discount}
              onChange={(e) => setF({ ...f, discount: e.target.value })}
            />
          </Field>
          <p className="text-xs text-muted-foreground">{t("col.discountHint")}</p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={f.shared}
              onCheckedChange={(v) => setF({ ...f, shared: v === true })}
            />{" "}
            {t("col.shareHint")}
          </label>
        </div>

        <div className="flex flex-col gap-4">
          <div className="pos-card">
            <div className="font-display border-b px-4 py-2.5 text-sm font-medium">
              {t("col.itemsHeading", { count: inCol.length })}
            </div>
            <div className="divide-y">
              {inCol.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                  {pct > 0 && (
                    <span className="tabular text-muted-foreground line-through">
                      {money(p.price)}
                    </span>
                  )}
                  <span className="tabular font-semibold">{money(p.price * (1 - pct / 100))}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggle(p.id)}
                    aria-label={t("col.remove")}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={16} />
                  </Button>
                </div>
              ))}
              {inCol.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {t("col.noItemsAdd")}
                </p>
              )}
            </div>
          </div>

          <div className="pos-card">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <div className="font-display text-sm font-medium">{t("col.addItems")}</div>
              <Input
                className="h-8 max-w-56"
                placeholder={t("col.searchItems")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="max-h-80 divide-y overflow-y-auto">
              {available.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-1.5 text-[13px]">
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="tabular text-muted-foreground">{money(p.price)}</span>
                  <Button size="sm" variant="outline" onClick={() => toggle(p.id)}>
                    {t("col.add")}
                  </Button>
                </div>
              ))}
              {available.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">{t("col.noMore")}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("col.changesKept")}</p>
        </div>
      </div>
    </>
  );
}
