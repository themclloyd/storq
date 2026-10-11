import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { CookieIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Consent is remembered per device under this key: "all" allows optional
 * analytics cookies, "necessary" keeps only the sign-in cookie.
 */
export const CONSENT_KEY = "storq-cookie-consent";
export type Consent = "all" | "necessary";

// Co-located with the banner it configures; fast-refresh advisory only.
// eslint-disable-next-line react-refresh/only-export-components
export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "all" || v === "necessary" ? v : null;
  } catch {
    return null;
  }
}

export function CookieConsent() {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [visible, setVisible] = useState(false);

  // localStorage is client-only, so the server markup and first paint never carry the banner.
  useEffect(() => {
    if (pathname.startsWith("/app")) {
      setVisible(false);
      return;
    }
    if (readConsent()) return;
    const t = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!visible) return null;

  function choose(value: Consent) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // Private-mode storage failures still close the banner for this visit.
    }
    setVisible(false);
  }

  return (
    <section
      aria-label={t("consent.ariaLabel")}
      className="fixed inset-x-4 bottom-4 z-40 sm:inset-x-auto sm:left-6 sm:w-[380px]"
    >
      <div role="region" aria-live="polite" className="rounded-2xl border bg-card p-4">
        <div className="flex gap-3">
          <HugeiconsIcon icon={CookieIcon} className="mt-0.5 size-5 shrink-0 text-accent" />
          <div>
            <h2 className="text-sm font-semibold">{t("consent.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("consent.body")}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => choose("all")}>
            {t("consent.acceptAll")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => choose("necessary")}
          >
            {t("consent.necessaryOnly")}
          </Button>
        </div>
      </div>
    </section>
  );
}
