// Shared input standards. Every form in the app funnels user text through here
// before it reaches a Postgres RPC, so a paste of markup, a control-character blob
// or a 5 MB string never leaves the browser. The database is the authority: these
// functions mirror the same CHECK/RPC bounds (lengths, phone and SKU shapes) purely
// so the user reads a message instead of a server error. Rules with no server
// counterpart are the credential ones, email, password and PIN are enforced by
// Supabase auth, while phone mirrors `sales_phone_shape` and SKU `products_sku_shape`.
// Nothing here prevents injection: every write goes through parameterized RPCs.
// What it does add is shape: `payloadKind` refuses values that ARE a JSON document
// or a SQL statement, so a pasted payload cannot be stored as a name, and email and
// password get a strict allowlist instead of "anything without a space".

import { t } from "@/lib/i18n";

export const LIMITS = {
  name: 100,
  businessName: 200,
  storeName: 120,
  productName: 200,
  sku: 64,
  category: 120,
  note: 500,
  address: 240,
  taxId: 40,
  customerName: 120,
  phone: 32,
  currency: 4,
  email: 254,
  /** bcrypt hashes 72 bytes: longer secrets would silently compare only a prefix. */
  passwordBytes: 72,
  password: 72,
  pinMin: 4,
  pinMax: 8,
  /** The item CSV is the only file the app reads; bound it on every axis. */
  csvBytes: 5_000_000,
  csvRows: 5_000,
  csvColumns: 256,
  money: 10_000_000_000,
} as const;

/** Control characters and markup delimiters, defense-in-depth for CSV/print output. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f<>`]/;
/**
 * A practical email allowlist: letters, digits and `_ % + - .` in the local part,
 * dot-separated labels in the domain, and an alphabetic TLD. Quotes, braces,
 * brackets, semicolons, slashes and backslashes are all impossible, an address
 * is an identifier, not a place to paste a document.
 */
const EMAIL_RE =
  /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const PHONE_RE = /^[+0-9() -]{6,32}$/;
const PIN_RE = /^[0-9]{4,8}$/;
const SKU_RE = /^[A-Za-z0-9._\- ]{1,64}$/;

/**
 * Recognise a value that is structurally a data payload rather than prose.
 *
 * This is not the injection defense (parameterized RPCs are). It stops the
 * other failure mode: a pasted `{"$gt":""}` or `'; drop table sales; --`
 * being stored as an item name, then exported to CSV/PDF or shown in a report
 * where a downstream tool (a spreadsheet, a script) treats it as code.
 *
 * Deliberately narrow, so real names survive: `Tee -- blue`, `[2-pack]`,
 * `O'Brien` and `50% off` are all plain text.
 */
export function payloadKind(value: string): "json" | "sql" | null {
  const v = value.trim();
  if (!v) return null;
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed !== null && typeof parsed === "object") return "json";
    } catch {
      // `[2-pack]` or `{clearance}` is a label, not a JSON document.
    }
  }
  if (
    /;\s*(select|insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|merge|call)\b/i.test(
      v,
    ) ||
    /\bunion\s+(?:all\s+)?select\b/i.test(v) ||
    /\bor\s+(?:'[^']*'|\d+)\s*=\s*(?:'[^']*'|\d+)/i.test(v) ||
    /\/\*[\s\S]*?\*\//.test(v)
  )
    return "sql";
  return null;
}

/** Trim, collapse whitespace and drop anything that could start markup. */
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
  if (payloadKind(v)) return t("validate.payload", { label });
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
  if (UNSAFE.test(v) || payloadKind(v)) return t("validate.emailChars");
  // The local part is capped at 64 bytes by RFC 5321; the whole address at 254.
  const at = v.indexOf("@");
  if (at < 1 || at > 64) return t("validate.emailInvalid");
  return EMAIL_RE.test(v) ? null : t("validate.emailInvalid");
}

/**
 * Always-on password rules, applied even when signing IN: a stored password can
 * never exceed 72 bytes, so a longer attempt is either a paste mistake or a
 * payload. Payload *characters* are allowed, bcrypt hashes the whole string, so
 * quotes and braces in a password are inert, but a value that is entirely a
 * JSON document or SQL statement is refused before it leaves the browser.
 */
