import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Boxes, ClipboardCheck, KeyRound, Store, Wallet } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tillpoint — POS, stock & layby for your stores" },
      { name: "description", content: "One login per business, a 4-digit PIN per staff member. Sell, approve invoices, run laybys and count stock across stores." },
      { property: "og:title", content: "Tillpoint — POS, stock & layby for your stores" },
      { property: "og:description", content: "One login, staff PINs, direct-sale and approval stores, layby and stock takes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: KeyRound, t: "One login, many PINs", d: "Sign the device in once. Every cashier, manager and admin unlocks with their own 4-digit PIN." },
  { icon: Store, t: "Two store types", d: "Direct-sale stores ring up instantly. Approval stores send invoices for a second person to approve." },
  { icon: Wallet, t: "Layby built in", d: "Take a deposit, reserve the stock, collect instalments until it is paid off." },
  { icon: ClipboardCheck, t: "Stock takes with staff", d: "Everyone counts on their own phone. Variances show live, managers close the count." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Boxes className="size-4" /></span>
          Tillpoint
        </div>
        <Button asChild variant="outline"><Link to="/auth">Sign in</Link></Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-12">
        <h1 className="max-w-3xl text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
          Run every till from one account.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Sales, stock, layby and stock takes for one shop or many. Any phone or laptop becomes a register — staff just tap their PIN.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="xl"><Link to="/auth">Start free</Link></Button>
          <Button asChild size="xl" variant="outline"><Link to="/app">Open register</Link></Button>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.t} className="pos-card p-6">
              <f.icon className="size-6 text-accent" />
              <h3 className="mt-4 font-bold">{f.t}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
