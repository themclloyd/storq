/**
 * Shared number & money formatting (redesign spec §1).
 *
 * One source of truth so every screen renders amounts identically:
 * - Comma as the thousands separator (`6,000,000`), the format owners read on
 *   receipts, price tags and bank statements in our markets.
 * - Currency symbol sits flush against the digits (`MK6,000`), no space.
 * - Decimals shown only when the value is fractional.
 * - Negatives use a real minus glyph (U+2212) in leading position, placed
 *   before the currency symbol: `−MK41,400`, never `MK -41,400` and never
 *   an en-dash with a space.
 */

const MINUS = "\u2212";
const COMMA = ",";

/** Group an absolute numeric string (e.g. "41400" or "41400.5") with comma thousands. */
function group(abs: string): string {
  const [int, dec] = abs.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, COMMA);
  return dec ? `${grouped}.${dec}` : grouped;
}

// The business now stores an ISO code (`MWK`), so amounts keep their local look
// (`MK6,000`). Codes not listed, and symbols an older tenant typed, print as-is.
const SYMBOLS: Record<string, string> = {
  MWK: "MK",
  USD: "$",
  ZAR: "R",
  KES: "KSh",
  TZS: "TSh",
  ZMW: "ZK",
  BWP: "P",
  MZN: "MT",
  GBP: "\u00a3",
  EUR: "\u20ac",
};

function displayCurrency(currency: string): string {
  return SYMBOLS[currency.trim().toUpperCase()] ?? currency;
}

/**
 * Format `n` as `<currency><digits>` with the rules above. `currency` is the
 * stored currency code or symbol; ISO codes print as their familiar sign
 * (`MWK` → `MK`), anything else, including symbols older tenants typed in,
 * prints unchanged. An empty symbol yields bare digits.
 */
export function formatMoney(currency: string, n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  const negative = num < 0;
  const abs = Math.round(Math.abs(num) * 100) / 100;
  const whole = Math.abs(abs - Math.round(abs)) < 1e-9;
  const fixed = whole ? String(Math.round(abs)) : abs.toFixed(2);
  const symbol = displayCurrency(currency);
  const body = symbol ? `${symbol}${group(fixed)}` : group(fixed);
  return (negative ? MINUS : "") + body;
}

/** Trim a compact magnitude to at most one decimal, dropping a trailing ".0". */
function compactMagnitude(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Compact axis label for charts (spec §1): `40k`, `1.2M`, `0`, `−20k`. Currency
 * symbol is intentionally omitted, the axis unit is stated in the chart title.
 */
export function formatCompactMoney(n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  const negative = num < 0;
  const abs = Math.abs(num);
  let out: string;
  if (abs >= 1_000_000) out = `${compactMagnitude(abs / 1_000_000)}M`;
  else if (abs >= 1000) out = `${compactMagnitude(abs / 1000)}k`;
  else out = String(Math.round(abs));
  return (negative ? MINUS : "") + out;
}

/**
 * Pick the correct plural form for a count and return it with tabular-safe
 * grouping: `pluralize(1, "location", "locations")` -> "1 location". The caller
 * passes already-localized singular/plural words so this stays locale-agnostic.
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${group(String(count))} ${count === 1 ? singular : plural}`;
}
