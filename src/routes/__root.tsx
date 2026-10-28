import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearDeviceCache } from "@/lib/offline";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { startLocale, useI18n } from "@/lib/i18n";

import { Toaster } from "@/components/ui/sonner";
import { CookieConsent } from "@/components/CookieConsent";
import { NotFound } from "@/components/NotFound";
import { supabase } from "@/integrations/supabase/client";
import { clearAuthCheck } from "@/lib/auth-session";
import appCss from "../styles.css?url";
import { SITE_NAME, DEFAULT_OG_IMAGE, PUBLIC_ROBOTS } from "@/lib/seo";
import { reportLovableError } from "../lib/lovable-error-reporting";

/**
 * A tab left open across a deploy, or across a dev-server restart, asks for
 * route chunks that no longer exist, and the router reports that as a module
 * load error. Re-rendering can never fix it: the tab needs the new manifest, so
 * the boundary reloads once and only shows the failure screen if that did not
 * help. Anything else keeps the normal "try again" behaviour.
 */
const STALE_MODULE =
  /dynamically imported module|module script failed|ChunkLoadError|Loading chunk \S+ failed/i;
const RELOAD_KEY = "storq:stale-module-reload";
const RELOAD_COOLDOWN = 60_000;

function isStaleModule(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return STALE_MODULE.test(message);
}

/** Reload at most once a minute, so a genuinely broken build still shows the screen. */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Blocked storage: allow the reload, the cooldown is only a safety net.
  }
  window.location.reload();
  return true;
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const { t } = useI18n();
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    if (isStaleModule(error)) reloadOnce();
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("errors.pageDidntLoad")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("errors.pageDidntLoadBody")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              // A stale chunk never recovers in place; fetch the current build.
              if (isStaleModule(error) && reloadOnce()) return;
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("errors.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // `viewport-fit=cover` lets the shell paint behind the notch and home
      // indicator, which is what the safe-area insets below measure. The
      // interactive-widget hint keeps the on-screen keyboard from scrolling a
      // field out of view when a dialog opens on Android.
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: "Storq POS | Point of sale, inventory and layby" },
      {
        name: "description",
        content: "Point of sale, stock and layby for single and multi-store businesses.",
      },
      { name: "theme-color", content: "#f5f7f8", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#1b2226", media: "(prefers-color-scheme: dark)" },
      // Installed-to-home-screen chrome (iOS reads the apple-* names, Android
      // reads the manifest). Without these Safari shows a browser bar and adds
      // its own inset, which is the main thing that gives a web app away.
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Storq" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "format-detection", content: "telephone=no" },
      { name: "robots", content: PUBLIC_ROBOTS },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Fonts ship inside appCss (see styles.css), self-hosted, so no
      // render-blocking third-party stylesheet and no extra CSP origin.
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
      { rel: "alternate icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // Safari ignores SVG for the home-screen tile and needs a 180px PNG.
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Without JS, scroll-reveal wrappers on the landing page must stay visible. */}
        <noscript>
          <style>{".reveal{opacity:1!important;transform:none!important;transition:none}"}</style>
        </noscript>
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    // Adopt the stored/browser locale after hydration to avoid SSR mismatch.
    startLocale();
  }, []);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Any identity change (including another tab signing out) must discard
      // the memoized route check before the router re-runs `beforeLoad`.
      clearAuthCheck();
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        clearDeviceCache();
      } else queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <CookieConsent />
      {/* Bottom-right keeps a toast off the sticky mobile header it used to cover, and
          off the page title at the top of every screen. The tint comes from the token
          palette in `ui/sonner`, so `richColors` is deliberately not set. */}
      <Toaster position="bottom-right" visibleToasts={3} />
    </QueryClientProvider>
  );
}
