import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Tick01Icon, SmartPhone01Icon, WifiOffIcon, ShieldCheckIcon, FlashIcon, StoreIcon, BoxesIcon, UserMultipleIcon, BarChartIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { PRICES } from "@/lib/billing";
import { buildSeo, absUrl, SITE_NAME } from "@/lib/seo";
import heroShop from "@/assets/hero-shop.jpg";
import counter from "@/assets/counter.jpg";
import stocktake from "@/assets/stocktake.jpg";
import storeClothing from "@/assets/store-clothing.jpg";
import storeGrocery from "@/assets/store-grocery.jpg";
import storeHardware from "@/assets/store-hardware.jpg";
import ownerPortrait from "@/assets/owner-portrait.jpg";

const faqItems: [string, string][] = [
  ["Do I need to buy hardware?", "No. Storq runs in the browser on any phone, tablet or laptop you already own."],
  ["How do staff log in?", "You sign each device in once with your business email. After that, every staff member unlocks it with their own 4-digit PIN, which sets what they can do."],
  ["Can I run more than one shop?", "Yes. Add as many stores as you need and choose for each one whether it's direct sale or approval-based."],
  ["Does it support mobile money?", "Yes — cash, card and mobile money are all recorded at checkout and on layby payments."],
];

const landingJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${absUrl("/")}/#website`,
      url: absUrl("/"),
      name: "Storq POS",
      description: "Point of sale, inventory and layby for African shops.",
      inLanguage: "en",
      publisher: { "@id": `${absUrl("/")}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${absUrl("/")}/#organization`,
      name: SITE_NAME,
      url: absUrl("/"),
      logo: { "@type": "ImageObject", url: absUrl("/logo.svg") },
    },
    {
      "@type": "SoftwareApplication",
      name: "Storq POS",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "The point of sale built for African shops. Sell, run laybys, approve invoices and count stock from any phone or laptop.",
      offers: { "@type": "AggregateOffer", lowPrice: "0", priceCurrency: "MWK", offerCount: "2" },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqItems.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

export const Route = createFileRoute("/")({
  head: () => ({
    ...buildSeo({
      title: "Storq POS — The point of sale for every sale",
      description:
        "The point of sale built for African shops. Sell, run laybys, approve invoices and count stock from any phone or laptop. Free to start.",
      path: "/",
    }),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(landingJsonLd) }],
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
        {label} <HugeiconsIcon icon={ArrowRight01Icon} className="ml-1 h-5 w-5" />
      </Link>
    </Button>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Badge className="rounded-full border-0 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent shadow-none hover:bg-accent/10">
      {children}
    </Badge>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 text-lg font-light tracking-tight">
            <img src="/logo.svg" alt="Storq logo" className="h-8 w-8 rounded-lg" />
            Storq
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
        <h1 className="mx-auto mt-4 max-w-4xl text-5xl font-light leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
          The point of sale for every sale
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          From first sale to full scale, Storq runs your till, your stock and your staff —
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
          <img src={heroShop} alt="Shop owner ringing up a sale on Storq" width={1600} height={1104} className="h-[460px] w-full object-cover md:h-[620px]" />
          <Card className="absolute bottom-5 left-5 gap-0 rounded-2xl border-0 bg-card/95 p-5 text-left shadow-xl backdrop-blur md:bottom-8 md:left-8">
            <CardDescription className="text-xs font-medium">Today · Rosebank store</CardDescription>
            <p className="mt-1 text-3xl font-light">MK 18 450</p>
            <p className="text-sm font-semibold text-success">▲ 24% vs last Wednesday</p>
          </Card>
        </div>
      </section>

      {/* Who it's for — Square style photo tiles */}
      <section id="shops" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
            Created for every kind of shop
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            One till or ten stores. Clothing, groceries, hardware — Storq fits the way you trade.
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
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/70 to-transparent p-6 pt-16">
                  <p className="text-lg font-light text-background">{t.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Single store / multiple stores — Shopify style split */}
      <section className="bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
            Powering shops of every size
          </h2>
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            <Card className="gap-0 rounded-3xl border-0 p-10 shadow-sm">
              <CardHeader className="gap-0 p-0">
                <HugeiconsIcon icon={StoreIcon} className="h-9 w-9 text-accent" />
                <CardTitle className="mt-6 text-3xl font-light">Single store</CardTitle>
                <CardDescription className="mt-3 text-lg leading-7">
                  Sell at the counter with one login for the shop. Every staff member unlocks the till
                  with their own 4-digit PIN — so every kwacha is traceable to a person.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="gap-0 rounded-3xl border-0 p-10 shadow-sm">
              <CardHeader className="gap-0 p-0">
                <HugeiconsIcon icon={BoxesIcon} className="h-9 w-9 text-accent" />
                <CardTitle className="mt-6 text-3xl font-light">Multiple stores</CardTitle>
                <CardDescription className="mt-3 text-lg leading-7">
                  Run every branch from one account. Stock, sales and staff sync across all your
                  stores — see the whole business from your phone.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Feature: checkout — alternating photo */}
      <section id="features" className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
        <img src={counter} alt="Cashier completing a sale" loading="lazy" width={1200} height={1200} className="aspect-square w-full rounded-3xl object-cover" />
        <div>
          <Eyebrow>Checkout</Eyebrow>
          <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight md:text-6xl">The fastest till at the counter.</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Tap products, take cash, card or mobile money, and you're done. Every sale updates stock instantly, on every device.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              "Cash, card and mobile money in one checkout",
              "Each cashier signs in with their own PIN — every kwacha is traceable",
              "Works for one shop or ten, from the same account",
            ].map((t) => (
              <li key={t} className="flex gap-3 text-base">
                <HugeiconsIcon icon={Tick01Icon} className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Two store types — dark band */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
            Run your shop your way. Not ours.
          </h2>
          <p className="mt-5 max-w-2xl text-lg opacity-70">Choose how each store works. Storq enforces it — no shortcuts, no leaks.</p>
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            <Card className="gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 shadow-none ring-1 ring-primary-foreground/10">
              <CardHeader className="gap-0 p-0">
                <HugeiconsIcon icon={FlashIcon} className="h-8 w-8" />
                <CardTitle className="mt-6 text-3xl font-light">Direct sale</CardTitle>
                <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                  Cashier rings it up, customer pays, stock drops. Perfect for busy counters and spazas.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card className="gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 shadow-none ring-1 ring-primary-foreground/10">
              <CardHeader className="gap-0 p-0">
                <HugeiconsIcon icon={ShieldCheckIcon} className="h-8 w-8" />
                <CardTitle className="mt-6 text-3xl font-light">Approval-based</CardTitle>
                <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                  Cashier creates an invoice, a manager approves it before stock moves. Built for wholesale and high-value goods.
                </CardDescription>
              </CardHeader>
            </Card>
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
          <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight md:text-6xl">Know exactly what's on the shelf.</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Run stock takes with your whole team on their phones. Storq shows what's missing, who counted it, and what it cost you.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <Card className="gap-0 rounded-2xl border-0 bg-muted p-6 shadow-none">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="text-3xl font-light">Live</CardTitle>
                <CardDescription>stock across all stores</CardDescription>
              </CardHeader>
            </Card>
            <Card className="gap-0 rounded-2xl border-0 bg-muted p-6 shadow-none">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="text-3xl font-light">Every</CardTitle>
                <CardDescription>adjustment logged to a PIN</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Layby with product mockup */}
      <section id="layby" className="bg-muted">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
          <div>
            <Eyebrow>Layby</Eyebrow>
            <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight md:text-6xl">Say yes to customers who pay over time.</h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Reserve the goods, take a deposit, record each payment. The item is held out of stock until it's paid off.
            </p>
            <div className="mt-8"><Cta label="Try layby free" /></div>
          </div>
          <Card className="gap-0 rounded-3xl border-0 p-8 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardDescription>Layby #1042 · Thandi M.</CardDescription>
                <CardTitle className="mt-1 text-2xl font-light">Couch set — MK 9 600</CardTitle>
              </div>
              <Badge className="shrink-0 rounded-full border-0 bg-success/15 px-3 py-1 text-xs font-semibold text-success shadow-none hover:bg-success/15">
                On track
              </Badge>
            </div>
            <Progress value={62} className="mt-6 h-3 bg-muted" />
            <div className="mt-3 flex justify-between text-sm">
              <span className="font-semibold">MK 5 950 paid</span>
              <span className="text-muted-foreground">MK 3 650 left</span>
            </div>
            <Separator className="mt-6" />
            <div className="mt-6 space-y-3 text-sm">
              {[["12 Sep", "Deposit · Cash", "MK 2 000"], ["26 Sep", "Mobile money", "MK 1 950"], ["03 Oct", "Card", "MK 2 000"]].map(([d, m, a]) => (
                <div key={d} className="flex justify-between">
                  <span className="text-muted-foreground">{d} · {m}</span>
                  <span className="font-semibold">{a}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* Customer story — Square style testimonial with photo */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid items-center gap-12 md:grid-cols-5">
          <img src={ownerPortrait} alt="Shop owner in her store" loading="lazy" width={800} height={1008} className="aspect-[4/5] w-full rounded-3xl object-cover md:col-span-2" />
          <div className="md:col-span-3">
            <Eyebrow>Shop owners</Eyebrow>
            <blockquote className="mt-6 text-3xl font-light leading-snug tracking-tight md:text-4xl">
              "Before Storq I never knew what left the shop. Now every sale, every layby,
              every stock count has a name on it. My staff trust it and so do I."
            </blockquote>
            <p className="mt-6 text-lg font-semibold">Naledi K.</p>
            <p className="text-muted-foreground">Clothing store owner, Johannesburg</p>
          </div>
        </div>
        {/* Big stat callouts */}
        <Separator className="mt-20" />
        <div className="grid gap-10 pt-16 text-center sm:grid-cols-3">
          {[
            ["5 min", "to set up your first till"],
            ["MK0", "hardware to buy"],
            ["100%", "of sales traced to a staff PIN"],
          ].map(([n, l]) => (
            <div key={n}>
              <p className="text-5xl font-light tracking-tight text-accent md:text-6xl">{n}</p>
              <p className="mt-2 text-muted-foreground">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* All features grid — Shopify style */}
      <section className="bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Eyebrow>Features</Eyebrow>
          <h2 className="mt-3 max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
            All the features. All in one place.
          </h2>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [FlashIcon, "Fast checkout", "Ring up sales in seconds with cash, card or mobile money."],
              [UserMultipleIcon, "Staff management", "One login per shop, a 4-digit PIN per person. Roles come from the PIN."],
              [BoxesIcon, "Inventory management", "Live stock across every store, with quantity tracking on every item."],
              [ShieldCheckIcon, "Invoice approvals", "Approval-based stores: cashiers invoice, managers approve before stock moves."],
              [BarChartIcon, "Reports & analytics", "See what sells best, when you're busiest, and what each store makes."],
              [SmartPhone01Icon, "Stock takes with staff", "Count together on your phones. Variances and losses shown instantly."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof FlashIcon;
              return (
                <div key={t as string}>
                  <HugeiconsIcon icon={I} className="h-8 w-8 text-accent" />
                  <h3 className="mt-5 text-2xl font-light">{t as string}</h3>
                  <p className="mt-2 text-muted-foreground">{d as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How to get started — Shopify style 3 steps */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
          How to get started with Storq
        </h2>
        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {[
            ["1", "Start for free", "Create your business account — no credit card required."],
            ["2", "Set up your store", "Add your products and prices, then give each staff member their own PIN."],
            ["3", "Start selling", "Open the till on any phone or laptop and ring up your first sale."],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-xl font-light text-primary-foreground">{n}</span>
              <h3 className="mt-6 text-2xl font-light">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-12"><Cta label="Start for free" /></div>
      </section>

      {/* Why Africa */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">Built for how Africa actually trades.</h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              [SmartPhone01Icon, "Any device", "Android phone, old laptop, tablet — sign in once and every staff member uses their PIN."],
              [ShieldCheckIcon, "Staff can't cheat the till", "Roles come from the PIN. Cashiers sell, managers approve, owners see everything."],
              [WifiOffIcon, "Light on data", "A fast, lightweight app that keeps working on everyday mobile connections."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof SmartPhone01Icon;
              return (
                <div key={t as string}>
                  <HugeiconsIcon icon={I} className="h-8 w-8 text-accent" />
                  <h3 className="mt-5 text-2xl font-light">{t as string}</h3>
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
          <h2 className="text-center text-4xl font-light tracking-tight md:text-6xl">Simple pricing. Start free.</h2>
          <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
            {[
              { n: "Starter", p: `MK0`, s: "/store /month", f: ["1 store", "Up to 3 staff PINs", "Direct sale, layby, stock"], hi: false },
              { n: "Growth", p: `MK${PRICES.MWK.toLocaleString()}`, s: "/store /month", f: ["Unlimited stores", "Unlimited staff PINs", "Approval-based stores", "Team stock takes & reports"], hi: true },
            ].map((t) => (
              <Card
                key={t.n}
                className={cn(
                  "gap-0 rounded-3xl border-0 p-10",
                  t.hi ? "bg-primary text-primary-foreground shadow" : "shadow-sm",
                )}
              >
                <CardHeader className="p-0">
                  <CardTitle className="text-lg font-semibold">{t.n}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <p className="mt-4 text-6xl font-light tracking-tight">{t.p}<span className="text-lg font-medium opacity-60">{t.s}</span></p>
                  <ul className="mt-8 space-y-3">
                    {t.f.map((x) => (
                      <li key={x} className="flex gap-3"><HugeiconsIcon icon={Tick01Icon} className="h-5 w-5 shrink-0" /> {x}</li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="mt-10 flex-col items-start gap-0 p-0"><Cta label={t.hi ? "Start 30-day trial" : "Start free"} invert={t.hi} /></CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Faq />

      {/* Final CTA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center">
          <h2 className="mx-auto max-w-4xl text-5xl font-light leading-[0.95] tracking-tight md:text-7xl">Open your till in the next 5 minutes.</h2>
          <div className="mt-10 flex justify-center"><Cta label="Get started free" invert /></div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
        <span>© {new Date().getFullYear()} Storq</span>
        <span>Point of sale · Inventory · Layby</span>
      </footer>
    </div>
  );
}

function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="text-3xl font-light tracking-tight md:text-4xl">Frequently asked questions</h2>
      <Accordion type="single" collapsible defaultValue="faq-0" className="mt-8">
        {faqItems.map(([q, a], i) => (
          <AccordionItem key={q} value={`faq-${i}`}>
            <AccordionTrigger className="text-lg font-semibold hover:no-underline">{q}</AccordionTrigger>
            <AccordionContent className="text-base leading-7 text-muted-foreground">{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
