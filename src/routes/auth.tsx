import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "recover">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | "signup" | "reset">(null);

  // When a reset-link lands here, supabase-js reads the token from the URL and
  // fires PASSWORD_RECOVERY; flip into the set-new-password step so it isn't lost.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSent(null);
        setMode("recover");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Client-side standards first so the user sees a readable message; the
    // database enforces the same bounds again server-side.
    if (mode !== "recover") {
      const emailErr = validateEmail(email);
      if (emailErr) {
        toast.error(emailErr);
        return;
      }
    }
    if (mode === "up" || mode === "recover") {
      const pwErr = validatePassword(password);
      if (pwErr) {
        toast.error(pwErr);
        return;
      }
    } else if (mode === "in" && !password) {
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
      } else if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        if (data.session) nav({ to: "/app" });
        else setSent("signup");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: window.location.origin + "/auth",
        });
        if (error) throw error;
        setSent("reset");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated — you're signed in.");
        nav({ to: "/app" });
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
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-2xl font-semibold">
          <img src="/logo.svg" alt="Storq logo" className="size-10 rounded-lg" />
          Storq
        </div>
        {(mode === "in" || mode === "up") && (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {mode === "in" ? "New to Storq?" : "Already have an account?"}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPassword("");
                setMode(mode === "in" ? "up" : "in");
              }}
            >
              {mode === "in" ? "Create account" : "Sign in"}
            </Button>
          </div>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16">
        {sent ? (
          <div className="space-y-4">
            <Alert>
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>
                {sent === "reset"
                  ? `We sent a password reset link to ${email}. Open it on this device to choose a new password.`
                  : `We sent a confirmation link to ${email}. Open it on this device to continue.`}
              </AlertDescription>
            </Alert>
            {sent === "reset" && (
              <Button
                variant="link"
                type="button"
                className="h-auto px-0 text-sm font-medium text-muted-foreground"
                onClick={() => {
                  setSent(null);
                  setMode("in");
                }}
              >
                Back to sign in
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold">
                {mode === "in"
                  ? "Welcome back."
                  : mode === "up"
                    ? "Create your account."
                    : mode === "forgot"
                      ? "Reset your password."
                      : "Choose a new password."}
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                {mode === "recover"
                  ? "Pick a strong password for your business account."
                  : mode === "forgot"
                    ? "We'll email you a secure link to set a new password."
                    : "One account for your business. Your staff PIN comes next."}
              </p>
            </div>
            <form onSubmit={submit} className="space-y-6">
              {mode !== "recover" && (
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
              )}
              {mode !== "forgot" && (
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
                  {(mode === "up" || mode === "recover") && (
                    <p className="text-xs text-muted-foreground">
                      At least 8 characters with one letter and one number.
                    </p>
                  )}
                </div>
              )}
              <Button className="h-12 w-full" size="lg" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "in"
                    ? "Sign in"
                    : mode === "up"
                      ? "Create account"
                      : mode === "forgot"
                        ? "Send reset link"
                        : "Update password"}
              </Button>
              {mode === "in" && (
                <Button
                  variant="link"
                  type="button"
                  className="h-auto px-0 text-sm font-medium text-muted-foreground"
                  onClick={() => {
                    setPassword("");
                    setMode("forgot");
                  }}
                >
                  Forgot password?
                </Button>
              )}
              {mode === "forgot" && (
                <Button
                  variant="link"
                  type="button"
                  className="h-auto px-0 text-sm font-medium text-muted-foreground"
                  onClick={() => {
                    setPassword("");
                    setMode("in");
                  }}
                >
                  Back to sign in
                </Button>
              )}
            </form>
          </div>
        )}
      </main>
      <div className="text-xs text-muted-foreground">Storq · Business workspace</div>
    </div>
  );
}
