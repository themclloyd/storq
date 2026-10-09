import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LIMITS, validateEmail, validatePassword } from "@/lib/validate";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Storq" },
      { name: "description", content: "Sign this device in to your Storq business account." },
      { name: "robots", content: "noindex, nofollow" },
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
    // Client-side standards first so the user sees a readable message; the
    // database enforces the same bounds again server-side.
    const emailErr = validateEmail(email);
    if (emailErr) {
      toast.error(emailErr);
      return;
    }
    if (mode === "up") {
      const pwErr = validatePassword(password);
      if (pwErr) {
        toast.error(pwErr);
        return;
      }
    } else if (!password) {
      toast.error("Password is required");
      return;
    }
    setBusy(true);
    const cleanEmail = email.trim();
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error) throw error;
        nav({ to: "/app" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        if (data.session) nav({ to: "/app" });
        else setSent(true);
      }
    } catch (err) {
      // Surpass raw server wording but stay helpful for genuine failures.
      toast.error(
        /rate limit|too many/i.test((err as Error).message)
          ? "Too many attempts — try again in a moment."
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col px-6 py-8 sm:px-12">
      <div className="flex items-center gap-3 text-2xl font-semibold">
        <img src="/logo.svg" alt="Storq logo" className="size-10 rounded-lg" />
        Storq
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16">
        <Badge
          variant="secondary"
          className="mb-8 w-fit gap-2 rounded-full border-0 bg-accent/10 px-3 py-1 text-xs font-medium text-accent shadow-none"
        >
          <span className="size-1.5 rounded-full bg-accent" /> Business account
        </Badge>
        {sent ? (
          <Alert>
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              We sent a confirmation link to {email}. Open it on this device to continue.
            </AlertDescription>
          </Alert>
        ) : (
          <Card className="gap-0 shadow-card">
            <CardHeader className="gap-2">
              <CardTitle className="text-3xl font-semibold">
                {mode === "in" ? "Welcome back." : "Create your account."}
              </CardTitle>
              <CardDescription className="text-sm leading-6">
                One account for your business. Your staff PIN comes next.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-6">
                <div className="space-y-2">
                  <Label
                    htmlFor="business-email"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Business email
                  </Label>
                  <Input
                    id="business-email"
                    className="h-12"
                    autoComplete="email"
                    type="email"
                    required
                    maxLength={LIMITS.email}
                    value={email}
                    onChange={(e) => setEmail(e.target.value.slice(0, LIMITS.email))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                    Password
                  </Label>
                  <Input
                    id="password"
                    className="h-12"
                    autoComplete={mode === "in" ? "current-password" : "new-password"}
                    type="password"
                    required
                    maxLength={LIMITS.password}
                    value={password}
                    onChange={(e) => setPassword(e.target.value.slice(0, LIMITS.password))}
                  />
                  {mode === "up" && (
                    <p className="text-xs text-muted-foreground">
                      At least 8 characters with one letter and one number.
                    </p>
                  )}
                </div>
                <Button className="h-12 w-full" size="lg" disabled={busy}>
                  {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-4">
              <Separator />
              <Button
                variant="link"
                type="button"
                className="h-auto w-full whitespace-normal text-sm font-medium text-muted-foreground"
                onClick={() => setMode(mode === "in" ? "up" : "in")}
              >
                {mode === "in"
                  ? "New business? Create an account"
                  : "Already have an account? Sign in"}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
      <div className="text-xs text-muted-foreground">Storq · Business workspace</div>
    </div>
  );
}
