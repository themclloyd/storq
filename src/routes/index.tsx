import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

/** What the one plan unlocks — outcomes an owner buys, not module names. */
const planFeatures = [
  "Every sale, receipt and till report",
  "Layby, credit sales and refunds",
  "Live stock in every store you run",
  "A PIN and a role for each person",
  "What sells, what's slow, what's left after expenses",
  "Stock counts your whole team does on their phones",
];

const faqItems: [string, string][] = [
  ["What does it cost?", `MK${PRICES.MWK.toLocaleString()} a month for each store you run — that is the whole plan, with every feature in it. Your first store runs free on the trial, and you pay by Airtel Money, TNM Mpamba or card.`],
  ["Do I need to buy hardware?", "No. Storq runs in the browser on the Android phone, tablet or laptop you already own — no till machine, no barcode gun, and light enough to run on everyday data."],
  ["Can my staff see my money?", "Only what you allow. Each person opens the till with their own 4-digit PIN, and that PIN decides what they can do: cashiers sell, managers approve, and costs and reports stay with you."],
  ["What happens when the internet goes off?", "At a direct-sale till the counter keeps working — sales are held on the device and file themselves as soon as the connection is back, so an outage never turns a customer away."],
  ["Can I run more than one shop?", "Yes. Add a store the day you open it. Each one keeps its own stock and staff, and you see all of them from the same phone."],
  ["Can my customer pay how they want?", "Cash, card, Airtel Money or TNM Mpamba — taken at the counter and on every layby instalment, so the drawer always matches what the day sold."],
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
        "A point of sale for African shop owners: ring up sales, hold laybys, count stock and know where every kwacha is — from any phone or laptop.",
      offers: { "@type": "AggregateOffer", lowPrice: "60000", priceCurrency: "MWK", offerCount: "1" },
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
  head: () => {
    const seo = buildSeo({
      title: "Storq POS — Know what your shop made, every day",
      description:
        "Run your till, your stock and your staff from the phone in your pocket, and see every kwacha before you close. One plan at MK 60 000 per store, free trial included.",
      path: "/",
    });
    return {
      ...seo,
      // Fetchpriority hints let the hero shot start downloading with the HTML
      // instead of after the bundle has rendered it.
      links: [...seo.links, { rel: "preload", as: "image", href: heroShop, fetchpriority: "high" }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify(landingJsonLd) }],
    };
  },
  component: Landing,
});

/** True once the element has scrolled into view (fires once, no-JS safe). */
function useInView<T extends Element>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, threshold]);

  return { ref, inView };
}

/**
 * Wraps content in a scroll-triggered fade-and-rise reveal. Stays fully visible
 * without JS (see the noscript fallback in `__root.tsx`), fires once, and
 * respects prefers-reduced-motion via CSS.
 */
function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const style = useMemo<CSSProperties>(() => (delay ? { transitionDelay: `${delay}ms` } : {}), [delay]);

  return (
    <Tag ref={ref as never} style={style} className={cn("reveal", inView && "is-visible", className)}>
      {children}
    </Tag>
  );
}

/**
 * Above-the-fold variant of `Reveal`: the stagger is a CSS animation delay, so
 * the first screen animates as soon as HTML + CSS arrive rather than waiting for
 * hydration (which is what left the whole page blank, then fading in at once).
 */
function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const style = delay ? ({ "--rise-delay": `${delay}ms` } as CSSProperties) : undefined;

  return (
    <div style={style} className={cn("rise", className)}>
      {children}
    </div>
  );
}

/** Layby progress bar that fills from 0 the first time it scrolls into view. */
function AnimatedProgress({ value }: { value: number }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  return (
    <div ref={ref}>
      {/* Scoped to this instance so the shared Progress default stays untouched. */}
      <Progress
        value={inView ? value : 0}
        className="mt-6 h-3 bg-muted [&>div]:duration-700 [&>div]:ease-out"
      />
    </div>
  );
}

