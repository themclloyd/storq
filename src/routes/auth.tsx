import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIMITS, validateEmail, validatePassword, validatePasswordInput } from "@/lib/validate";
import {
  PASSWORD_BACKOFF,
  clearGate,
  formatWait,
  gateRemaining,
  noteFailure,
  noteWait,
} from "@/lib/attempt-gate";
import { landingRouteFor } from "@/lib/ops";
import { publicAppUrl } from "@/lib/desktop";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";

import { redirect } from "@tanstack/react-router";
import { currentUserId } from "@/lib/auth-session";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in | Storq" },
      { name: "description", content: "Sign this device in to your Storq business account." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const userId = await currentUserId();
    if (userId) throw redirect({ to: await landingRouteFor() });
  },
  component: AuthPage,
});

function AuthPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "recover">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | "signup" | "reset">(null);
  const [wait, setWait] = useState(0);
  const turnstile = useRef<TurnstileHandle>(null);

  // One gate per action + address. The server (Supabase Auth) is the real
  // limiter; this stops one browser from hammering the credential endpoint and
  // survives a reload so F5 does not reset the countdown.
  const scope =
    mode === "recover"
      ? ""
      : `${mode === "in" ? "signin" : mode === "up" ? "signup" : "reset"}:${email.trim().toLowerCase()}`;

  useEffect(() => {
    setWait(scope ? gateRemaining(scope) : 0);
  }, [scope]);

  useEffect(() => {
    if (wait <= 0 || !scope) return;
    const id = setInterval(() => setWait(gateRemaining(scope)), 1_000);
    return () => clearInterval(id);
  }, [wait, scope]);

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
    } else if (mode === "in") {
      // Sign-in keeps the bar low (any real credential must still work) but the
      // always-on bounds apply: 72 bytes, no control characters, and no value
      // that is a whole JSON document or SQL statement.
      const pwErr = validatePasswordInput(password);
      if (pwErr) {
        toast.error(pwErr);
        return;
      }
    }
    // Refuse locally while cooling off: no request leaves the browser.
    const remaining = scope ? gateRemaining(scope) : 0;
    if (remaining > 0) {
      setWait(remaining);
      toast.error(t("errors.tooManyAttempts"));
      return;
    }
    setBusy(true);
    const cleanEmail = email.trim();
    // Credential endpoints (not the authenticated password-update step) prove a
    // human, not a bot, before the request goes out. Tokens are single-use, so a
    // fresh challenge is drawn on every attempt once CAPTCHA is configured.
    let captchaToken: string | undefined;
    if (TURNSTILE_SITE_KEY && mode !== "recover") {
      captchaToken = (await turnstile.current?.getToken()) || undefined;
    }
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
          options: { ...(captchaToken ? { captchaToken } : {}) },
        });
        if (error) throw error;
        // A platform operator owns no business, so /app would dead-end on setup;
        // the probe is one cheap RPC and fails open to the workspace.
        clearGate(scope);
        nav({ to: await landingRouteFor() });
      } else if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            // A confirmation link is opened in a real browser, so it must point
            // at the website: inside the installed app the page origin is
            // `tauri.localhost`, which no mail client can reach.
            emailRedirectTo: publicAppUrl("/app"),
            ...(captchaToken ? { captchaToken } : {}),
          },
        });
        if (error) throw error;
        if (data.session) nav({ to: "/app" });
        else setSent("signup");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: publicAppUrl("/auth"),
          ...(captchaToken ? { captchaToken } : {}),
        });
        if (error) throw error;
        // Keep a send button from turning into a reset-mail cannon even though
        // Supabase also limits these; the screen shows the countdown on return.
        noteWait(scope, 60_000);
        setSent("reset");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success(t("auth.passwordUpdated"));
        nav({ to: "/app" });
      }
    } catch (err) {
      // A spent or failed challenge must be redrawn before the next try.
      turnstile.current?.reset();
      const message = (err as Error).message;
      // Count the miss against this action + address so a stuck retry backs
      // off; a 429 gets a longer, explicit wait. Supabase still enforces its
      // own server-side limits beyond this browser.
      if (scope && mode !== "recover") {
        const rateLimited = /rate limit|too many/i.test(message);
        if (rateLimited || mode === "in") {
          const gate = noteFailure(
            scope,
            PASSWORD_BACKOFF,
            rateLimited ? { blockedUntil: Date.now() + 60_000 } : {},
          );
          setWait(Math.max(0, gate.blockedUntil - Date.now()));
        }
      }
      // Never leak account state through error text: a failed sign-in, unknown
      // email, wrong password or unconfirmed account, always reads the same.
      // OWASP asks for consistent responses; Supabase's own wording already is.
      if (mode === "in" && /invalid login credentials|email not confirmed/i.test(message)) {
        toast.error(t("auth.invalidCredentials"));
      } else {
        // Surpass raw server wording but stay helpful for genuine failures.
        toast.error(/rate limit|too many/i.test(message) ? t("errors.tooManyAttempts") : message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col px-6 py-8 sm:px-12">
      <header className="flex items-center justify-between">
        <div className="font-display flex items-center gap-3 text-2xl font-medium">
          <img src="/logo.svg" alt="Storq logo" className="size-10 rounded-lg" />
          Storq
        </div>
        {(mode === "in" || mode === "up") && (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {mode === "in" ? t("auth.newToStorq") : t("auth.alreadyHaveAccount")}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPassword("");
                setMode(mode === "in" ? "up" : "in");
              }}
            >
              {mode === "in" ? t("auth.createAccount") : t("auth.signIn")}
            </Button>
          </div>
        )}
        <LanguageSwitcher />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16">
        {sent ? (
          <div className="space-y-4">
            <Alert>
              <AlertTitle>{t("auth.checkYourEmail")}</AlertTitle>
              <AlertDescription>
                {/* Reset stays neutral and never names the address: confirming or
                    denying an account would turn this screen into an enumerator. */}
                {sent === "reset" ? t("auth.resetAny") : t("auth.confirmSent", { email })}
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
                {t("auth.backToSignIn")}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-medium">
                {mode === "in"
                  ? t("auth.welcomeBack")
                  : mode === "up"
                    ? t("auth.createYourAccount")
                    : mode === "forgot"
                      ? t("auth.resetYourPassword")
                      : t("auth.chooseNewPassword")}
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                {mode === "recover"
                  ? t("auth.pickStrongPassword")
                  : mode === "forgot"
                    ? t("auth.emailResetHint")
                    : t("auth.oneAccountHint")}
              </p>
            </div>
            <form onSubmit={submit} className="space-y-6">
              {mode !== "recover" && (
                <div className="space-y-2">
                  <Label
                    htmlFor="business-email"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("auth.businessEmail")}
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
                    {t("auth.password")}
                  </Label>
                  <PasswordInput
                    id="password"
                    className="h-12"
                    autoComplete={mode === "in" ? "current-password" : "new-password"}
                    required
                    maxLength={LIMITS.password}
                    value={password}
                    onChange={(e) => setPassword(e.target.value.slice(0, LIMITS.password))}
                  />
                  {(mode === "up" || mode === "recover") && (
                    <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
                  )}
                </div>
              )}
              {mode !== "recover" && TURNSTILE_SITE_KEY && (
                <Turnstile ref={turnstile} action={mode} />
              )}
              <Button className="h-12 w-full" size="lg" disabled={busy || wait > 0}>
                {busy
                  ? t("common.confirming")
                  : wait > 0
                    ? t("auth.retryIn", { time: formatWait(wait) })
                    : mode === "in"
                      ? t("auth.signIn")
                      : mode === "up"
                        ? t("auth.createAccount")
                        : mode === "forgot"
                          ? t("auth.sendResetLink")
                          : t("auth.updatePassword")}
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
                  {t("auth.forgotPassword")}
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
                  {t("auth.backToSignIn")}
                </Button>
              )}
            </form>
          </div>
        )}
      </main>
      <div className="text-xs text-muted-foreground">{t("auth.brandTag")}</div>
    </div>
  );
}
