// Shared input standards. Every form in the app funnels user text through here
// before it reaches a Postgres RPC, so a paste of markup, a control-character blob
// or a 5 MB string never leaves the browser. The database enforces the same bounds
// again (CHECK constraints + RPC validation) — this layer exists so the user gets a
// readable message instead of a server error.

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
  if (!v.trim()) return `${label} is required`;
  if (v.trim().length > max) return `${label} must be ${max} characters or fewer`;
  if (UNSAFE.test(v)) return `${label} cannot contain <, >, backticks or control characters`;
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
  if (!v) return "Email is required";
  if (v.length > LIMITS.email) return "Email is too long";
  if (UNSAFE.test(v)) return "Email contains unsupported characters";
  return EMAIL_RE.test(v) ? null : "Enter a valid email address";
}

/** Password bar: length + a letter and a digit, no control characters. */
export function validatePassword(value: string): string | null {
  if (!value) return "Password is required";
  if (value.length < 8) return "Use at least 8 characters";
  if (value.length > LIMITS.password) return `Use ${LIMITS.password} characters or fewer`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return "Password contains unsupported characters";
  if (!/[A-Za-z\u00c0-\u024f]/.test(value) || !/[0-9]/.test(value))
    return "Include at least one letter and one number";
  return null;
}

export function validatePin(value: string): string | null {
  if (!value) return "PIN is required";
  return PIN_RE.test(value) ? null : `PIN must be ${LIMITS.pinMin} to ${LIMITS.pinMax} digits`;
}

export function validatePhone(value: string | null | undefined, required = false): string | null {
  const v = (value ?? "").toString().trim();
  if (!v) return required ? "Phone number is required" : null;
  if (v.length > LIMITS.phone) return `Phone must be ${LIMITS.phone} characters or fewer`;
  return PHONE_RE.test(v) ? null : "Use digits, +, ( ) and - only";
}

/** Numeric field against the same bounds the RPC and the CHECK constraint enforce. */
export function validateAmount(
  value: string | number | null | undefined,
  opts: { label: string; min?: number; max?: number; integer?: boolean; required?: boolean },
): string | null {
  const raw = (value ?? "").toString().trim();
  if (!raw) return opts.required ? `${opts.label} is required` : null;
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(raw)) return `${opts.label} must be a number`;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${opts.label} must be a number`;
  if (opts.integer && !Number.isInteger(n)) return `${opts.label} must be a whole number`;
  const min = opts.min ?? 0;
  const max = opts.max ?? LIMITS.money;
  if (n < min) return `${opts.label} must be ${min} or more`;
  if (n > max) return `${opts.label} must be ${max.toLocaleString("en-US")} or less`;
  return null;
}

export function validateSku(value: string | null | undefined): string | null {
  const v = (value ?? "").toString();
  if (!v.trim()) return null;
  return SKU_RE.test(v.trim())
    ? null
    : "Barcode/SKU may only use letters, numbers, spaces and . _ - (max 64)";
}

export function validateCurrency(value: string | null | undefined): string | null {
  const v = (value ?? "").toString().trim();
  if (!v) return null;
  if (v.length > LIMITS.currency)
    return `Currency symbol must be ${LIMITS.currency} characters or fewer`;
  if (UNSAFE.test(v)) return "Currency symbol contains unsupported characters";
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
