import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Check,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FileCheck2,
  KeyRound,
  Layers,
  Lock,
  Smartphone,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tillpoint — POS, stock & layby for your stores" },
      {
        name: "description",
        content:
          "One login per business, a 4-digit PIN per staff member. Sell, approve invoices, run laybys and count stock across one shop or many — from any phone or laptop.",
      },
      { property: "og:title", content: "Tillpoint — POS, stock & layby for your stores" },
      {
        property: "og:description",
        content:
          "One login, staff PINs, direct-sale and approval stores, layby and stock takes — from any phone or laptop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

/* ---------------------------------- data --------------------------------- */

const features = [
  {
    icon: KeyRound,
    t: "One login, many PINs",
    d: "Sign a device in once with the business email. Every cashier, manager and admin unlocks with their own 4-digit PIN — so you always know who rang up what.",
  },
  {
    icon: Store,
    t: "Two store types",
    d: "Direct-sale stores ring up instantly. Approval-based stores send every invoice to a manager for sign-off before it counts. Each store strictly follows its own rules.",
  },
  {
    icon: Wallet,
    t: "Layby built in",
    d: "Take a deposit, reserve the stock and collect instalments until it's paid off. Balances and due dates tracked automatically — in both store types.",
  },
  {
    icon: ClipboardCheck,
    t: "Stock takes with staff",
    d: "Everyone counts on their own phone. Variances show live as you count, and a manager closes the count when it's done.",
  },
  {
    icon: Boxes,
    t: "Inventory that stays true",
    d: "Every sale, layby, approval and count moves your stock in one ledger. Set starting quantities and receive or remove stock when it arrives.",
  },
  {
    icon: Banknote,
    t: "Made for African retail",
    d: "Rand as the default currency and mobile money-friendly checkout. Runs on the phones and laptops you already own — no special hardware.",
  },
];

const stats = [
  { v: "1 login", l: "shared across every device" },
  { v: "4 digits", l: "unlocks each staff member" },
  { v: "2 store types", l: "direct sale & approval" },
  { v: "0 extra hardware", l: "phone or laptop is enough" },
];

const steps = [
  {
    icon: Lock,
    t: "Sign in once",
    d: "Enter your business email and password on the device. That's the only login you'll ever share.",
  },
  {
    icon: KeyRound,
    t: "Tap your PIN",
    d: "Each staff member unlocks with their own 4-digit PIN. The PIN sets their role — cashier, manager or admin.",
  },
  {
    icon: TrendingUp,
    t: "Start selling",
    d: "Ring up sales, create invoices, take laybys and count stock. Everything syncs back to the owner instantly.",
  },
];

const faqs = [
  {
    q: "Do I need to buy a till or card machine?",
    a: "No. Tillpoint runs in the browser on any phone, tablet or laptop. Open the site, sign in with your business email, and the device becomes a register.",
  },
  {
    q: "How do staff log in without their own email?",
    a: "You sign the device in once with the business email and password. Staff then choose their name and enter their own 4-digit PIN. The PIN decides their role and what they can do.",
  },
  {
    q: "What's the difference between the two store types?",
    a: "Direct-sale stores let cashiers complete sales immediately. Approval-based stores require another user — a manager or admin — to approve each invoice before the sale counts. Each store strictly follows its own type.",
  },
  {
    q: "Does layby work in both store types?",
    a: "Yes. Take a deposit, reserve the item and collect instalments until the balance is settled — in direct-sale and approval-based stores alike.",
  },
  {
    q: "Can staff count stock together?",
    a: "Yes. Start a stock take and every staff member counts from their own device. You see counted quantities and variances live, and a manager closes the count.",
  },
  {
    q: "What happens if a device is lost or stolen?",
    a: "Nobody can get past the PIN screen without a staff PIN, and you can change the business password or remove a staff PIN at any time from the Staff page.",
  },
];

const testimonials = [
  {
    quote:
      "The PIN system changed everything. I know exactly which cashier made every sale, and I don't have to buy anyone a laptop.",
    name: "Thandi M.",
    role: "Owner, two clothing stores",
  },
  {
    quote:
      "Approval invoices stopped stock walking out the back door. Nothing counts until a manager signs it off.",
    name: "Sipho K.",
    role: "Manager, hardware & building supplies",
  },
  {
    quote:
      "Layby used to be a book and a calculator. Now the balance, deposit and due dates are just there.",
    name: "Nomvula D.",
    role: "Owner, furniture shop",
  },
];

/* ------------------------------- components ------------------------------ */

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`flex items-center gap-2 text-lg font-extrabold tracking-tight ${dark ? "text-primary-foreground" : ""}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Boxes className="size-4" />
      </span>
      Tillpoint
    </span>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
        <Check className="size-3" strokeWidth={3} />
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

/* --------------------------------- mockups -------------------------------- */

function PinPadMock() {
  return (
    <div className="pos-card w-full max-w-[220px] p-5 shadow-pop">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Lock className="size-3.5 text-accent" /> Unlock Tillpoint
      </div>
      <div className="mt-3 text-sm font-bold">Thandi M.</div>
      <div className="mt-1 text-[11px] text-muted-foreground">Enter your 4-digit PIN</div>
      <div className="mt-3 flex gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2.5 rounded-full bg-accent" />
        ))}
        <span className="size-2.5 rounded-full border border-input" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1.5 text-center text-sm font-semibold">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <span key={k} className="pos-key grid h-9 place-items-center bg-secondary text-secondary-foreground">{k}</span>
        ))}
        <span className="grid h-9 place-items-center text-muted-foreground">C</span>
        <span className="pos-key grid h-9 place-items-center bg-secondary">0</span>
        <span className="grid h-9 place-items-center text-accent">⌫</span>
      </div>
    </div>
  );
}

function RegisterMock() {
  const tiles = [
    { n: "Sneakers", p: "R 899.00", c: "bg-tile-1" },
    { n: "Denim Jeans", p: "R 549.00", c: "bg-tile-2" },
    { n: "T-Shirt", p: "R 199.00", c: "bg-tile-3" },
    { n: "Cap", p: "R 149.00", c: "bg-tile-4" },
    { n: "Hoodie", p: "R 649.00", c: "bg-tile-5" },
    { n: "Belt", p: "R 229.00", c: "bg-tile-6" },
  ];
  return (
    <div className="pos-card w-full max-w-[380px] overflow-hidden p-0 shadow-pop">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-xs font-bold">Sandton Store · Direct sale</span>
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">Cashier: Thandi</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-3">
        {tiles.map((t) => (
          <div key={t.n} className={`pos-tile ${t.c} p-2.5 text-white`}>
            <div className="text-[11px] font-bold leading-tight">{t.n}</div>
            <div className="mt-3 text-[11px] font-semibold opacity-90 tabular">{t.p}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>2 items</span>
          <span className="tabular">R 1 448.00</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-bold">Charge</span>
          <span className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground">R 1 448.00 →</span>
        </div>
      </div>
    </div>
  );
}

function ApprovalMock() {
  return (
    <div className="pos-card w-full max-w-sm p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Invoice #1042</span>
        <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold text-warning-foreground">Awaiting approval</span>
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Cement 50kg × 10</span><span className="tabular">R 990.00</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Brick force × 4</span><span className="tabular">R 316.00</span></div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-bold">Total</span>
        <span className="text-sm font-bold tabular">R 1 306.00</span>
      </div>
      <div className="mt-4 flex gap-2">
        <span className="flex-1 rounded-lg bg-destructive/10 py-2 text-center text-xs font-bold text-destructive">Decline</span>
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-success py-2 text-xs font-bold text-success-foreground">
          <BadgeCheck className="size-3.5" /> Approve
        </span>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Eye className="size-3.5" /> Cashier Sipho · requires manager sign-off
      </div>
    </div>
  );
}

function LaybyMock() {
  return (
    <div className="pos-card w-full max-w-sm p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Layby · Sofa set</span>
        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-bold text-accent">Active</span>
      </div>
      <div className="mt-4">
        <div className="flex items-end justify-between">
          <span className="text-xs text-muted-foreground">Paid so far</span>
          <span className="text-sm font-bold tabular">R 1 800 / R 4 500</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-[40%] rounded-full bg-accent" />
        </div>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground"><Check className="size-3.5 text-success" strokeWidth={3} /> Deposit</span>
          <span className="tabular text-muted-foreground line-through">R 500</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted-foreground"><Check className="size-3.5 text-success" strokeWidth={3} /> Instalment 1</span>
          <span className="tabular text-muted-foreground line-through">R 650</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
          <span className="font-semibold">Instalment 2 · due Fri</span>
          <span className="font-bold tabular">R 650</span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- landing -------------------------------- */

function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen scroll-smooth bg-background">
      {/* nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-semibold text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#stores" className="transition-colors hover:text-foreground">Store types</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm"><Link to="/auth">Start free</Link></Button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_70%_0%,var(--accent)_0%,transparent_70%)] opacity-[0.07]" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-2 lg:pt-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              Works on any phone, tablet or laptop
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Run every till from one account.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Tillpoint turns any device into a point of sale. Staff unlock with their own 4-digit PIN, invoices get approved, laybys run themselves and stock counts itself — for one shop or many.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="xl" className="text-base">
                <Link to="/auth">Start selling free <ArrowRight className="size-4" /></Link>
              </Button>
              <Button asChild size="xl" variant="outline" className="text-base">
                <a href="#how">See how it works</a>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              No card details. No hardware. Set up your first store in minutes.
            </p>
          </div>
          <div className="relative flex items-center justify-center gap-6 lg:justify-end">
            <div className="hidden sm:block"><RegisterMock /></div>
            <div className="sm:absolute sm:-bottom-10 sm:left-2 lg:left-6"><PinPadMock /></div>
          </div>
        </div>
      </section>

      {/* stats strip */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-6 py-8 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.v} className="text-center">
              <div className="text-xl font-extrabold tracking-tight">{s.v}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
        <div className="max-w-2xl">
          <span className="text-sm font-bold uppercase tracking-widest text-accent">Everything in one place</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            The features shop owners actually ask for
          </h2>
          <p className="mt-3 text-muted-foreground">
            Built around how African retail really works — shared devices, tight stock control, and customers who pay over time.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.t} className="pos-card p-6 transition-shadow hover:shadow-pop">
              <span className="grid size-11 place-items-center rounded-xl bg-accent/10 text-accent">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="scroll-mt-20 bg-foreground/[0.03] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-bold uppercase tracking-widest text-accent">How it works</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">From box to first sale in minutes</h2>
            <p className="mt-3 text-muted-foreground">Three steps. No install, no training day, no hardware purchase.</p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.t} className="relative">
                <div className="flex items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-5xl font-extrabold tracking-tight text-muted-foreground/25">{i + 1}</span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex justify-center">
            <Button asChild size="xl" className="text-base"><Link to="/auth">Create your business account <ArrowRight className="size-4" /></Link></Button>
          </div>
        </div>
      </section>

      {/* store types */}
      <section id="stores" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold uppercase tracking-widest text-accent">Two store types</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Strict rules for every kind of shop</h2>
          <p className="mt-3 text-muted-foreground">
            Each store behaves exactly by its type — no exceptions, no workarounds.
          </p>
        </div>
        <div className="mt-12 grid items-start gap-8 lg:grid-cols-2">
          <div className="pos-card p-8">
            <span className="grid size-11 place-items-center rounded-xl bg-success/10 text-success"><Store className="size-5" /></span>
            <h3 className="mt-4 text-xl font-bold">Direct sale</h3>
            <p className="mt-2 text-sm text-muted-foreground">The classic till. Cashier taps products, charges and done.</p>
            <ul className="mt-5 space-y-3">
              <CheckItem>Sale completes the moment the customer pays</CheckItem>
              <CheckItem>Stock leaves the shelf automatically</CheckItem>
              <CheckItem>Cash up and daily totals per cashier</CheckItem>
              <CheckItem>Layby deposits and instalments on the spot</CheckItem>
            </ul>
            <div className="mt-6"><RegisterMock /></div>
          </div>
          <div className="pos-card p-8">
            <span className="grid size-11 place-items-center rounded-xl bg-accent/10 text-accent"><FileCheck2 className="size-5" /></span>
            <h3 className="mt-4 text-xl font-bold">Approval-based</h3>
            <p className="mt-2 text-sm text-muted-foreground">High-value or controlled stock. Nothing counts until someone senior signs it off.</p>
            <ul className="mt-5 space-y-3">
              <CheckItem>Cashier creates an invoice, never a final sale</CheckItem>
              <CheckItem>A manager or admin approves or declines</CheckItem>
              <CheckItem>Stock only moves once the invoice is approved</CheckItem>
              <CheckItem>Full trail of who created and who approved</CheckItem>
            </ul>
            <div className="mt-6"><ApprovalMock /></div>
          </div>
        </div>
      </section>

      {/* layby + stock take split */}
      <section className="bg-foreground/[0.03] py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
              <Wallet className="size-3.5" /> Layby
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Sell now, paid over time</h2>
            <p className="mt-3 text-muted-foreground">
              Layby is how most of your customers actually buy. Take a deposit, reserve the stock and collect instalments — the balance, due dates and history are tracked for you in both store types.
            </p>
            <ul className="mt-5 space-y-3">
              <CheckItem>Deposit locks the item and the price</CheckItem>
              <CheckItem>Every instalment recorded against the layby</CheckItem>
              <CheckItem>Stock only releases when it's fully paid</CheckItem>
            </ul>
          </div>
          <div className="flex justify-center lg:justify-end"><LaybyMock /></div>
        </div>
        <div className="mx-auto mt-20 grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <span className="inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
              <ClipboardCheck className="size-3.5" /> Stock takes
            </span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Count your whole shop, together</h2>
            <p className="mt-3 text-muted-foreground">
              Start a stock take and every staff member counts from their own device. Watch counted quantities and variances appear live, then close the count and let Tillpoint true up your inventory.
            </p>
            <ul className="mt-5 space-y-3">
              <CheckItem>Everyone counts at the same time, on their own phone</CheckItem>
              <CheckItem>Variances show as you count — not days later</CheckItem>
              <CheckItem>A manager reviews and closes the count</CheckItem>
            </ul>
          </div>
          <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
            <div className="pos-card w-full max-w-sm p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Stock take · Beverages</span>
                <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold text-warning-foreground">Counting</span>
              </div>
              <div className="mt-4 space-y-2.5 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                  <span className="font-semibold">Cola 330ml</span>
                  <span className="tabular"><span className="font-bold">48</span> <span className="text-xs text-success">/ 48 expected</span></span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                  <span className="font-semibold">Water 1L</span>
                  <span className="tabular"><span className="font-bold text-destructive">51</span> <span className="text-xs text-destructive">/ 54 expected</span></span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                  <span className="font-semibold">Energy drink</span>
                  <span className="tabular"><span className="font-bold">—</span> <span className="text-xs text-muted-foreground">not counted</span></span>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Smartphone className="size-3.5" /> 3 staff counting on their own devices
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* testimonials */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold uppercase tracking-widest text-accent">Trusted by owners</span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Built for how you already run things</h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure key={t.name} className="pos-card flex flex-col p-6">
              <Layers className="size-5 text-accent" />
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed">“{t.quote}”</blockquote>
              <figcaption className="mt-5 border-t border-border pt-4">
                <div className="text-sm font-bold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.role}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="scroll-mt-20 bg-foreground/[0.03] py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <span className="text-sm font-bold uppercase tracking-widest text-accent">FAQ</span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Questions, answered</h2>
          </div>
          <div className="mt-10 space-y-3">
            {faqs.map((f, i) => (
              <div key={f.q} className="pos-card overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-bold"
                >
                  {f.q}
                  <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
                </button>
                {openFaq === i && (
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-16 text-center text-primary-foreground">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_80%_10%,var(--accent)_0%,transparent_70%)] opacity-40" />
          <div className="relative">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Your first sale is minutes away</h2>
            <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
              Create your business account, add your staff PINs and start selling from the devices you already own.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="xl" variant="secondary" className="text-base">
                <Link to="/auth">Start free <ArrowRight className="size-4" /></Link>
              </Button>
              <Button asChild size="xl" variant="outline" className="border-primary-foreground/30 bg-transparent text-base text-primary-foreground hover:bg-primary-foreground/10">
                <Link to="/auth">Sign in to your business</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-primary-foreground/70">Free to set up · No hardware · Works offline-friendly on mobile</p>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
          <Logo />
          <nav className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#stores" className="hover:text-foreground">Store types</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
            <Link to="/auth" className="hover:text-foreground">Sign in</Link>
          </nav>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Tillpoint. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
