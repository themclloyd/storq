import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Boxes } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/pos/bits";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Tillpoint" },
      { name: "description", content: "Sign this device in to your business account." },
      { property: "og:title", content: "Sign in — Tillpoint" },
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
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="pos-card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2 text-lg font-extrabold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Boxes className="size-4" /></span>
          Tillpoint
        </div>
        {sent ? (
          <div>
            <h1 className="text-xl font-bold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">We sent a confirmation link to {email}. Open it on this device to continue.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-xl font-bold">{mode === "in" ? "Sign in this device" : "Create business account"}</h1>
              <p className="mt-1 text-sm text-muted-foreground">One email & password for the whole business. Staff use their PIN after this.</p>
            </div>
            <Field label="Business email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button className="w-full" size="lg" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</Button>
            <button type="button" className="w-full text-sm font-medium text-accent" onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "New business? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
