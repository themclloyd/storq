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
import {
  ArrowRight01Icon,
  Tick01Icon,
  SmartPhone01Icon,
  WifiOffIcon,
  ShieldCheckIcon,
  FlashIcon,
  StoreIcon,
  BoxesIcon,
  UserMultipleIcon,
  BarChartIcon,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { PRICES } from "@/lib/billing";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { buildSeo, absUrl, SITE_NAME } from "@/lib/seo";
import heroShop from "@/assets/hero-shop.jpg";
import counter from "@/assets/counter.jpg";
import stocktake from "@/assets/stocktake.jpg";
import storeClothing from "@/assets/store-clothing.jpg";
import storeGrocery from "@/assets/store-grocery.jpg";
import storeHardware from "@/assets/store-hardware.jpg";
import ownerPortrait from "@/assets/owner-portrait.jpg";

/** What the one plan unlocks — outcomes an owner buys, not module names. */
const planFeatureKeys = [
  "marketing.feat1",
  "marketing.feat2",
  "marketing.feat3",
  "marketing.feat4",
  "marketing.feat5",
  "marketing.feat6",
];

// FAQ questions/answers rendered from the catalog. `faqItems` below stays English
// for the SEO JSON-LD (search indexers expect a single canonical language).
const faqKeys: [string, string][] = [
  ["marketing.faq1Q", "marketing.faq1A"],
  ["marketing.faq2Q", "marketing.faq2A"],
  ["marketing.faq3Q", "marketing.faq3A"],
  ["marketing.faq4Q", "marketing.faq4A"],
  ["marketing.faq5Q", "marketing.faq5A"],
  ["marketing.faq6Q", "marketing.faq6A"],
];

const faqItems: [string, string][] = [
  [
    "What does it cost?",
    `MK${PRICES.MWK.toLocaleString("en-US")} a month for each store you run — that is the whole plan, with every feature in it. Your first store runs free on the trial, and you pay by Airtel Money, TNM Mpamba or card.`,
  ],
  [
    "Do I need to buy hardware?",
    "No. Storq runs in the browser on the Android phone, tablet or laptop you already own — no till machine, no barcode gun, and light enough to run on everyday data.",
  ],
  [
    "Can my staff see my money?",
    "Only what you allow. Each person opens the till with their own 4-digit PIN, and that PIN decides what they can do: cashiers sell, managers approve, and costs and reports stay with you.",
  ],
  [
    "What happens when the internet goes off?",
    "At a direct-sale till the counter keeps working — sales are held on the device and file themselves as soon as the connection is back, so an outage never turns a customer away.",
  ],
  [
    "Can I run more than one shop?",
    "Yes. Add a store the day you open it. Each one keeps its own stock and staff, and you see all of them from the same phone.",
  ],
  [
    "Can my customer pay how they want?",
    "Cash, card, Airtel Money or TNM Mpamba — taken at the counter and on every layby instalment, so the drawer always matches what the day sold.",
  ],
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
      offers: {
        "@type": "AggregateOffer",
        lowPrice: "60000",
        priceCurrency: "MWK",
        offerCount: "1",
      },
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
      title: "Storq POS | Know your stock, your profit, your whole business",
      description:
        "Keep your till, your stock and your staff in order from the phone in your pocket, and see the real profit behind every sale before you close. One plan at MK60,000 per store, free trial included.",
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
  const style = useMemo<CSSProperties>(
    () => (delay ? { transitionDelay: `${delay}ms` } : {}),
    [delay],
  );

  return (
    <Tag
      ref={ref as never}
      style={style}
      className={cn("reveal", inView && "is-visible", className)}
    >
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

function Cta({ label, invert = false }: { label?: string; invert?: boolean }) {
  const { t } = useI18n();
  return (
    <Button
      asChild
      size="lg"
      variant={invert ? "secondary" : "default"}
      className="group/cta h-14 rounded-lg px-8 text-base font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
    >
      <Link to="/auth">
        {label ?? t("marketing.trial")}{" "}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="ml-1 h-5 w-5 transition-transform duration-200 group-hover/cta:translate-x-1"
        />
      </Link>
    </Button>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Badge className="rounded-full border-0 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent hover:bg-accent/10">
      {children}
    </Badge>
  );
}

function Landing() {
  const { t } = useI18n();
  return (
    <div className="storq-landing min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link to="/" className="font-display flex items-center gap-2 text-lg tracking-tight">
            <img src="/logo.svg" alt="Storq logo" className="h-8 w-8 rounded-lg" />
            Storq
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
            {[
              ["#shops", "marketing.navShops"],
              ["#features", "marketing.navFeatures"],
              ["#layby", "marketing.navLayby"],
              ["#pricing", "marketing.navPricing"],
            ].map(([href, labelKey]) => (
              <a
                key={href}
                href={href}
                className="nav-link text-muted-foreground transition-colors hover:text-accent"
              >
                {t(labelKey as string)}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="mr-1" />
            <Button asChild variant="ghost" className="hidden rounded-lg sm:inline-flex">
              <Link to="/auth">{t("marketing.logIn")}</Link>
            </Button>
            <Button
              asChild
              className="rounded-lg px-5 font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            >
              <Link to="/auth">{t("marketing.trial")}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero — the owner's wish, not the product's name */}
      <section className="mx-auto max-w-7xl px-6 pb-16 pt-16 text-center md:pt-24">
        <Rise>
          <Eyebrow>{t("marketing.heroEyebrow")}</Eyebrow>
        </Rise>
        <Rise delay={80}>
          <h1 className="font-hero mx-auto mt-4 max-w-4xl text-5xl leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
            {t("marketing.heroH1")}
          </h1>
        </Rise>
        <Rise delay={160}>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            {t("marketing.heroLead")}
          </p>
        </Rise>
        <Rise delay={240} className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Cta />
          <Button
            asChild
            size="lg"
            variant="outline"
            className="group/cta h-14 rounded-lg px-8 text-base font-semibold transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
          >
            <a href="#features">
              {t("marketing.seeHow")}{" "}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="ml-1 h-5 w-5 transition-transform duration-200 group-hover/cta:translate-x-1"
              />
            </a>
          </Button>
        </Rise>
        <Rise delay={300}>
          <p className="mt-4 text-sm text-muted-foreground">{t("marketing.heroNote")}</p>
        </Rise>
        <Rise delay={120} className="relative mt-14 overflow-hidden rounded-3xl">
          <img
            src={heroShop}
            alt="Shop owner ringing up a sale on Storq"
            width={1600}
            height={1104}
            fetchPriority="high"
            decoding="async"
            className="h-[460px] w-full object-cover md:h-[620px] transition-transform duration-700 ease-out hover:scale-[1.02]"
          />
          <Card className="absolute bottom-5 left-5 gap-0 rounded-2xl border-0 bg-card/95 p-5 text-left backdrop-blur transition-transform duration-300 hover:-translate-y-1 md:bottom-8 md:left-8">
            <CardDescription className="text-xs font-medium">
              {t("marketing.heroTakings")}
            </CardDescription>
            <p className="font-display tabular mt-1 text-3xl">MK5,910</p>
            <p className="text-sm font-semibold text-success">{t("marketing.heroTrend")}</p>
          </Card>
        </Rise>
      </section>

      {/* Who it's for — the owner sees their own shop, not a segment list */}
      <section id="shops" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="font-display max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">
              {t("marketing.shopsH2")}
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              {t("marketing.shopsLead")}
            </p>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                img: storeClothing,
                label: "marketing.shopClothing",
                note: "marketing.shopClothingNote",
              },
              {
                img: storeGrocery,
                label: "marketing.shopGrocery",
                note: "marketing.shopGroceryNote",
              },
              {
                img: storeHardware,
                label: "marketing.shopHardware",
                note: "marketing.shopHardwareNote",
              },
              {
                img: ownerPortrait,
                label: "marketing.shopBetween",
                note: "marketing.shopBetweenNote",
              },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 90}>
                <div className="group relative overflow-hidden rounded-3xl">
                  <img
                    src={s.img}
                    alt={t(s.label)}
                    loading="lazy"
                    width={800}
                    height={1008}
                    className="aspect-[4/5] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/70 to-transparent p-6 pt-16">
                    <p className="flex items-center gap-2 text-lg font-light text-background">
                      {t(s.label)}
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className="h-4 w-4 -translate-x-2 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100"
                      />
                    </p>
                    <p className="mt-1 text-sm leading-6 text-background/75">{t(s.note)}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Feature: checkout — what a good day at the counter feels like */}
      <section
        id="features"
        className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2"
      >
        <Reveal>
          <img
            src={counter}
            alt="Cashier completing a sale"
            loading="lazy"
            width={1200}
            height={1200}
            className="aspect-square w-full rounded-3xl object-cover transition-transform duration-700 ease-out hover:scale-[1.02]"
          />
        </Reveal>
        <Reveal delay={120}>
          <Eyebrow>{t("marketing.counterEyebrow")}</Eyebrow>
          <h2 className="font-display mt-3 text-4xl leading-tight tracking-tight md:text-6xl">
            {t("marketing.counterH2")}
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">{t("marketing.counterLead")}</p>
          <ul className="mt-8 space-y-4">
            {["marketing.counter1", "marketing.counter2", "marketing.counter3"].map((k, i) => (
              <Reveal
                as="li"
                key={k}
                delay={200 + i * 90}
                className="flex gap-3 text-base transition-colors hover:text-accent"
              >
                <HugeiconsIcon icon={Tick01Icon} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />{" "}
                {t(k)}
              </Reveal>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* Control — the peace of mind that lets an owner leave the counter */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="font-display max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">
              {t("marketing.controlH2")}
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-5 max-w-2xl text-lg opacity-70">{t("marketing.controlLead")}</p>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            <Reveal>
              <Card className="group gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 ring-1 ring-primary-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary-foreground/10 hover:ring-primary-foreground/25">
                <CardHeader className="gap-0 p-0">
                  <HugeiconsIcon
                    icon={UserMultipleIcon}
                    className="h-8 w-8 transition-transform duration-300 group-hover:scale-110"
                  />
                  <CardTitle className="font-display mt-6 text-3xl">
                    {t("marketing.controlPin")}
                  </CardTitle>
                  <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                    {t("marketing.controlPinDesc")}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
            <Reveal delay={100}>
              <Card className="group gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 ring-1 ring-primary-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary-foreground/10 hover:ring-primary-foreground/25">
                <CardHeader className="gap-0 p-0">
                  <HugeiconsIcon
                    icon={ShieldCheckIcon}
                    className="h-8 w-8 transition-transform duration-300 group-hover:scale-110"
                  />
                  <CardTitle className="font-display mt-6 text-3xl">
                    {t("marketing.controlOk")}
                  </CardTitle>
                  <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                    {t("marketing.controlOkDesc")}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Reveal>
            <Reveal delay={200}>
              <Card className="group gap-0 rounded-3xl border-0 bg-primary-foreground/5 p-10 ring-1 ring-primary-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:bg-primary-foreground/10 hover:ring-primary-foreground/25">
                <CardHeader className="gap-0 p-0">
                  <HugeiconsIcon
                    icon={BoxesIcon}
                    className="h-8 w-8 transition-transform duration-300 group-hover:scale-110"
                  />
                  <CardTitle className="font-display mt-6 text-3xl">
                    {t("marketing.controlStock")}
                  </CardTitle>
                  <CardDescription className="mt-3 text-base leading-7 text-primary-foreground/70">
                    {t("marketing.controlStockDesc")}
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
          <img
            src={stocktake}
            alt="Manager counting stock on his phone"
            loading="lazy"
            width={1200}
            height={1200}
            className="aspect-square w-full rounded-3xl object-cover transition-transform duration-700 ease-out hover:scale-[1.02]"
          />
        </Reveal>
        <Reveal delay={120}>
          <Eyebrow>{t("marketing.stockEyebrow")}</Eyebrow>
          <h2 className="font-display mt-3 text-4xl leading-tight tracking-tight md:text-6xl">
            {t("marketing.stockH2")}
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">{t("marketing.stockLead")}</p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <Card className="gap-0 rounded-2xl border-0 bg-muted p-6 transition-colors duration-300 hover:bg-accent/10">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="font-display text-3xl">{t("marketing.stockSells")}</CardTitle>
                <CardDescription>{t("marketing.stockSellsDesc")}</CardDescription>
              </CardHeader>
            </Card>
            <Card className="gap-0 rounded-2xl border-0 bg-muted p-6 transition-colors duration-300 hover:bg-accent/10">
              <CardHeader className="gap-1 p-0">
                <CardTitle className="font-display text-3xl">{t("marketing.stockLow")}</CardTitle>
                <CardDescription>{t("marketing.stockLowDesc")}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </Reveal>
      </section>

      {/* Layby — the sale you would otherwise send away */}
      <section id="layby" className="bg-muted">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-24 md:grid-cols-2">
          <Reveal>
            <Eyebrow>{t("marketing.laybyEyebrow")}</Eyebrow>
            <h2 className="font-display mt-3 text-4xl leading-tight tracking-tight md:text-6xl">
              {t("marketing.laybyH2")}
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">{t("marketing.laybyLead")}</p>
            <div className="mt-8">
              <Cta />
            </div>
          </Reveal>
          <Reveal delay={120}>
            <Card className="gap-0 rounded-3xl border-0 p-8 transition-transform duration-500 ease-out hover:-translate-y-1.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardDescription>{t("marketing.laybyRef")}</CardDescription>
                  <CardTitle className="font-display mt-1 text-2xl">
                    {t("marketing.laybyItem")}
                  </CardTitle>
                </div>
                <Badge className="shrink-0 rounded-full border-0 bg-success/15 px-3 py-1 text-xs font-semibold text-success hover:bg-success/15">
                  {t("marketing.laybyOnTrack")}
                </Badge>
              </div>
              <AnimatedProgress value={62} />
              <div className="mt-3 flex justify-between text-sm">
                <span className="font-semibold">{t("marketing.laybyPaid")}</span>
                <span className="text-muted-foreground">{t("marketing.laybyLeft")}</span>
              </div>
              <Separator className="mt-6" />
              <div className="mt-6 space-y-3 text-sm">
                {[
                  ["12 Sep", "marketing.laybyDeposit", "MK2,000"],
                  ["26 Sep", "marketing.laybyMobile", "MK1,950"],
                  ["03 Oct", "marketing.laybyCard", "MK2,000"],
                ].map(([d, mKey, a], i) => (
                  <Reveal
                    key={d}
                    delay={200 + i * 100}
                    className="flex justify-between transition-colors hover:text-accent"
                  >
                    <span className="text-muted-foreground">
                      {d} · {t(mKey as string)}
                    </span>
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
            <img
              src={ownerPortrait}
              alt="Shop owner in her store"
              loading="lazy"
              width={800}
              height={1008}
              className="aspect-[4/5] w-full rounded-3xl object-cover transition-transform duration-700 ease-out hover:scale-[1.02]"
            />
          </Reveal>
          <Reveal delay={120} className="md:col-span-3">
            <Eyebrow>{t("marketing.storyEyebrow")}</Eyebrow>
            <blockquote className="font-display mt-6 text-3xl leading-snug tracking-tight md:text-4xl">
              {t("marketing.storyQuote")}
            </blockquote>
            <p className="mt-6 text-lg font-semibold">Chisomo B.</p>
            <p className="text-muted-foreground">{t("marketing.storyRole")}</p>
          </Reveal>
        </div>
        {/* Big stat callouts */}
        <Separator className="mt-20" />
        <div className="grid gap-10 pt-16 text-center sm:grid-cols-3">
          {[
            ["5 min", "marketing.storyStat1"],
            ["MK0", "marketing.storyStat2"],
            ["1 screen", "marketing.storyStat3"],
          ].map(([n, labelKey], i) => (
            <Reveal
              key={n}
              delay={i * 100}
              className="transition-transform duration-300 hover:-translate-y-1"
            >
              <p className="font-display tabular text-5xl tracking-tight text-accent md:text-6xl">
                {n}
              </p>
              <p className="mt-2 text-muted-foreground">{t(labelKey as string)}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* What else is already inside — breadth without repeating the blocks above */}
      <section className="bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <Eyebrow>{t("marketing.insideEyebrow")}</Eyebrow>
            <h2 className="font-display mt-3 max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">
              {t("marketing.insideH2")}
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [BarChartIcon, "marketing.inside1", "marketing.inside1Desc"],
              [StoreIcon, "marketing.inside2", "marketing.inside2Desc"],
              [BoxesIcon, "marketing.inside3", "marketing.inside3Desc"],
              [SmartPhone01Icon, "marketing.inside4", "marketing.inside4Desc"],
              [WifiOffIcon, "marketing.inside5", "marketing.inside5Desc"],
              [FlashIcon, "marketing.inside6", "marketing.inside6Desc"],
            ].map(([Icon, tKey, dKey], i) => {
              const I = Icon as typeof FlashIcon;
              return (
                <Reveal key={tKey as string} delay={(i % 3) * 90} className="group">
                  <HugeiconsIcon
                    icon={I}
                    className="h-8 w-8 text-accent transition-transform duration-300 group-hover:-translate-y-1"
                  />
                  <h3 className="font-display mt-5 text-2xl">{t(tKey as string)}</h3>
                  <p className="mt-2 text-muted-foreground">{t(dKey as string)}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* How to get started — the shortest path to a first sale */}
      <section className="mx-auto max-w-7xl px-6 py-24">
        <Reveal>
          <h2 className="font-display max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">
            {t("marketing.startH2")}
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-10 md:grid-cols-3">
          {[
            ["1", "marketing.start1", "marketing.start1Desc"],
            ["2", "marketing.start2", "marketing.start2Desc"],
            ["3", "marketing.start3", "marketing.start3Desc"],
          ].map(([n, tKey, dKey], i) => (
            <Reveal key={n} delay={i * 120} className="group">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary text-xl font-light text-primary-foreground transition-transform duration-300 group-hover:scale-110">
                {n}
              </span>
              <h3 className="font-display mt-6 text-2xl">{t(tKey as string)}</h3>
              <p className="mt-2 text-muted-foreground">{t(dKey as string)}</p>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120} className="mt-12">
          <Cta />
        </Reveal>
      </section>

      {/* Single plan: everything included, priced per store. Trial is part of it, not a tier. */}
      <section id="pricing" className="border-t border-border bg-muted">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="font-display text-center text-4xl tracking-tight md:text-6xl">
              {t("marketing.pricingH2")}
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground">
              {t("marketing.pricingLead")}
            </p>
          </Reveal>
          <Reveal delay={160}>
            <Card className="mx-auto mt-14 max-w-3xl gap-0 rounded-3xl border-0 bg-primary p-10 text-primary-foreground transition-all duration-300 hover:-translate-y-1.5">
              <CardHeader className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="font-display text-lg">
                    {t("marketing.pricingCardTitle")}
                  </CardTitle>
                  <Badge className="rounded-full border-0 bg-primary-foreground/15 px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary-foreground/15">
                    {t("marketing.pricingTrialBadge")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <p className="font-display tabular mt-4 text-6xl tracking-tight">
                  MK{PRICES.MWK.toLocaleString("en-US")}
                  <span className="text-lg font-medium opacity-60">
                    {t("marketing.pricingPerStore")}
                  </span>
                </p>
                <p className="mt-3 text-base opacity-70">{t("marketing.pricingNote")}</p>
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {planFeatureKeys.map((x) => (
                    <li key={x} className="flex gap-3">
                      <HugeiconsIcon icon={Tick01Icon} className="h-5 w-5 shrink-0" /> {t(x)}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-10 flex-col items-start gap-3 p-0">
                <Cta invert />
                <p className="text-sm opacity-70">{t("marketing.pricingFoot")}</p>
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
            <h2 className="font-display mx-auto max-w-4xl text-5xl leading-[0.95] tracking-tight md:text-7xl">
              {t("marketing.closeH2")}
            </h2>
          </Reveal>
          <Reveal delay={140} className="mt-10 flex justify-center">
            <Cta invert />
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-6 text-sm opacity-70">{t("marketing.closeFoot")}</p>
          </Reveal>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
        <span>© {new Date().getFullYear()} Storq</span>
        <span>{t("marketing.footerTag")}</span>
      </footer>
    </div>
  );
}

function Faq() {
  const { t } = useI18n();
  const price = PRICES.MWK.toLocaleString("en-US");
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <Reveal>
        <h2 className="font-display text-3xl tracking-tight md:text-4xl">{t("marketing.faqH2")}</h2>
      </Reveal>
      <Accordion type="single" collapsible defaultValue="faq-0" className="mt-8">
        {faqKeys.map(([qKey, aKey], i) => (
          <Reveal key={qKey} delay={i * 70}>
            <AccordionItem value={`faq-${i}`}>
              <AccordionTrigger className="text-lg font-semibold hover:no-underline hover:text-accent">
                {t(qKey)}
              </AccordionTrigger>
              <AccordionContent className="text-base leading-7 text-muted-foreground">
                {t(aKey, { price })}
              </AccordionContent>
            </AccordionItem>
          </Reveal>
        ))}
      </Accordion>
    </section>
  );
}
