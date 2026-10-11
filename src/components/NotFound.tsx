import { type CSSProperties } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Home, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import logo from "/logo.svg?url";

/**
 * Root 404 screen. Modern and a bit playful: a dot-grid stage with soft glow
 * orbs, a huge "404" whose zero is a slow-loading ring (the page is still
 * searching), the missing path echoed live, and staggered load-in reveals.
 * All motion is CSS-driven and disabled under prefers-reduced-motion (see
 * styles.css); nothing here reads browser state during render, so SSR and
 * hydration stay identical.
 */
export function NotFound() {
  const { t } = useI18n();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Helper for the CSS-var stagger consumed by `.rise` (see styles.css).
  const rise = (ms: number) => ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="notf-grid" aria-hidden>
        <div className="notf-orb notf-orb-a" />
        <div className="notf-orb notf-orb-b" />
      </div>

      <main className="relative w-full max-w-lg text-center">
        <div className="rise" style={rise(0)}>
          <span className="notf-digits">4</span>
          <span className="notf-ring" aria-hidden />
          <span className="notf-digits">4</span>
        </div>

        <h1
          className="font-display rise mt-6 text-2xl font-medium tracking-tight text-foreground"
          style={rise(120)}
        >
          {t("errors.pageNotFoundTitle")}
        </h1>
        <p
          className="rise mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground"
          style={rise(200)}
        >
          {t("errors.pageNotFoundBody")}
        </p>

        <p
          className="rise mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs"
          style={rise(280)}
        >
          <img src={logo} alt="" className="size-4 shrink-0" />
          <code className="truncate font-mono text-muted-foreground">{path}</code>
        </p>

        <div
          className="rise mt-8 flex flex-wrap items-center justify-center gap-3"
          style={rise(360)}
        >
          <Button size="lg" asChild>
            <Link to="/">
              <Home />
              {t("errors.goHome")}
            </Link>
          </Button>
          <Button size="lg" variant="outline" onClick={() => history.back()}>
            <ArrowLeft />
            {t("errors.goBack")}
          </Button>
          <Button size="lg" variant="ghost" asChild>
            <Link to="/auth">
              <LogIn />
              {t("errors.openSignIn")}
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
