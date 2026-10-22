import * as React from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { ViewIcon, ViewOffIcon } from "@/lib/icons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Password/PIN field with a show-hide eye toggle.
 *
 * Masked by default; the trailing button flips the input between `password`
 * and `text` in place, so the value, caret and autofill state survive the
 * switch. Every secret input in the app (account password, setup PIN, staff
 * PIN, manager PIN) renders through this so the affordance stays identical.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, ...props }, ref) => {
  const { t } = useI18n();
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        className={cn("pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={t(shown ? "common.hidePassword" : "common.showPassword")}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
      >
        <HugeiconsIcon icon={shown ? ViewOffIcon : ViewIcon} className="size-4" />
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
