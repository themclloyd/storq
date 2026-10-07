import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, ChevronDown, Smartphone, WifiOff, ShieldCheck, Zap, Store, Boxes, Users, BarChart3 } from "lucide-react";
import { useState } from "react";
import heroShop from "@/assets/hero-shop.jpg";
import counter from "@/assets/counter.jpg";
import stocktake from "@/assets/stocktake.jpg";
import storeClothing from "@/assets/store-clothing.jpg";
import storeGrocery from "@/assets/store-grocery.jpg";
import storeHardware from "@/assets/store-hardware.jpg";
import ownerPortrait from "@/assets/owner-portrait.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tillpoint POS — The point of sale for every sale" },
      {
        name: "description",
        content:
          "The point of sale built for African shops. Sell, run laybys, approve invoices and count stock from any phone or laptop. Free to start.",
      },
      { property: "og:title", content: "Tillpoint POS — The point of sale for every sale" },
      {
        property: "og:description",
        content: "Point of sale, layby and stock control for one shop or many — on the phone you already own.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Cta({ label = "Start free", invert = false }: { label?: string; invert?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      variant={invert ? "secondary" : "default"}
      className="h-14 rounded-full px-8 text-base font-semibold"
    >
      <Link to="/auth">
        {label} <ArrowRight className="ml-1 h-5 w-5" />
      </Link>
    </Button>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-semibold uppercase tracking-widest text-accent">{children}</p>;
}

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">T</span>
            Tillpoint
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
            <a href="#shops" className="hover:text-accent">Who it's for</a>
            <a href="#features" className="hover:text-accent">Features</a>
            <a href="#layby" className="hover:text-accent">Layby</a>
            <a href="#pricing" className="hover:text-accent">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden rounded-full sm:inline-flex">
              <Link to="/auth">Log in</Link>
            </Button>
            <Button asChild className="rounded-full px-5 font-semibold">
              <Link to="/auth">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — Shopify style: eyebrow, huge headline, dual CTA, full-width photo */}
      <section className="mx-auto max-w-7xl px-6 pb-16 pt-16 text-center md:pt-24">
        <Eyebrow>Point of sale</Eyebrow>
        <h1 className="mx-auto mt-4 max-w-4xl text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
          The point of sale for every sale
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          From first sale to full scale, Tillpoint runs your till, your stock and your staff —
          on the phone or laptop you already own.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Cta label="Start for free" />
          <Button asChild size="lg" variant="outline" className="h-14 rounded-full px-8 text-base font-semibold">
            <a href="#features">See how it works</a>
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">No credit card. No hardware. Set up in 5 minutes.</p>
        <div className="relative mt-14 overflow-hidden rounded-3xl">
          <img src={heroShop} alt="Shop owner ringing up a sale on Tillpoint" width={1600} height={1104} className="h-[460px] w-full object-cover md:h-[620px]" />
          <div className="absolute bottom-5 left-5 rounded-2xl bg-card/95 p-5 text-left shadow-xl backdrop-blur md:bottom-8 md:left-8">
            <p className="text-xs font-medium text-muted-foreground">Today · Rosebank store</p>
            <p className="mt-1 text-3xl font-extrabold">R 18 450</p>
            <p className="text-sm font-semibold text-success">▲ 24% vs last Wednesday</p>
          </div>
        </div>
      </section>

      {/* Who it's for — Square style photo tiles */}
      <section id="shops" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            Created for every kind of shop
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            One till or ten stores. Clothing, groceries, hardware — Tillpoint fits the way you trade.
          </p>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { img: storeClothing, label: "Clothing & fashion" },
              { img: storeGrocery, label: "Grocery & spaza" },
              { img: storeHardware, label: "Hardware & building" },
              { img: ownerPortrait, label: "And every shop in between" },
            ].map((t) => (
              <div key={t.label} className="group relative overflow-hidden rounded-3xl">
                <img src={t.img} alt={t.label} loading="lazy" width={800} height={1008} className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-6 pt-16">
                  <p className="text-lg font-bold text-white">{t.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Single store / multiple stores — Shopify style split */}
      <section className="bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            Powering shops of every size
          </h2>
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl bg-card p-10 shadow-sm">
              <Store className="h-9 w-9 text-accent" />
              <h3 className="mt-6 text-3xl font-bold">Single store</h3>
              <p className="mt-3 text-lg text-muted-foreground">
                Sell at the counter with one login for the shop. Every staff member unlocks the till
                with their own 4-digit PIN — so every rand is traceable to a person.
              </p>
            </div>
            <div className="rounded-3xl bg-card p-10 shadow-sm">
              <Boxes className="h-9 w-9 text-accent" />
              <h3 className="mt-6 text-3xl font-bold">Multiple stores</h3>
              <p className="mt-3 text-lg text-muted-foreground">
                Run every branch from one account. Stock, sales and staff sync across all your
                stores — see the whole business from your phone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature: checkout — alternating photo */}
      <section id="features" className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
        <img src={counter} alt="Cashier completing a sale" loading="lazy" width={1200} height={1200} className="aspect-square w-full rounded-3xl object-cover" />
        <div>
          <Eyebrow>Checkout</Eyebrow>
          <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">The fastest till at the counter.</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Tap products, take cash, card or mobile money, and you're done. Every sale updates stock instantly, on every device.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              "Cash, card and mobile money in one checkout",
              "Each cashier signs in with their own PIN — every rand is traceable",
              "Works for one shop or ten, from the same account",
            ].map((t) => (
              <li key={t} className="flex gap-3 text-base">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Two store types — dark band */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            Run your shop your way. Not ours.
          </h2>
          <p className="mt-5 max-w-2xl text-lg opacity-70">Choose how each store works. Tillpoint enforces it — no shortcuts, no leaks.</p>
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl bg-primary-foreground/5 p-10 ring-1 ring-primary-foreground/10">
              <Zap className="h-8 w-8" />
              <h3 className="mt-6 text-3xl font-bold">Direct sale</h3>
              <p className="mt-3 opacity-70">Cashier rings it up, customer pays, stock drops. Perfect for busy counters and spazas.</p>
            </div>
            <div className="rounded-3xl bg-primary-foreground/5 p-10 ring-1 ring-primary-foreground/10">
              <ShieldCheck className="h-8 w-8" />
              <h3 className="mt-6 text-3xl font-bold">Approval-based</h3>
              <p className="mt-3 opacity-70">Cashier creates an invoice, a manager approves it before stock moves. Built for wholesale and high-value goods.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature: inventory — alternating photo */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
        <div className="md:order-2">
          <img src={stocktake} alt="Manager counting stock on his phone" loading="lazy" width={1200} height={1200} className="aspect-square w-full rounded-3xl object-cover" />
        </div>
        <div>
          <Eyebrow>Inventory</Eyebrow>
          <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">Know exactly what's on the shelf.</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Run stock takes with your whole team on their phones. Tillpoint shows what's missing, who counted it, and what it cost you.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-muted p-6">
              <p className="text-3xl font-extrabold">Live</p>
              <p className="text-sm text-muted-foreground">stock across all stores</p>
            </div>
            <div className="rounded-2xl bg-muted p-6">
              <p className="text-3xl font-extrabold">Every</p>
              <p className="text-sm text-muted-foreground">adjustment logged to a PIN</p>
            </div>
          </div>
        </div>
      </section>

      {/* Layby with product mockup */}
      <section id="layby" className="bg-muted">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
          <div>
            <Eyebrow>Layby</Eyebrow>
            <h2 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">Say yes to customers who pay over time.</h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Reserve the goods, take a deposit, record each payment. The item is held out of stock until it's paid off.
            </p>
            <div className="mt-8"><Cta label="Try layby free" /></div>
          </div>
          <div className="rounded-3xl bg-card p-8 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Layby #1042 · Thandi M.</p>
                <p className="mt-1 text-2xl font-bold">Couch set — R 9 600</p>
              </div>
              <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">On track</span>
            </div>
            <div className="mt-6 h-3 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[62%] rounded-full bg-accent" />
            </div>
            <div className="mt-3 flex justify-between text-sm">
              <span className="font-semibold">R 5 950 paid</span>
              <span className="text-muted-foreground">R 3 650 left</span>
            </div>
            <div className="mt-6 space-y-3 border-t border-border pt-6 text-sm">
              {[["12 Sep", "Deposit · Cash", "R 2 000"], ["26 Sep", "Mobile money", "R 1 950"], ["03 Oct", "Card", "R 2 000"]].map(([d, m, a]) => (
                <div key={d} className="flex justify-between">
                  <span className="text-muted-foreground">{d} · {m}</span>
                  <span className="font-semibold">{a}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Customer story — Square style testimonial with photo */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid items-center gap-12 md:grid-cols-5">
          <img src={ownerPortrait} alt="Shop owner in her store" loading="lazy" width={800} height={1008} className="aspect-[4/5] w-full rounded-3xl object-cover md:col-span-2" />
          <div className="md:col-span-3">
            <Eyebrow>Shop owners</Eyebrow>
            <blockquote className="mt-6 text-3xl font-bold leading-snug tracking-tight md:text-4xl">
              "Before Tillpoint I never knew what left the shop. Now every sale, every layby,
              every stock count has a name on it. My staff trust it and so do I."
            </blockquote>
            <p className="mt-6 text-lg font-semibold">Naledi K.</p>
            <p className="text-muted-foreground">Clothing store owner, Johannesburg</p>
          </div>
        </div>
        {/* Big stat callouts */}
        <div className="mt-20 grid gap-10 border-t border-border pt-16 text-center sm:grid-cols-3">
          {[
            ["5 min", "to set up your first till"],
            ["R0", "hardware to buy"],
            ["100%", "of sales traced to a staff PIN"],
          ].map(([n, l]) => (
            <div key={n}>
              <p className="text-5xl font-extrabold tracking-tight text-accent md:text-6xl">{n}</p>
              <p className="mt-2 text-muted-foreground">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* All features grid — Shopify style */}
      <section className="bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Eyebrow>Features</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            All the features. All in one place.
          </h2>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [Zap, "Fast checkout", "Ring up sales in seconds with cash, card or mobile money."],
              [Users, "Staff management", "One login per shop, a 4-digit PIN per person. Roles come from the PIN."],
              [Boxes, "Inventory management", "Live stock across every store, with quantity tracking on every item."],
              [ShieldCheck, "Invoice approvals", "Approval-based stores: cashiers invoice, managers approve before stock moves."],
              [BarChart3, "Reports & analytics", "See what sells best, when you're busiest, and what each store makes."],
              [Smartphone, "Stock takes with staff", "Count together on your phones. Variances and losses shown instantly."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Zap;
              return (
                <div key={t as string}>
                  <I className="h-8 w-8 text-accent" />
                  <h3 className="mt-5 text-2xl font-bold">{t as string}</h3>
                  <p className="mt-2 text-muted-foreground">{d as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How to get started — Shopify style 3 steps */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
          How to get started with Tillpoint
        </h2>
        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {[
            ["1", "Start for free", "Create your business account — no credit card required."],
            ["2", "Set up your store", "Add your products and prices, then give each staff member their own PIN."],
            ["3", "Start selling", "Open the till on any phone or laptop and ring up your first sale."],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-xl font-extrabold text-primary-foreground">{n}</span>
              <h3 className="mt-6 text-2xl font-bold">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-12"><Cta label="Start for free" /></div>
      </section>

      {/* Why Africa */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">Built for how Africa actually trades.</h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              [Smartphone, "Any device", "Android phone, old laptop, tablet — sign in once and every staff member uses their PIN."],
              [ShieldCheck, "Staff can't cheat the till", "Roles come from the PIN. Cashiers sell, managers approve, owners see everything."],
              [WifiOff, "Light on data", "A fast, lightweight app that keeps working on everyday mobile connections."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Smartphone;
              return (
                <div key={t as string}>
                  <I className="h-8 w-8 text-accent" />
                  <h3 className="mt-5 text-2xl font-bold">{t as string}</h3>
                  <p className="mt-2 text-muted-foreground">{d as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="text-center text-4xl font-extrabold tracking-tight md:text-6xl">Simple pricing. Start free.</h2>
          <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
            {[
              { n: "Starter", p: "R0", s: "/month", f: ["1 store", "Up to 3 staff PINs", "Direct sale, layby, stock"], hi: false },
              { n: "Growth", p: "R299", s: "/month", f: ["Unlimited stores", "Unlimited staff PINs", "Approval-based stores", "Team stock takes & reports"], hi: true },
            ].map((t) => (
              <div key={t.n} className={`rounded-3xl p-10 ${t.hi ? "bg-primary text-primary-foreground" : "bg-card shadow-sm"}`}>
                <p className="text-lg font-semibold">{t.n}</p>
                <p className="mt-4 text-6xl font-extrabold tracking-tight">{t.p}<span className="text-lg font-medium opacity-60">{t.s}</span></p>
                <ul className="mt-8 space-y-3">
                  {t.f.map((x) => (
                    <li key={x} className="flex gap-3"><Check className="h-5 w-5 shrink-0" /> {x}</li>
                  ))}
                </ul>
                <div className="mt-10"><Cta label={t.hi ? "Start 30-day trial" : "Start free"} invert={t.hi} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Faq />

      {/* Final CTA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center">
          <h2 className="mx-auto max-w-4xl text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl">Open your till in the next 5 minutes.</h2>
          <div className="mt-10 flex justify-center"><Cta label="Get started free" invert /></div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
        <span>© {new Date().getFullYear()} Tillpoint</span>
        <span>Point of sale · Inventory · Layby</span>
      </footer>
    </div>
  );
}

function Faq() {
  const items = [
    ["Do I need to buy hardware?", "No. Tillpoint runs in the browser on any phone, tablet or laptop you already own."],
    ["How do staff log in?", "You sign each device in once with your business email. After that, every staff member unlocks it with their own 4-digit PIN, which sets what they can do."],
    ["Can I run more than one shop?", "Yes. Add as many stores as you need and choose for each one whether it's direct sale or approval-based."],
    ["Does it support mobile money?", "Yes — cash, card and mobile money are all recorded at checkout and on layby payments."],
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Frequently asked questions</h2>
      <div className="mt-8 divide-y divide-border border-y border-border">
        {items.map(([q, a], i) => (
          <button key={q} onClick={() => setOpen(open === i ? null : i)} className="block w-full py-6 text-left">
            <div className="flex items-center justify-between text-lg font-semibold">
              {q}
              <ChevronDown className={`h-5 w-5 transition-transform ${open === i ? "rotate-180" : ""}`} />
            </div>
            {open === i && <p className="mt-3 text-muted-foreground">{a}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}