export function validatePasswordInput(value: string): string | null {
  if (!value) return t("validate.passwordRequired");
  if (value.length > LIMITS.password) return t("validate.passwordLong", { max: LIMITS.password });
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return t("validate.passwordChars");
  if (utf8Length(value) > LIMITS.passwordBytes)
    return t("validate.passwordLong", { max: LIMITS.passwordBytes });
  if (payloadKind(value)) return t("validate.passwordChars");
  return null;
}

/** Password bar for a NEW password: length + a letter and a digit. */
export function validatePassword(value: string): string | null {
  const inputErr = validatePasswordInput(value);
  if (inputErr) return inputErr;
  if (value.length < 8) return t("validate.passwordShort");
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
  if (UNSAFE.test(v) || payloadKind(v)) return t("validate.currencyChars");
  return null;
}

/** UTF-8 byte length, without allocating a TextEncoder per call. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Run a list of checks and return the first failure. */
export function firstError(...errors: (string | null)[]): string | null {
  return errors.find((e) => e !== null) ?? null;
}

// ---------- CSV uploads ----------
// The item import is the only file the app reads, so its rules live with the
// rest of the shape checks. The picker's `accept` attribute is advisory, drag
// and drop, "All files" and a renamed document all reach the change handler.

/** Types a browser reports for a real CSV; anything else is not one. */
const CSV_TYPES = new Set([
  "",
  "text/csv",
  "text/plain",
  "text/comma-separated-values",
  "application/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

/**
 * Gate the picked file before it is read: non-empty, under the byte cap, named
 * `.csv` and not claiming to be another kind of document. Metadata only, the
 * contents are checked by `csvFileIssue` once the file is decoded.
 */
export function validateCsvFile(file: { name: string; type: string; size: number }): string | null {
  if (!file.size) return t("inv.errFileEmpty");
  if (file.size > LIMITS.csvBytes) return t("inv.errFileTooLarge", { max: "5 MB" });
  if (!/\.csv$/i.test(file.name.trim())) return t("inv.errFileType");
  return CSV_TYPES.has(file.type.toLowerCase()) ? null : t("inv.errFileType");
}

// PDF and RTF, as they appear once decoded as text. Zip/gzip are caught by the
// control-character scan below, because their signatures start with one.
const DOC_HEADS = ["%PDF-", "{\\rtf"];

/**
 * Content check on the decoded text, because a renamed file keeps its extension
 * but not its contents. A CSV uses only tab, CR and LF as control characters;
 * a zipped `.xlsx`, an image or any other binary is full of them. A saved web
 * page is caught by its opening tag. Accents and emoji are plain text and pass,
 * the decoder falls back to windows-1252 rather than refusing a non-UTF-8 file.
 */
export function csvFileIssue(text: string): string | null {
  const head = text.slice(0, 512);
  for (const ch of head) {
    const code = ch.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return t("inv.errFileBinary");
  }
  if (DOC_HEADS.some((sig) => head.startsWith(sig))) return t("inv.errFileBinary");
  if (/^\s*<(?:!doctype|html|head|body|table|svg|script|\?xml)/i.test(head))
    return t("inv.errFileMarkup");
  return null;
}

const MONEY_CELL_RE = /^[+-]?(?:\d+|\d{1,3}(?:[ ,]\d{3})+)(?:\.\d{1,2})?$/;

/**
 * Money and quantity cells use an allowlist, not "keep the digits". The old
 * filter turned `1' OR '1'='1` into 111 and `25; drop table` into 25, a pasted
 * payload became a plausible price. A leading currency code (MK, K, R) and
 * thousand separators still parse, because that is what a real export looks
 * like; anything ambiguous is NaN so the row is reported instead of stored.
 */
export function parseAmountCell(value: string | null | undefined): number {
  const raw = String(value ?? "")
    .trim()
    .replace(/^[A-Za-z]{1,4}\s*/, "")
    .replace(/^[$€£]\s*/, "");
  if (!MONEY_CELL_RE.test(raw)) return NaN;
  return Number(raw.replace(/[ ,](?=\d{3}(?:\.|$))/g, ""));
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
