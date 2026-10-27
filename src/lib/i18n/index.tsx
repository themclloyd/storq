import { useSyncExternalStore } from "react";
import { en } from "./en";
import { ny } from "./ny";

/**
 * Minimal, dependency-free i18n for the TanStack Start app.
 *
 * Design notes:
 * - `en` is the source of truth for key structure. Any key missing from the
 *   active locale falls back to English, so untranslated screens keep working
 *   while Chichewa coverage grows screen-by-screen.
 * - The active locale starts as English on both server and during hydration, and
 *   is only switched to the stored value after mount (see `startLocale`). This
 *   avoids SSR/client hydration mismatches on the pre-rendered landing page.
 * - Non-hook code (e.g. `validate.ts`, `pos.tsx` error mapping) can call the
 *   module-level `t()` directly; components use `useI18n()` to re-render on
 *   locale change via `useSyncExternalStore`.
 */
export type Locale = "en" | "ny";
export const LOCALES: Locale[] = ["en", "ny"];
export const LOCALE_STORAGE_KEY = "storq-locale";
const DEFAULT_LOCALE: Locale = "en";

const catalogs: Record<Locale, unknown> = { en, ny };

export type TranslateParams = Record<string, string | number>;

const isClient = () => typeof document !== "undefined";

function readStoredLocale(): Locale {
  if (!isClient()) return DEFAULT_LOCALE;
  const fromCookie = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_STORAGE_KEY}=([^;]+)`));
  let value = fromCookie?.[1] ? decodeURIComponent(fromCookie[1]) : null;
  if (!value) {
    try {
      value = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      value = null;
    }
  }
  return value === "ny" || value === "en" ? value : DEFAULT_LOCALE;
}

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next !== "en" && next !== "ny") return;
  current = next;
  if (isClient()) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Private-mode storage failures are non-fatal for this session.
    }
    document.cookie = `${LOCALE_STORAGE_KEY}=${next};path=/;max-age=31536000;samesite=lax`;
    document.documentElement.lang = next;
  }
  emit();
}

/** Apply the stored/browsers locale after mount. Safe to call more than once. */
export function startLocale(): Locale {
  const stored = readStoredLocale();
  if (stored !== current) setLocale(stored);
  else if (isClient()) document.documentElement.lang = stored;
  return stored;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

function pickPath(catalog: Record<string, unknown>, path: string): string | null {
  let cursor: unknown = catalog;
  for (const part of path.split(".")) {
    if (cursor && typeof cursor === "object" && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof cursor === "string" ? cursor : null;
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

function pickLocalized(path: string): string | null {
  return (
    pickPath(catalogs[current] as Record<string, unknown>, path) ??
    pickPath(en as unknown as Record<string, unknown>, path)
  );
}

/**
 * Translate a dot path (e.g. "nav.dashboard") with optional {param} interpolation.
 *
 * Counts carry their own singular: pass `count` and the catalog's `<key>_one`
 * wins at exactly 1, falling back to `<key>`. That keeps "1 item" out of every
 * screen without threading `count === 1 ? a : b` through the components.
 */
export function t(path: string, params?: TranslateParams): string {
  const singular = params !== undefined && Number(params["count"]) === 1;
  const template = (singular ? pickLocalized(`${path}_one`) : null) ?? pickLocalized(path);
  // Return the raw path when no translation exists so a missing key is visible,
  // never a crash.
  return interpolate(template ?? path, params);
}

export function useI18n() {
  const locale = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_LOCALE,
  );
  return { t, locale, setLocale, locales: LOCALES };
}

export type Messages = typeof en;
