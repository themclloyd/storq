import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";

// Minimal surface of the Cloudflare Turnstile embed API we rely on. Loaded once
// from the official host; the widget runs an invisible "managed challenge", so
// most users never see a checkbox, the token just arrives via the callback.
type TurnstileGlobal = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
    __turnstileLoad?: Promise<void>;
  }
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve();
  if (!window.__turnstileLoad) {
    window.__turnstileLoad = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Turnstile script failed to load"));
      document.head.appendChild(s);
    });
  }
  return window.__turnstileLoad;
}

export type TurnstileHandle = {
  /** Resolves with the current token, waiting briefly for the managed challenge. */
  getToken: () => Promise<string>;
  /** Clear the spent token and re-run the challenge for the next attempt. */
  reset: () => void;
};

/**
 * Renders a Turnstile managed challenge and hands the parent a single-use token
 * on demand. Nothing renders when no site key is configured, so the surrounding
 * auth form is unchanged until CAPTCHA is switched on.
 */
export const Turnstile = forwardRef<TurnstileHandle, { action?: string }>(function Turnstile(
  { action = "auth" },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef("");
  const tokenRef = useRef("");
  const waiters = useRef<Array<(t: string) => void>>([]);

  useImperativeHandle(ref, () => ({
    async getToken() {
      if (tokenRef.current) return tokenRef.current;
      // The managed challenge resolves itself; give it a moment rather than
      // failing the submit outright. A blank token then lets the call proceed
      // and Supabase returns a clear "complete the CAPTCHA" error to retry.
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve(""), 6000);
        waiters.current.push((t) => {
          clearTimeout(timer);
          resolve(t);
        });
      });
    },
    reset() {
      tokenRef.current = "";
      if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          callback: (t: string) => {
            tokenRef.current = t;
            const pending = waiters.current;
            waiters.current = [];
            pending.forEach((w) => w(t));
          },
          "expired-callback": () => {
            tokenRef.current = "";
          },
          "error-callback": () => {
            tokenRef.current = "";
          },
        });
      })
      .catch(() => {
        // Script blocked/offline: getToken will time out to "" and the server
        // decides. We never silently claim a human passed.
      });
    return () => {
      cancelled = true;
      if (window.turnstile && widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already removed */
        }
        widgetId.current = "";
      }
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={container} className="flex justify-center" />;
});
