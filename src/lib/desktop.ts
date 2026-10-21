/**
 * The desktop till's public download location.
 *
 * release.ps1 overwrites this one object on every publish, so the website and the
 * in-app sidebar hand out the newest installer without a version number baked into
 * the link. The bucket is public read-only; real integrity comes from the minisign
 * signature the app verifies on update, not from this URL.
 */
const rawSupabaseUrl =
  (import.meta.env?.["VITE_SUPABASE_URL"] as string | undefined) ?? "";

// Fall back to the live project so a missing build-time variable can never render
const host =
  rawSupabaseUrl.trim().replace(/\/+$/, "") || "https://gtkfczmudhzhbdooftsa.supabase.co";

export const DESKTOP_DOWNLOAD_URL = `${host}/storage/v1/object/public/storq-updates/desktop/StorqPOS-latest.exe`;
