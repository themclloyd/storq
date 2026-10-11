/**
 * Shared number & money formatting (redesign spec §1).
 *
 * One source of truth so every screen renders amounts identically:
 * - Space as the thousands separator (a non-breaking space so a figure never
 *   wraps mid-number on a narrow table cell or drawer).
 * - Decimals shown only when the value is fractional.
 * - Negatives use a real minus glyph (U+2212) in leading position, placed
 *   before the currency symbol: `−MWK 41 400` — never `MWK -41 400` and never
 *   an en-dash with a space.
 */

const NBSP = "\u00A0";
const MINUS = "\u2212";

/** Group an absolute numeric string (e.g. "41400" or "41400.5") with NBSP thousands. */
function group(abs: string): string {
  const [int, dec] = abs.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return dec ? `${grouped}.${dec}` : grouped;
}

/**
 * Format `n` as `<currency> <digits>` with the rules above. `currency` is the
 * configured symbol (e.g. "MWK", "R", "$"); an empty symbol yields bare digits.
 */
export function formatMoney(currency: string, n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  const negative = num < 0;
  const abs = Math.round(Math.abs(num) * 100) / 100;
  const whole = Math.abs(abs - Math.round(abs)) < 1e-9;
  const fixed = whole ? String(Math.round(abs)) : abs.toFixed(2);
  const body = currency ? `${currency} ${group(fixed)}` : group(fixed);
  return (negative ? MINUS : "") + body;
}

/** Trim a compact magnitude to at most one decimal, dropping a trailing ".0". */
function compactMagnitude(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Compact axis label for charts (spec §1): `40k`, `1.2M`, `0`, `−20k`. Currency
 * symbol is intentionally omitted — the axis unit is stated in the chart title.
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
