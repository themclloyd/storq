import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type Shared = { name: string; discount_pct: number; business: string; currency: string; items: { name: string; price: number; sale_price: number }[] };

const getShared = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data }) => {
    const sb = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: r, error } = await sb.rpc("get_shared_collection", { p_slug: data.slug });
    if (error) throw new Error(error.message);
    return (r as unknown as Shared) ?? null;
  });

export const Route = createFileRoute("/c/$slug")({
  loader: ({ params }) => getShared({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    const t = loaderData ? `${loaderData.name} — ${loaderData.business}` : "Collection — Storq";
    const d = loaderData ? `Shop ${loaderData.items.length} items from ${loaderData.business}${loaderData.discount_pct > 0 ? `, now ${loaderData.discount_pct}% off` : ""}.` : "A shared Storq collection.";
    return { meta: [{ title: t }, { name: "description", content: d }, { property: "og:title", content: t }, { property: "og:description", content: d }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] };
  },
  errorComponent: () => <Msg>Could not load this collection.</Msg>,
  notFoundComponent: () => <Msg>Collection not found.</Msg>,
  component: SharedCollection,
});

function Msg({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center p-8 text-muted-foreground">{children}</div>;
}

function SharedCollection() {
  const c = Route.useLoaderData();
  if (!c) return <Msg>This collection is not shared or no longer exists.</Msg>;
  const m = (n: number) => `${c.currency} ${Number(n).toFixed(2)}`;
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-12">
      <p className="text-sm font-semibold text-muted-foreground">{c.business}</p>
      <h1 className="mt-1 text-4xl font-extrabold tracking-tight">{c.name}</h1>
      {c.discount_pct > 0 && <p className="mt-3 inline-block rounded-full bg-accent px-3 py-1 text-sm font-bold text-accent-foreground">{c.discount_pct}% off everything</p>}
      <div className="pos-card mt-8 divide-y">
        {c.items.length === 0 && <p className="p-8 text-center text-muted-foreground">No items yet.</p>}
        {c.items.map((i) => (
          <div key={i.name} className="flex items-center justify-between px-5 py-4">
            <span className="font-semibold">{i.name}</span>
            <span className="tabular text-right">
              {i.sale_price < i.price && <span className="mr-2 text-sm text-muted-foreground line-through">{m(i.price)}</span>}
              <span className="font-bold">{m(i.sale_price)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-xs text-muted-foreground">Visit us in store to buy · Powered by Storq</p>
    </main>
  );
}
