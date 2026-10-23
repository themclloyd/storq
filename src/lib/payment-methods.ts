// The payment methods a Malawian shop actually banks through. The code is what
// sales/payments/refunds/expenses store; the database keeps the tenant's enabled
// subset in `business_payment_methods` and refuses anything else.
import { BankIcon, BanknoteIcon, Simcard01Icon } from "@/lib/icons";
import { t } from "@/lib/i18n";

export type PaymentMethodKind = "cash" | "bank" | "mobile";

export type PaymentMethod = {
  code: string;
  kind: PaymentMethodKind;
  /** Retired code an existing tenant may still have enabled. */
  legacy?: boolean;
};

/** Catalogue order: cash first, then the banks, then the wallets. */
export const PAYMENT_METHODS: PaymentMethod[] = [
  { code: "cash", kind: "cash" },
  { code: "national_bank", kind: "bank" },
  { code: "standard_bank", kind: "bank" },
  { code: "fdh", kind: "bank" },
  { code: "fcb", kind: "bank" },
  { code: "nbs", kind: "bank" },
  { code: "ecobank", kind: "bank" },
  { code: "airtel_money", kind: "mobile" },
  { code: "mpamba", kind: "mobile" },
];

/** Codes earlier releases wrote. Readable and keepable, never newly offered. */
export const LEGACY_PAYMENT_METHODS: PaymentMethod[] = [
  { code: "card", kind: "bank", legacy: true },
  { code: "mobile", kind: "mobile", legacy: true },
];

export const ALL_PAYMENT_METHODS = [...PAYMENT_METHODS, ...LEGACY_PAYMENT_METHODS];

const BY_CODE: Record<string, PaymentMethod> = Object.fromEntries(
  ALL_PAYMENT_METHODS.map((m) => [m.code, m]),
);

const CATALOGUE_RANK: Record<string, number> = Object.fromEntries(
  ALL_PAYMENT_METHODS.map((m, i) => [m.code, i]),
);

// Provider names are proper nouns and never translate; the drawer and the two
// retired labels do.
const TRANSLATED_LABELS: Record<string, string> = {
  cash: "till.payCash",
  card: "till.payCard",
  mobile: "till.payMobile",
  split: "doc.split",
  store_credit: "doc.storeCredit",
  till: "exp.srcTill",
  bank: "exp.srcBank",
};

const FIXED_LABELS: Record<string, string> = {
  national_bank: "National Bank",
  standard_bank: "Standard Bank",
  fdh: "FDH Bank",
  fcb: "FCB",
  nbs: "NBS Bank",
  ecobank: "Ecobank",
  airtel_money: "Airtel Money",
  mpamba: "Mpamba",
};

/** Human label for any stored method/source code (falls back to the code). */
export function methodLabel(code: string): string {
  const key = TRANSLATED_LABELS[code];
  if (key) return t(key);
  return FIXED_LABELS[code] ?? code;
}

export function methodKind(code: string): PaymentMethodKind {
  return BY_CODE[code]?.kind ?? "bank";
}

/** The glyph a method kind wears on chips, tables and the checkout grid. */
export function methodIcon(code: string) {
  const kind = methodKind(code);
  return kind === "cash" ? BanknoteIcon : kind === "mobile" ? Simcard01Icon : BankIcon;
}

export function isCashMethod(code: string | null | undefined): boolean {
  return (code ?? "").toLowerCase() === "cash";
}

/** Catalogue order, unknown codes last; duplicates removed. */
export function sortPaymentMethods(codes: string[]): string[] {
  return [...new Set(codes)].sort((a, b) => (CATALOGUE_RANK[a] ?? 99) - (CATALOGUE_RANK[b] ?? 99));
}
