import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { firstError, validatePassword, validatePin } from "@/lib/validate";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import { PasswordInput } from "@/components/password-input";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/pos/bits";

/**
 * The way back into a shop whose owner forgot the PIN. The PIN is the only
 * credential the till accepts, so without this a forgotten digit is a dead end.
 *
 * Recovery costs the business password, typed now: the server only honours the
 * reset within a few minutes of a real password sign-in, so an unattended till
 * cannot be taken over from its own pad. Every other till in the shop is signed
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
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setPin("");
    setRepeat("");
    void supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""))
      .catch(() => setEmail(""));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = firstError(
      validatePassword(password),
      validatePin(pin),
      pin && repeat && pin !== repeat ? t("pin.pinMismatch") : null,
    );
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      // Re-proving the password is what allows the reset server-side; the
      // current session alone is not enough.
      const captchaToken = TURNSTILE_SITE_KEY
        ? (await turnstile.current?.getToken()) || undefined
        : undefined;
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { ...(captchaToken ? { captchaToken } : {}) },
      });
      if (authError) {
        toast.error(authError.message || t("pin.resetWrongPassword"));
        turnstile.current?.reset();
        return;
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
          <Field label={t("pin.resetPassword")}>
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
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
          <Turnstile ref={turnstile} />
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
