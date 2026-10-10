// Shared input standards. Every form in the app funnels user text through here
// before it reaches a Postgres RPC, so a paste of markup, a control-character blob
// or a 5 MB string never leaves the browser. The database enforces the same bounds
// again (CHECK constraints + RPC validation) — this layer exists so the user gets a
// readable message instead of a server error.

import { t } from "@/lib/i18n";

export const LIMITS = {
  name: 100,
  businessName: 200,
  storeName: 120,
  productName: 200,
  sku: 64,
  category: 120,
  note: 500,
  customerName: 120,
  phone: 32,
  currency: 4,
  email: 254,
  password: 72,
  pinMin: 4,
  pinMax: 8,
  money: 10_000_000_000,
} as const;

/** Control characters, HTML/JSFCK delimiters and the SQL comment opener. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f<>`]|--/;
const EMAIL_RE =
  /^[^\s@+]+(?:[.+_-][^\s@+]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const PHONE_RE = /^[+0-9()-]{6,32}$/;
const PIN_RE = /^[0-9]{4,8}$/;
const SKU_RE = /^[A-Za-z0-9._\- ]{1,64}$/;

/** Trim, collapse whitespace and drop anything that could start markup or a comment. */
export function sanitizeText(value: string, max: number = LIMITS.note): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, "");
  return stripped.replace(/\s+/g, " ").trim().slice(0, max);
}

export function requireText(
  value: string | null | undefined,
  label: string,
  max: number = LIMITS.note,
): string | null {
  const v = (value ?? "").toString();
  if (!v.trim()) return t("validate.required", { label });
  if (v.trim().length > max) return t("validate.tooLong", { label, max });
  if (UNSAFE.test(v)) return t("validate.unsafe", { label });
  return null;
}

export function optionalText(
  value: string | null | undefined,
  label: string,
  max: number = LIMITS.note,
): string | null {
  if (!value) return null;
  return requireText(value, label, max);
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return t("validate.emailRequired");
  if (v.length > LIMITS.email) return t("validate.emailTooLong");
  if (UNSAFE.test(v)) return t("validate.emailChars");
  return EMAIL_RE.test(v) ? null : t("validate.emailInvalid");
}

/** Password bar: length + a letter and a digit, no control characters. */
export function validatePassword(value: string): string | null {
  if (!value) return t("validate.passwordRequired");
  if (value.length < 8) return t("validate.passwordShort");
  if (value.length > LIMITS.password) return t("validate.passwordLong", { max: LIMITS.password });
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return t("validate.passwordChars");
  if (!/[A-Za-z\u00c0-\u024f]/.test(value) || !/[0-9]/.test(value))
    return t("validate.passwordPattern");
  return null;
}

export function validatePin(value: string): string | null {
  if (!value) return t("validate.pinRequired");
  return PIN_RE.test(value)
    ? null
    : t("validate.pinRange", { min: LIMITS.pinMin, max: LIMITS.pinMax });
}

export function validatePhone(value: string | null | undefined, required = false): string | null {
  const v = (value ?? "").toString().trim();
  if (!v) return required ? t("validate.phoneRequired") : null;
  if (v.length > LIMITS.phone) return t("validate.phoneLength", { max: LIMITS.phone });
  return PHONE_RE.test(v) ? null : t("validate.phoneChars");
}

/** Numeric field against the same bounds the RPC and the CHECK constraint enforce. */
export function validateAmount(
  value: string | number | null | undefined,
  opts: { label: string; min?: number; max?: number; integer?: boolean; required?: boolean },
): string | null {
  const raw = (value ?? "").toString().trim();
  if (!raw) return opts.required ? t("validate.required", { label: opts.label }) : null;
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(raw))
    return t("validate.amountNumber", { label: opts.label });
  const n = Number(raw);
  if (!Number.isFinite(n)) return t("validate.amountNumber", { label: opts.label });
  if (opts.integer && !Number.isInteger(n)) return t("validate.amountWhole", { label: opts.label });
  const min = opts.min ?? 0;
  const max = opts.max ?? LIMITS.money;
  if (n < min) return t("validate.amountMin", { label: opts.label, min });
  if (n > max)
    return t("validate.amountMax", { label: opts.label, max: max.toLocaleString("en-US") });
  return null;
}

export function validateSku(value: string | null | undefined): string | null {
  const v = (value ?? "").toString();
  if (!v.trim()) return null;
  return SKU_RE.test(v.trim()) ? null : t("validate.skuInvalid");
}

export function validateCurrency(value: string | null | undefined): string | null {
  const v = (value ?? "").toString().trim();
  if (!v) return null;
  if (v.length > LIMITS.currency) return t("validate.currencyLength", { max: LIMITS.currency });
  if (UNSAFE.test(v)) return t("validate.currencyChars");
  return null;
}

/** Run a list of checks and return the first failure. */
export function firstError(...errors: (string | null)[]): string | null {
  return errors.find((e) => e !== null) ?? null;
}

/**
 * CSV formula-injection guard: a cell starting with = + - @ (or a tab/CR that
 * simulates one) is executed by Excel/Sheets when the export is reopened.
 * Prefixing an apostrophe keeps the text but neutralises the formula.
 */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const safe = /^[\t\r]?[=+\-@]/.test(s) || UNSAFE.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
