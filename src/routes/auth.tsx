import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { BoxesIcon } from "@hugeicons/core-free-icons";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/pos/bits";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Storq" },
      { name: "description", content: "Sign this device in to your business account." },
      { property: "og:title", content: "Sign in — Storq" },
      { property: "og:description", content: "Sign this device in to your business account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: "/app" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        if (data.session) nav({ to: "/app" });
        else setSent(true);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="storq-workspace flex min-h-screen flex-col px-6 py-8 sm:px-12">
      <div className="flex items-center gap-3 text-2xl font-semibold">
        <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><HugeiconsIcon icon={BoxesIcon} className="size-5" /></span>
        Storq
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16">
        <div className="mb-8 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-accent" /> Business account
        </div>
        {sent ? (
          <div>
            <h1 className="text-xl font-bold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">We sent a confirmation link to {email}. Open it on this device to continue.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div className="pb-4">
              <h1 className="text-3xl font-semibold">{mode === "in" ? "Welcome back." : "Create your account."}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">One account for your business. Your staff PIN comes next.</p>
            </div>
            <Field label="Business email"><Input className="h-12 bg-card" autoComplete="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><Input className="h-12 bg-card" autoComplete={mode === "in" ? "current-password" : "new-password"} type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button className="h-12 w-full" size="lg" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</Button>
            <Button variant="link" type="button" className="h-auto w-full whitespace-normal text-sm font-medium text-muted-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "New business? Create an account" : "Already have an account? Sign in"}
            </Button>
          </form>
        )}
      </div>
      <div className="text-xs text-muted-foreground">Storq · Business workspace</div>
    </div>
  );
}
