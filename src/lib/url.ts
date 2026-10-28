// URL helpers that work for both targets.
//
// The website routes live in the path (`/app/billing?intent=add-stores`); the
// packaged till routes live after the hash (`#/app/billing?intent=add-stores`),
// because static files cannot answer a deep-link reload. Anything that reads or
// trims the query string has to speak both, or a payment recovery and the
// "add a store" intent silently stop working in the installed app.

/** A query parameter from the real URL, or from the hash route in the desktop app. */
export function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const fromSearch = new URLSearchParams(window.location.search).get(name);
  if (fromSearch !== null) return fromSearch;
  const hash = window.location.hash;
  const at = hash.indexOf("?");
  return at >= 0 ? new URLSearchParams(hash.slice(at + 1)).get(name) : null;
}

/**
 * Drop the query string without navigating. The router keeps rendering the same
 * screen; only the one-shot flag (`?tx_ref`, `?intent`) is removed so a reload
 * does not replay it.
 */
export function clearUrlQuery(): void {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  if (hash.startsWith("#")) {
    const route = hash.slice(1);
    const at = route.indexOf("?");
    if (at < 0) return;
    window.history.replaceState(null, "", `#${route.slice(0, at)}`);
    return;
  }
  window.history.replaceState(null, "", window.location.pathname);
}
