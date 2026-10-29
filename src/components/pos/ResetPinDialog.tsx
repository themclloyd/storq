import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { publicAppUrl } from "@/lib/desktop";
import { firstError, validatePassword, validatePin } from "@/lib/validate";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import { PasswordInput } from "@/components/password-input";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/pos/bits";
import { cn } from "@/lib/utils";

/** How long a real sign-in counts as "I am the owner", the server's own window. */
const PROOF_MINUTES = 15;
const RESEND_SECONDS = 60;

type Proof = "password" | "email";

/**
 * The way back into a shop whose owner forgot the PIN. The PIN is the only
 * credential the till accepts, so without this a forgotten digit is a dead end.
 *
 * Recovery is for the owner account and nobody else: the server resolves the
 * business from the signed-in account and refuses anything that is not its
 * owner, so a cashier standing at the pad cannot re-key the shop's PIN.
 *
 * There are two ways to prove it is really them, and both leave the same trace,
 * a fresh sign-in within the last few minutes:
 *
 *  - the account password, typed now;
 *  - a code sent to the owner's email, which is the only proof available to an
 *    owner who cannot remember the password but still holds the inbox.
 *
 * An email link works too: opening it signs this device in, the dialog notices
 * the fresh sign-in and asks only for the new PIN. Every other till is signed
 * out by the reset, since they were all opened with the PIN being replaced.
 */
export function ResetPinDialog({
  open,
  onOpenChange,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: (pin: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [proof, setProof] = useState<Proof>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState(false);
  const [sending, setSending] = useState(false);
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setCode("");
    setPin("");
    setRepeat("");
    setSentAt(0);
    setResendAt(0);
    setProof("password");
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        const user = data.user;
        setEmail(user?.email ?? "");
        // Signed in moments ago, by password, by the emailed code, or by the
        // link in that email. That sign-in is the proof; ask for the new PIN.
        const seen = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
        setFresh(!!seen && Date.now() - seen < PROOF_MINUTES * 60_000);
      })
      .catch(() => setEmail(""));
  }, [open]);

  // Countdown for the resend button; it only runs while a wait is in force.
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [resendAt]);

  const waitLeft = Math.max(0, Math.ceil((resendAt - now) / 1_000));

  async function captchaToken() {
    if (!TURNSTILE_SITE_KEY) return undefined;
    return (await turnstile.current?.getToken()) || undefined;
  }

  async function sendCode() {
    if (waitLeft > 0 || sending) return;
    setSending(true);
    try {
      const token = await captchaToken();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // An owner re-signing in must never create an account out of a typo.
          shouldCreateUser: false,
          // The mail client opens this on the public site: inside the installed
          // app the page origin is `tauri.localhost`, which no inbox can reach.
          emailRedirectTo: publicAppUrl("/app"),
          ...(token ? { captchaToken: token } : {}),
        },
      });
      if (error) {
        toast.error(error.message || t("pin.resetSendFailed"));
        turnstile.current?.reset();
        return;
      }
      const at = Date.now();
      setSentAt(at);
      setResendAt(at + RESEND_SECONDS * 1_000);
      setNow(at);
      toast.success(t("pin.resetCodeSent", { email }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = firstError(
      validatePin(pin),
      pin && repeat && pin !== repeat ? t("pin.pinMismatch") : null,
      !fresh && proof === "password" ? validatePassword(password) : null,
      !fresh && proof === "email" && code.length !== 6 ? t("pin.resetCodeWrong") : null,
    );
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      if (!fresh) {
        // Whatever proves the owner is what lets the reset through: the server
        // only honours it inside a few minutes of a real sign-in, so an
        // unattended till cannot be taken over from its own pad.
        const token = await captchaToken();
        const { error: authError } =
          proof === "password"
            ? await supabase.auth.signInWithPassword({
                email,
                password,
                options: { ...(token ? { captchaToken: token } : {}) },
              })
            : await supabase.auth.verifyOtp({
                email,
                token: code,
                type: "email",
                options: { ...(token ? { captchaToken: token } : {}) },
              });
        if (authError) {
          toast.error(
            proof === "password"
              ? authError.message || t("pin.resetWrongPassword")
              : authError.message || t("pin.resetCodeInvalid"),
          );
          turnstile.current?.reset();
          setCode("");
          return;
        }
      }
      // The RPC is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("reset_owner_pin", { p_pin: pin });
      if (error) {
        toast.error(error.message);
        return;
      }
      const opened = await onReset(pin);
      if (opened) {
        toast.success(t("pin.resetDone"));
        onOpenChange(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pin.resetTitle")}</DialogTitle>
          <DialogDescription>{t("pin.resetBody", { email })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {fresh ? (
            <p className="rounded-xl border border-success/40 bg-success-soft px-3 py-2 text-[12px] text-success">
              {t("pin.resetFresh")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1 text-[12px]">
                {(["password", "email"] as Proof[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setProof(m)}
                    aria-pressed={proof === m}
                    className={cn(
                      "rounded-lg px-2 py-1.5 font-medium transition-colors",
                      proof === m
                        ? "bg-card text-foreground ring-1 ring-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(m === "password" ? "pin.resetModePassword" : "pin.resetModeEmail")}
                  </button>
                ))}
              </div>
              {proof === "password" ? (
                <Field label={t("pin.resetPassword")}>
                  <PasswordInput
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      disabled={sending || waitLeft > 0}
                      onClick={() => void sendCode()}
                    >
                      {sending
                        ? t("pin.resetSending")
                        : waitLeft > 0
                          ? t("pin.resetResendIn", { seconds: waitLeft })
                          : sentAt
                            ? t("pin.resetResend")
                            : t("pin.resetSendCode")}
                    </Button>
                  </div>
                  <Field label={t("pin.resetCodeLabel")}>
                    <Input
                      className="text-center text-lg tracking-[0.4em] tabular-nums"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    />
                  </Field>
                  <p className="text-[11px] text-muted-foreground">{t("pin.resetCodeHint")}</p>
                </div>
              )}
              <Turnstile ref={turnstile} />
            </>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t("pin.newPin")}>
              <PasswordInput
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label={t("pin.confirmPin")}>
              <PasswordInput
                inputMode="numeric"
                maxLength={8}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("pin.resetOwnerOnly")}</p>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {t("pin.resetAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
