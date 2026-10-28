import { supabase } from "@/integrations/supabase/client";
import { isNetworkError } from "@/lib/offline";

/**
 * Who is signed in on this device, checked once and reused.
 *
 * `beforeLoad` used to call `auth.getUser()` on every sidebar click and every
 * reload. That is a request to the Auth server, and a query in its database,
 * for data the client already holds. `getClaims()` verifies the JWT against the
 * cached JWKS on projects with asymmetric signing keys and only refreshes the
 * session when it is about to expire, so repeated navigations cost nothing.
 * The result is memoized briefly so a burst of clicks (or a route preload)
 * collapses into one check.
 *
 * The stored session is the offline fallback: a till that reloads without a
 * network must still reach the PIN pad. This decides only whether to render
 * the shell, RLS and every staff-session RPC remain the real authority.
 */
const TTL_MS = 20_000;
/**
 * How long a route check may spend on the network before the device answers for
 * itself. With no network the request fails at once, but a shop Wi-Fi with a
 * dead uplink keeps it open until the browser's own timeout, and the whole
 * workspace is stuck behind that await. The till would show a blank window for
 * a minute and read as "it quit".
 */
const CHECK_TIMEOUT_MS = 4_000;
/**
 * Who this device last proved itself signed in as.
 *
 * The stored Supabase session alone is not enough: an access token lives about
 * an hour, and once it lapses offline `getSession()` answers null because the
 * refresh cannot be sent. Every navigation then looked like "signed out" and
 * sent the till to `/auth`, a screen that cannot work without the network.
 * Remembering the subject keeps the shell open across an outage; the token, RLS
 * and the PIN session still decide what that person may read or write, and a
 * real sign-out forgets it (see `forgetDeviceIdentity`).
 */
const IDENTITY_KEY = "storq-auth-user";

let memo: { sub: string; at: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** Auth events (sign-in, sign-out, token update) invalidate the memo. */
export function clearAuthCheck() {
  memo = null;
  inflight = null;
}

/** A real sign-out forgets the person, so the next boot starts at the sign-in screen. */
export function forgetDeviceIdentity() {
  memo = null;
  inflight = null;
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // Blocked storage: nothing was remembered in the first place.
  }
}

function remember(sub: string) {
  try {
    localStorage.setItem(IDENTITY_KEY, sub);
  } catch {
    // Storage unavailable: offline boots lose their identity, online ones still work.
  }
}

/** The last verified subject, or the one the stored Supabase session names. */
function remembered(): string | null {
  try {
    const own = localStorage.getItem(IDENTITY_KEY);
    if (own) return own;
    // First boot after this record was added: read the existing session so the
    // device is not treated as signed out for one reload.
    for (const key of Object.keys(localStorage)) {
      if (!/^sb-.*-auth-token$/.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const id = (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id;
        if (typeof id === "string" && id) {
          remember(id);
          return id;
        }
      } catch {
        // A malformed entry proves nothing; keep looking.
      }
    }
  } catch {
    // Unreadable storage means no offline identity, not a crash.
  }
  return null;
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Resolve with `p`, or reject with a transport-looking error after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error) => {
        clearTimeout(id);
        reject(error);
      },
    );
  });
}

async function verify(): Promise<string | null> {
  // Nothing to ask when there is no network, and waiting for the failure is
  // what made an offline boot slow. The remembered subject is the answer.
  if (isOffline()) return remembered();
  try {
    const { data, error } = await withTimeout(supabase.auth.getClaims(), CHECK_TIMEOUT_MS);
    const sub = data?.claims?.sub;
    if (!error && typeof sub === "string" && sub) {
      remember(sub);
      return sub;
    }
    // An invalid/expired token is a real answer, not an offline blip: send the
    // visitor to sign in instead of trusting local storage.
    if (error && !isNetworkError(error.message)) return null;
  } catch (e) {
    if (!isNetworkError((e as Error).message)) return null;
  }
  // Transport trouble: the stored session is the offline fallback.
  if (isOffline()) return remembered();
  try {
    const { data } = await supabase.auth.getSession();
    const sub = data.session?.user?.id ?? null;
    if (sub) remember(sub);
    return sub ?? remembered();
  } catch {
    return remembered();
  }
}

export async function currentUserId(): Promise<string | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.sub;
  if (inflight) return inflight;
  inflight = verify()
    .then((sub) => {
      if (sub) memo = { sub, at: Date.now() };
      return sub;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
