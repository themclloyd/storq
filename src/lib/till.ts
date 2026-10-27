// Counter arithmetic shared by the register screens: layby deposits, the
// change a cash drawer owes, and the single note that travels with a sale.
// Pure and client-safe, so the money rules are tested apart from the UI.
import { round2 } from "@/lib/products";

/** One part of a split tender, as the checkout RPC receives it. */
export type TenderPart = { method: string; amount: number };

/** What the tender screen hands back to the register once a sale is taken. */
export type SaleForm = {
  payment: number;
  method: string;
  tenders: TenderPart[];
  name: string;
  phone: string;
  note: string;
  overridePin: string | null;
};

/** Layby deposits a counter asks for: the whole amount, or half of it. */
export function depositPresets(total: number): number[] {
  const due = round2(Math.max(0, total));
  const half = round2(due / 2);
  return half > 0 && half !== due ? [due, half] : [due];
}

/**
 * Change comes only from the cash portion beyond what the other tenders miss.
 * A layby deposit never produces change: the rest is owed on the layby.
 */
export function changeDue(tenders: TenderPart[], total: number, kind: "sale" | "layby"): number {
  if (kind !== "sale") return 0;
  const cash = tenders.filter((t) => t.method === "cash").reduce((a, t) => a + t.amount, 0);
  const other = tenders.filter((t) => t.method !== "cash").reduce((a, t) => a + t.amount, 0);
  return Math.max(0, round2(cash - Math.max(0, total - other)));
}

/** Total of the tenders that count toward what the customer has paid. */
export function tenderTotal(tenders: TenderPart[]): number {
  return round2(tenders.reduce((a, t) => a + t.amount, 0));
}

/**
 * The order note the receipt and the sale record carry: the till's own note
 * first, then each line's note with the item's name, capped to what the
 * checkout RPC accepts (500 characters).
 */
export function composeNote(
  orderNote: string,
  lines: { name: string; note?: string | undefined }[],
): string {
  const parts: string[] = [];
  const base = orderNote.trim();
  if (base) parts.push(base);
  for (const line of lines) {
    const note = line.note?.trim();
    if (note) parts.push(`${line.name}: ${note}`);
  }
  return parts.join(" · ").slice(0, 500);
}
