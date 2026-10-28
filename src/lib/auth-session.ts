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
let memo: { sub: string; at: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** Auth events (sign-in, sign-out, token update) invalidate the memo. */
export function clearAuthCheck() {
  memo = null;
  inflight = null;
}

async function verify(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (!error && typeof sub === "string" && sub) return sub;
    // An invalid/expired token is a real answer, not an offline blip: send the
    // visitor to sign in instead of trusting local storage.
    if (error && !isNetworkError(error.message)) return null;
  } catch (e) {
    if (!isNetworkError((e as Error).message)) return null;
  }
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
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
