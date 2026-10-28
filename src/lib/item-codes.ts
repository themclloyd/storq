// One code per item. `products.sku` is that single identifier: it is what a
// cashier types into search, what a scanner gun emits, and what the printed QR
// carries, so an item never needs a second code anywhere in the app.
//
// Codes are always present. A shop that does not have its own coding scheme
// leaves the field blank and Storq generates one (here for a live preview, in
// SQL for the stored value, `app.save_product` fills a blank on create); a shop
// that types its own keeps it untouched. Matching is trimmed and
// case-insensitive everywhere, which is what the partial unique index
// `(business_id, lower(sku))` enforces server-side.

// Case/space shape rules themselves live in `validateSku` (src/lib/validate.ts),
// which every form runs before the RPC; this module owns the code *lifecycle*.

/** Generated codes: `S` + 10 unambiguous base-32 characters. */
export const AUTO_PREFIX = "S";
const AUTO_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTVWXZ";
const AUTO_BODY = 10;
const AUTO_RE = new RegExp(`^${AUTO_PREFIX}[${AUTO_ALPHABET}]{${AUTO_BODY}}$`);

/** Trim and collapse inner runs of spaces, so a pasted code matches a typed one. */
export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** True for codes Storq generated itself (shown as "auto" so owners can replace them). */
export function isAutoCode(code: string | null | undefined): boolean {
  return AUTO_RE.test(normalizeCode(code).toUpperCase());
}

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < n; i++) out += AUTO_ALPHABET[bytes[i]! % AUTO_ALPHABET.length];
  return out;
}

/**
 * A fresh candidate code that does not clash with anything already in the
 * catalog. The server re-checks and regenerates on a collision, so this is only
 * the "generate" button and the blank-field preview.
 */
export function suggestCode(taken: Iterable<string>): string {
  const used = new Set(
    [...taken].map((c) => normalizeCode(c).toUpperCase()).filter((c) => c !== ""),
  );
  for (let i = 0; i < 40; i++) {
    const candidate = AUTO_PREFIX + randomChars(AUTO_BODY);
    if (!used.has(candidate)) return candidate;
  }
  // After 40 attempts we're almost certainly in a tiny test catalog with a
  // pathological collision rate. Return a new random candidate anyway, the
  // server will detect a real collision and reject it with a clear error.
  return AUTO_PREFIX + randomChars(AUTO_BODY);
}

/** Codes currently in the catalog, the pool a generated candidate must avoid. */
export function takenCodes(list: { sku: string | null }[]): string[] {
  return list.map((p) => p.sku ?? "").filter((c) => c.trim() !== "");
}

/** Case/space-insensitive clash finder over the cached catalog. */
export function findCodeClash<T extends { id: string; sku: string | null }>(
  list: T[],
  code: string,
  exceptId?: string,
): T | undefined {
  const needle = normalizeCode(code).toUpperCase();
  if (!needle) return undefined;
  return list.find((p) => p.id !== exceptId && normalizeCode(p.sku).toUpperCase() === needle);
}

/**
 * What goes into the QR image. The raw code and nothing else: a phone camera and
 * a keyboard-wedge gun must hand the till the identical string, or the exact
 * match in `findByBarcode` stops resolving.
 */
export function qrPayload(code: string): string {
  return normalizeCode(code);
}