function Cta({ label = "Start free trial", invert = false }: { label?: string; invert?: boolean }) {
  return (
    <Button
      asChild
      size="lg"
      variant={invert ? "secondary" : "default"}
      className="group/cta h-14 rounded-full px-8 text-base font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
    >
      <Link to="/auth">
        {label} <HugeiconsIcon icon={ArrowRight01Icon} className="ml-1 h-5 w-5 transition-transform duration-200 group-hover/cta:translate-x-1" />
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
    <div className="storq-landing min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 text-lg font-light tracking-tight">
            <img src="/logo.svg" alt="Storq logo" className="h-8 w-8 rounded-lg" />
            Storq
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
            {[
              ["#shops", "Who it's for"],
              ["#features", "What you get"],
              ["#layby", "Layby"],
              ["#pricing", "Pricing"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="nav-link text-muted-foreground transition-colors hover:text-accent">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden rounded-full sm:inline-flex">
              <Link to="/auth">Log in</Link>
            </Button>
            <Button asChild className="rounded-full px-5 font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]">
              <Link to="/auth">Start free trial</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — the owner's wish, not the product's name */}
      <section className="mx-auto max-w-7xl px-6 pb-16 pt-16 text-center md:pt-24">
        <Rise>
          <Eyebrow>Built for African shops</Eyebrow>
        </Rise>
        <Rise delay={80}>
          <h1 className="mx-auto mt-4 max-w-4xl text-5xl font-light leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
            Know what your shop made. Every day.
          </h1>
        </Rise>
        <Rise delay={160}>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Storq runs your till, your stock and your staff on the phone already in your pocket —
            so you stop guessing where the money went.
          </p>
        </Rise>
        <Rise delay={240} className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Cta label="Start free trial" />
          <Button asChild size="lg" variant="outline" className="group/cta h-14 rounded-full px-8 text-base font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]">
            <a href="#features">
              See how it works <HugeiconsIcon icon={ArrowRight01Icon} className="ml-1 h-5 w-5 transition-transform duration-200 group-hover/cta:translate-x-1" />
            </a>
          </Button>
        </Rise>
        <Rise delay={300}>
          <p className="mt-4 text-sm text-muted-foreground">No card. No new hardware. Selling in five minutes.</p>
        </Rise>
        <Rise delay={120} className="relative mt-14 overflow-hidden rounded-3xl">
          <img src={heroShop} alt="Shop owner ringing up a sale on Storq" width={1600} height={1104} fetchPriority="high" decoding="async" className="h-[460px] w-full object-cover md:h-[620px] transition-transform duration-700 ease-out hover:scale-[1.02]" />
          <Card className="absolute bottom-5 left-5 gap-0 rounded-2xl border-0 bg-card/95 p-5 text-left shadow-xl backdrop-blur transition-transform duration-300 hover:-translate-y-1 md:bottom-8 md:left-8">
            <CardDescription className="text-xs font-medium">Today's takings · Limbe store</CardDescription>
            <p className="mt-1 text-3xl font-light">MK 18 450</p>
            <p className="text-sm font-semibold text-success">▲ 24% vs last Wednesday</p>
          </Card>
        </Rise>
      </section>

      {/* Who it's for — the owner sees their own shop, not a segment list */}
      <section id="shops" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
              Made for shops like yours
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              One till today, three branches next year. Clothing, groceries, hardware or a bit of
              everything — Storq fits the way you already trade.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { img: storeClothing, label: "Clothing & fashion", note: "Every size and colour counted — nothing sold that isn't there" },
              { img: storeGrocery, label: "Grocery & spaza", note: "Hundreds of small sales, rung up with no queue" },
              { img: storeHardware, label: "Hardware & building", note: "Big-ticket sales that wait for your OK" },
              { img: ownerPortrait, label: "Every shop in between", note: "If it sells, it's on your phone by tonight" },
            ].map((t, i) => (
              <Reveal key={t.label} delay={i * 90}>
                <div className="group relative overflow-hidden rounded-3xl">
                  <img src={t.img} alt={t.label} loading="lazy" width={800} height={1008} className="aspect-[4/5] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/70 to-transparent p-6 pt-16">
                    <p className="flex items-center gap-2 text-lg font-light text-background">
                      {t.label}
                      <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4 -translate-x-2 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
                    </p>
                    <p className="mt-1 text-sm leading-6 text-background/75">{t.note}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Feature: checkout — what a good day at the counter feels like */}
      <section id="features" className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
        <Reveal>
          <img src={counter} alt="Cashier completing a sale" loading="lazy" width={1200} height={1200} className="aspect-square w-full rounded-3xl object-cover transition-transform duration-700 ease-out hover:scale-[1.02]" />
        </Reveal>
        <Reveal delay={120}>
          <Eyebrow>At the counter</Eyebrow>
          <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight md:text-6xl">Ring up a sale in three taps.</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Your customer pays the way they want, the goods come off the shelf by themselves, and
            the receipt is in their hand before they turn around.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              "Cash, card, Airtel Money or TNM Mpamba — one button each",
              "Stock drops the second the sale is made, on every device",
              "Every sale lands with the cashier's name against it",
            ].map((t, i) => (
              <Reveal as="li" key={t} delay={200 + i * 90} className="flex gap-3 text-base transition-colors hover:text-accent">
                <HugeiconsIcon icon={Tick01Icon} className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> {t}
              </Reveal>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* Control — the peace of mind that lets an owner leave the counter */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
              Run the shop without sleeping at the counter.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-5 max-w-2xl text-lg opacity-70">
              Every person, every kwacha and every unit of stock leaves a trail. That trail is what
              lets you close at six and still trust the numbers tomorrow morning.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            <Reveal>
              <Card className="group gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 shadow-none ring-1 ring-primary-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary-foreground/10 hover:ring-primary-foreground/25">
                <CardHeader className="gap-0 p-0">
                  <HugeiconsIcon icon={UserMultipleIcon} className="h-8 w-8 transition-transform duration-300 group-hover:scale-110" />
                  <CardTitle className="mt-6 text-3xl font-light">A PIN for each person</CardTitle>
                  <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                    One shop login on the device, then every cashier opens the till with their own
                    code. Sales, discounts and refunds carry a name — theirs.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
            <Reveal delay={100}>
              <Card className="group gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 shadow-none ring-1 ring-primary-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary-foreground/10 hover:ring-primary-foreground/25">
                <CardHeader className="gap-0 p-0">
                  <HugeiconsIcon icon={ShieldCheckIcon} className="h-8 w-8 transition-transform duration-300 group-hover:scale-110" />
                  <CardTitle className="mt-6 text-3xl font-light">Big sales wait for your OK</CardTitle>
                  <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                    On the stores you choose, a cashier rings the invoice and nothing leaves the
                    shelf until a manager says yes. Made for wholesale and costly goods.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
            <Reveal delay={200}>
              <Card className="group gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 shadow-none ring-1 ring-primary-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary-foreground/10 hover:ring-primary-foreground/25">
                <CardHeader className="gap-0 p-0">
                  <HugeiconsIcon icon={BoxesIcon} className="h-8 w-8 transition-transform duration-300 group-hover:scale-110" />
                  <CardTitle className="mt-6 text-3xl font-light">Stock can't walk out unseen</CardTitle>
                  <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                    Sale, transfer, refund or count: each movement is logged with a reason and the
                    person who did it. Shortages stop being rumours.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Feature: stock — the sale you lose when you can't see the shelf */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
        <Reveal className="md:order-2">
          <img src={stocktake} alt="Manager counting stock on his phone" loading="lazy" width={1200} height={1200} className="aspect-square w-full rounded-3xl object-cover transition-transform duration-700 ease-out hover:scale-[1.02]" />
        </Reveal>
        <Reveal delay={120}>
          <Eyebrow>Your stock</Eyebrow>
          <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight md:text-6xl">Never lose a sale to "it's finished".</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            See what's on the shelf in every store, what has been sitting for a month and what is
            about to run out — before your customer has to ask.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <Card className="gap-0 rounded-2xl border-0 bg-muted p-6 shadow-none transition-colors duration-300 hover:bg-accent/10">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="text-3xl font-light">What sells</CardTitle>
                <CardDescription>and what sits — moved with every sale</CardDescription>
              </CardHeader>
            </Card>
            <Card className="gap-0 rounded-2xl border-0 bg-muted p-6 shadow-none transition-colors duration-300 hover:bg-accent/10">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="text-3xl font-light">Running low</CardTitle>
                <CardDescription>flagged before your best seller finishes</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </Reveal>
      </section>

      {/* Layby — the sale you would otherwise send away */}
      <section id="layby" className="bg-muted">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
          <Reveal>
            <Eyebrow>Layby</Eyebrow>
            <h2 className="mt-3 text-4xl font-light leading-tight tracking-tight md:text-6xl">Turn "I'll pay next month" into money today.</h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Take a deposit, hold the goods aside and record every instalment as it arrives. Your
              customer walks out happy, the sale is yours, and there's never an argument about what
              has been paid.
            </p>
            <div className="mt-8"><Cta label="Start free trial" /></div>
          </Reveal>
          <Reveal delay={120}>
            <Card className="gap-0 rounded-3xl border-0 p-8 shadow-xl transition-transform duration-500 ease-out hover:-translate-y-1.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardDescription>Layby #1042 · Thandi M.</CardDescription>
                  <CardTitle className="mt-1 text-2xl font-light">Couch set — MK 9 600</CardTitle>
                </div>
                <Badge className="shrink-0 rounded-full border-0 bg-success/15 px-3 py-1 text-xs font-semibold text-success shadow-none hover:bg-success/15">
                  On track
                </Badge>
              </div>
              <AnimatedProgress value={62} />
              <div className="mt-3 flex justify-between text-sm">
                <span className="font-semibold">MK 5 950 paid</span>
                <span className="text-muted-foreground">MK 3 650 left</span>
              </div>
              <Separator className="mt-6" />
              <div className="mt-6 space-y-3 text-sm">
                {[["12 Sep", "Deposit · Cash", "MK 2 000"], ["26 Sep", "Mobile money", "MK 1 950"], ["03 Oct", "Card", "MK 2 000"]].map(([d, m, a], i) => (
                  <Reveal key={d} delay={200 + i * 100} className="flex justify-between transition-colors hover:text-accent">
                    <span className="text-muted-foreground">{d} · {m}</span>
                    <span className="font-semibold">{a}</span>
                  </Reveal>
                ))}
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* Customer story — an owner's relief, in her words */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid items-center gap-12 md:grid-cols-5">
          <Reveal className="md:col-span-2">
            <img src={ownerPortrait} alt="Shop owner in her store" loading="lazy" width={800} height={1008} className="aspect-[4/5] w-full rounded-3xl object-cover transition-transform duration-700 ease-out hover:scale-[1.02]" />
          </Reveal>
          <Reveal delay={120} className="md:col-span-3">
            <Eyebrow>Shop owners</Eyebrow>
            <blockquote className="mt-6 text-3xl font-light leading-snug tracking-tight md:text-4xl">
              "I used to close the shop not knowing if we had made money. Now I look at my phone,
              not the drawer — and everything on it has a name behind it."
            </blockquote>
            <p className="mt-6 text-lg font-semibold">Chisomo B.</p>
            <p className="text-muted-foreground">Clothing store owner, Limbe</p>
          </Reveal>
        </div>
        {/* Big stat callouts */}
        <Separator className="mt-20" />
        <div className="grid gap-10 pt-16 text-center sm:grid-cols-3">
          {[
            ["5 min", "before your first sale goes through"],
            ["MK0", "extra hardware to buy"],
            ["1 screen", "for cash, card and mobile money"],
          ].map(([n, l], i) => (
            <Reveal key={n} delay={i * 100} className="transition-transform duration-300 hover:-translate-y-1">
              <p className="text-5xl font-light tracking-tight text-accent md:text-6xl">{n}</p>
              <p className="mt-2 text-muted-foreground">{l}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* What else is already inside — breadth without repeating the blocks above */}
      <section className="bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <Eyebrow>Also inside</Eyebrow>
            <h2 className="mt-3 max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
              Everything else you'd otherwise keep in a notebook.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [BarChartIcon, "Know your good days", "See what sells, what sits and what you kept after expenses — by day, by till, by store."],
              [StoreIcon, "Open a second till", "Add a counter or a whole branch and the stock, staff and takings still land in one place."],
              [BoxesIcon, "Move stock between shops", "Shift goods from the busy branch to the quiet one without losing sight of either."],
              [SmartPhone01Icon, "Your shop in your pocket", "Check today's takings from home, from the bus, or standing in the other store."],
              [WifiOffIcon, "Keeps selling when data drops", "The till holds the sale on the device and files it the moment the network returns."],
              [FlashIcon, "Receipts that look like you", "A printed or sent receipt with your shop's name on it — the thing customers come back with."],
            ].map(([Icon, t, d], i) => {
              const I = Icon as typeof FlashIcon;
              return (
                <Reveal key={t as string} delay={(i % 3) * 90} className="group">
                  <HugeiconsIcon icon={I} className="h-8 w-8 text-accent transition-transform duration-300 group-hover:-translate-y-1" />
                  <h3 className="mt-5 text-2xl font-light">{t as string}</h3>
                  <p className="mt-2 text-muted-foreground">{d as string}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* How to get started — the shortest path to a first sale */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <Reveal>
          <h2 className="max-w-3xl text-4xl font-light leading-tight tracking-tight md:text-6xl">
            From sign-up to first sale, today.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {[
            ["1", "Open your account", "Name your business and your store. No card, no waiting — the trial starts as you sign up."],
            ["2", "Put your goods in", "Type in what you sell, what it costs and what's on the shelf. Five items or five thousand."],
            ["3", "Start selling", "Open the till on any phone or laptop and ring up your first sale before the day ends."],
          ].map(([n, t, d], i) => (
            <Reveal key={n} delay={i * 120} className="group">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-xl font-light text-primary-foreground transition-transform duration-300 group-hover:scale-110">{n}</span>
              <h3 className="mt-6 text-2xl font-light">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120} className="mt-12"><Cta label="Start free trial" /></Reveal>
      </section>

      {/* Single plan: everything included, priced per store. Trial is part of it, not a tier. */}
      <section id="pricing" className="border-t border-border bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="text-center text-4xl font-light tracking-tight md:text-6xl">One plan. Pay per store.</h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground">
              Nothing is held back for a plan you haven't bought, and there is no second tier to be
              sold into later. You pay for each store you run — and the free trial comes with it.
            </p>
          </Reveal>
          <Reveal delay={160}>
            <Card className="mx-auto mt-14 max-w-3xl gap-0 rounded-3xl border-0 bg-primary p-10 text-primary-foreground shadow transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl">
              <CardHeader className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-lg font-semibold">One plan — everything in it</CardTitle>
                  <Badge className="rounded-full border-0 bg-primary-foreground/15 px-3 py-1 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary-foreground/15">
                    Free trial included
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <p className="mt-4 text-6xl font-light tracking-tight">MK{PRICES.MWK.toLocaleString()}<span className="text-lg font-medium opacity-60">/store /month</span></p>
                <p className="mt-3 text-base opacity-70">
                  One till or six — you pay per store you open, monthly. Pay for the year and keep
                  15% back, with Airtel Money, TNM Mpamba or card.
                </p>
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {planFeatures.map((x) => (
                    <li key={x} className="flex gap-3"><HugeiconsIcon icon={Tick01Icon} className="h-5 w-5 shrink-0" /> {x}</li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-10 flex-col items-start gap-3 p-0">
                <Cta label="Start free trial" invert />
                <p className="text-sm opacity-70">
                  The trial covers one store and up to 3 staff PINs. No card needed to start.
                </p>
              </CardFooter>
            </Card>
          </Reveal>
        </div>
      </section>

      <Faq />

      {/* Close — the feeling the whole page sold */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="mx-auto max-w-4xl text-5xl font-light leading-[0.95] tracking-tight md:text-7xl">Know what today made, before you close the shutter.</h2>
          </Reveal>
          <Reveal delay={140} className="mt-10 flex justify-center"><Cta label="Start free trial" invert /></Reveal>
          <Reveal delay={200}>
            <p className="mt-6 text-sm opacity-70">Free trial on your first store · No card · Stop whenever you stop trading</p>
          </Reveal>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
        <span>© {new Date().getFullYear()} Storq</span>
        <span>Your till · Your stock · Your staff</span>
      </footer>
    </div>
  );
}

function Faq() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <Reveal>
        <h2 className="text-3xl font-light tracking-tight md:text-4xl">Questions shop owners ask</h2>
      </Reveal>
      <Accordion type="single" collapsible defaultValue="faq-0" className="mt-8">
        {faqItems.map(([q, a], i) => (
          <Reveal key={q} delay={i * 70}>
            <AccordionItem value={`faq-${i}`}>
              <AccordionTrigger className="text-lg font-semibold hover:no-underline hover:text-accent">
                {q}
              </AccordionTrigger>
              <AccordionContent className="text-base leading-7 text-muted-foreground">{a}</AccordionContent>
            </AccordionItem>
          </Reveal>
        ))}
      </Accordion>
    </section>
  );
}
