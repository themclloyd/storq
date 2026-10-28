// Who this device is unlocked as. The PIN session token is what the database
// checks for every read and write, so the Supabase client has to attach it to
// each request (see integrations/supabase/client.ts), RLS resolves the reader's
// tier and store from the header, not from "the newest session on the account",
// which would hand a cashier till the manager's screens once two tills were open.
//
// Browser-only by design: the authenticated routes render without SSR.

export const DEVICE_ID_KEY = "storq.device-id";
const STAFF_KEY_PREFIX = "pos-staff-";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const staffStorageKey = (userId: string) => `${STAFF_KEY_PREFIX}${userId}`;

/**
 * Stable per-register identity. Every till in a shop signs in with the one
 * business email, so auth.uid() is shared across counters; the server scopes PIN
 * throttling and staff sessions by this id, so one till's bad PINs never lock
 * out or sign out another register. Persisted for the life of the device.
 */
export function getDeviceId(): string {
  try {
    if (typeof localStorage === "undefined") return "";
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Unavailable storage just means an unscoped (legacy) unlock.
    return "";
  }
}

/** The `sub` claim, read without verifying: the server verifies the signature. */
function tokenSubject(authorization: string | null): string | null {
  if (!authorization) return null;
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!bearer) return null;
  const parts = bearer[1]!.split(".");
  if (parts.length !== 3 || typeof atob === "undefined") return null;
  try {
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * The PIN session token this browser holds for the account in `authorization`,
 * or null when it is locked. Expired tokens are dropped here as well so a stale
 * row cannot make every read fail while the pad still looks open.
 */
export function sessionTokenFor(authorization: string | null): string | null {
  if (typeof localStorage === "undefined") return null;
  const subject = tokenSubject(authorization);
  if (!subject) return null;
  try {
    const raw = localStorage.getItem(staffStorageKey(subject));
    if (!raw) return null;
    const session = JSON.parse(raw) as { token?: unknown; expires_at?: unknown };
    if (typeof session.token !== "string" || !UUID_RE.test(session.token)) return null;
    if (
      typeof session.expires_at === "string" &&
      new Date(session.expires_at).getTime() <= Date.now()
    )
      return null;
    return session.token;
  } catch {
    return null;
  }
}
