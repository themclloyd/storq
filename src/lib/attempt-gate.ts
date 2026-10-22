/**
 * Client-side attempt gate for the two doors into a till: the PIN pad and the
 * sign-in form.
 *
 * The real limits live server-side (public.pin_throttle + the login-wide
 * backstop for PINs, Supabase Auth for passwords). This gate only stops one
 * browser from turning a fat finger, a stuck key or a script into a request
 * storm — and it survives a reload, so F5 does not clear the countdown.
 *
 * Storage holds a counter and a timestamp, never a credential.
 */
const PREFIX = "storq-gate-";

export type GateBackoff = {
  /** Wait after the first failure. */
  baseMs: number;
  /** Wait never grows past this. */
  maxMs: number;
};

/** Fast, forgiving cooling-off between PIN entries. */
export const PIN_BACKOFF: GateBackoff = { baseMs: 1_500, maxMs: 15_000 };
/** Slower, stricter cooling-off for password sign-in. */
export const PASSWORD_BACKOFF: GateBackoff = { baseMs: 5_000, maxMs: 300_000 };

type Gate = { fails: number; blockedUntil: number };

const MAX_BLOCK_MS = 24 * 60 * 60_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readGate(scope: string): Gate {
  const s = storage();
  if (!s) return { fails: 0, blockedUntil: 0 };
  try {
    const raw = s.getItem(PREFIX + scope);
    if (!raw) return { fails: 0, blockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<Gate>;
    const fails = Number(parsed.fails);
    const blockedUntil = Number(parsed.blockedUntil);
    return {
      fails: Number.isFinite(fails) && fails > 0 ? Math.floor(fails) : 0,
      blockedUntil: Number.isFinite(blockedUntil) && blockedUntil > 0 ? blockedUntil : 0,
    };
  } catch {
    return { fails: 0, blockedUntil: 0 };
  }
}

function writeGate(scope: string, gate: Gate) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + scope, JSON.stringify(gate));
  } catch {
    // Private mode / full storage: the in-memory UI state still cools off.
  }
}

/** Milliseconds left before the next attempt may go out (0 = allowed). */
export function gateRemaining(scope: string, now = Date.now()): number {
  const gate = readGate(scope);
  return Math.max(0, Math.min(gate.blockedUntil - now, MAX_BLOCK_MS));
}

/**
 * Record one failed attempt. `blockedUntil` lets the server decide the wait
 * (e.g. its 15-minute PIN lock) and is never shortened by the local backoff.
 */
export function noteFailure(
  scope: string,
  profile: GateBackoff,
  opts: { blockedUntil?: number; now?: number } = {},
): Gate {
  const now = opts.now ?? Date.now();
  const previous = readGate(scope);
  const fails = Math.min(previous.fails + 1, 30);
  const backoff = Math.min(profile.maxMs, profile.baseMs * 2 ** (fails - 1));
  const wait = opts.blockedUntil === undefined ? backoff : Math.max(0, opts.blockedUntil - now);
  const gate = {
    fails,
    blockedUntil: Math.max(previous.blockedUntil, now + Math.min(wait, MAX_BLOCK_MS)),
  };
  writeGate(scope, gate);
  return gate;
}

/** Block the scope even though nothing failed (e.g. a reset email was sent). */
export function noteWait(scope: string, ms: number, now = Date.now()): Gate {
  const previous = readGate(scope);
  const gate = {
    fails: previous.fails,
    blockedUntil: Math.max(previous.blockedUntil, now + Math.min(Math.max(0, ms), MAX_BLOCK_MS)),
  };
  writeGate(scope, gate);
  return gate;
}

/** A correct PIN/password clears the slate. */
export function clearGate(scope: string) {
  storage()?.removeItem(PREFIX + scope);
}

/** Compact countdown for buttons and the PIN pad: `8s`, `1:05`. */
export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
