// Client-safe sale/layby receipt builders. No DB access — the caller passes an
// already-formatted `money` fn (from usePos) so amounts stay in the store currency.
import { t } from "@/lib/i18n";
import { methodLabel } from "@/lib/payment-methods";

export type ReceiptLine = { name: string; qty: number; price: number; total: number };

/** One part of a split tender, kept raw so the modal can format it itself. */
export type ReceiptTender = { method: string; raw: number };

export type Receipt = {
  number: number;
  kind: "sale" | "layby";
  status: string;
  bizName: string;
  storeName: string;
  /** Contact details of the location that issued the receipt (small print). */
  storeAddress?: string | null;
  storePhone?: string | null;
  storeEmail?: string | null;
  storeTaxNumber?: string | null;
  cashier: string;
  date: string;
  lines: ReceiptLine[];
  subtotal: number;
  tax: number;
  taxRate: number;
  taxInclusive: boolean;
  discount?: number;
  total: number;
  method: string;
  paid: number;
  change: number;
  tenders?: ReceiptTender[];
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  /** Total refunded so far; renderers add Refunded/Net rows when > 0. */
  refunded?: number;
};

export type MoneyFmt = (n: number) => string;

// One label source for receipts, screens, PDFs and CSV exports.
export { methodLabel };

export function receiptTitle(r: Receipt) {
  if (r.kind === "layby")
    return r.status === "layby_completed" ? t("doc.titleLaybyPaid") : t("doc.titleLaybyReceipt");
  return t("doc.titleSaleReceipt");
}

const STATUS_KEYS: Record<string, string> = {
  completed: "doc.badgePaid",
  layby_open: "doc.badgeLaybyOpen",
  layby_completed: "doc.badgeLaybyPaid",
  refunded: "doc.badgeRefunded",
  partially_refunded: "doc.badgePartRefunded",
};

/** Localised chip label for a receipt status ("" when it needs no chip). */
export const statusLabel = (status: string) => {
  const key = STATUS_KEYS[status];
  return key ? t(key) : "";
};

/** The persisted-sale fields the receipt builder reads (a SaleRow subset). */
export type SaleForReceipt = {
  number: number;
  kind: "sale" | "layby";
  status: string;
  total: number | string;
  paid: number | string;
  tax: number | string;
  refunded: number | string;
  discount?: number | string | null;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  created_at: string;
  sale_items: { name: string; qty: number | string; price: number | string }[];
};

/**
 * Rebuild a printable Receipt from a persisted sale so detail/export screens
 * reuse the till's thermal builder instead of the A4 document. `cashier` is
 * the resolved staff name; store VAT settings drive the tax line.
 */
export function saleToReceipt(
  s: SaleForReceipt,
  o: {
    bizName: string;
    store?:
      | {
          name: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          tax_number: string | null;
          tax_rate: number;
          tax_inclusive: boolean;
        }
      | undefined;
    cashier: string;
  },
): Receipt {
  const lines = s.sale_items.map((i) => ({
    name: i.name,
    qty: Number(i.qty),
    price: Number(i.price),
    total: Number(i.qty) * Number(i.price),
  }));
  const total = Number(s.total);
  const paid = Number(s.paid);
  return {
    number: s.number,
    kind: s.kind,
    status: s.status,
    bizName: o.bizName,
    storeName: o.store?.name ?? "",
    storeAddress: o.store?.address ?? null,
    storePhone: o.store?.phone ?? null,
    storeEmail: o.store?.email ?? null,
    storeTaxNumber: o.store?.tax_number ?? null,
    cashier: o.cashier,
    date: s.created_at,
    lines,
    subtotal: lines.reduce((a, l) => a + l.total, 0),
    tax: Number(s.tax),
    taxRate: Number(o.store?.tax_rate ?? 0),
    taxInclusive: o.store?.tax_inclusive ?? true,
    discount: Number(s.discount ?? 0),
    total,
    method: s.payment_method ?? "cash",
    paid,
    change: Math.max(0, paid - total),
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    note: s.note,
    refunded: Number(s.refunded),
  };
}

/**
 * Receipt HTML is built by string concatenation and inserted via innerHTML, so
 * every value must pass through here. Control characters (NUL, tab, newline,
 * CR and everything 0x00-0x1F / 0x7F-0x9F) come off first — otherwise a
 * `&#09;` or a raw newline in a note can smuggle content into the surrounding
 * tag context. Then the usual five HTML/XML entities.
 */
const esc = (t: string) =>
  t
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
    );

const W = 40; // monospace column budget for an 80mm thermal roll
const padRow = (l: string, rv: string) => {
  const space = Math.max(1, W - l.length - rv.length);
  return `${l}${" ".repeat(space)}${rv}`;
};
const rule = "-".repeat(W);

/** Contact lines printed in small type under the location name. */
const storeContact = (r: Receipt) =>
  [
    r.storeAddress,
    r.storePhone,
    r.storeEmail,
    r.storeTaxNumber ? `${t("till.vat")} ${r.storeTaxNumber}` : null,
  ].filter((v): v is string => !!v);

/** Plain-text receipt for downloading or sharing over SMS / WhatsApp. */
export function receiptText(r: Receipt, money: MoneyFmt) {
  const out: string[] = [];
  out.push(r.bizName.toUpperCase().slice(0, W));
  out.push(r.storeName);
  for (const line of storeContact(r)) out.push(line);
  out.push(receiptTitle(r));
  out.push(rule);
  out.push(padRow(t("doc.invoice"), `#${r.number}`));
  out.push(padRow(t("doc.date"), new Date(r.date).toLocaleString()));
  out.push(padRow(t("doc.servedBy"), r.cashier));
  out.push(rule);
  for (const l of r.lines) {
    out.push(l.name);
    out.push(padRow(`  ${l.qty} x ${money(l.price)}`, money(l.total)));
  }
  out.push(rule);
  if (r.discount && r.discount > 0) out.push(padRow(t("doc.discount"), `-` + money(r.discount)));
  out.push(padRow(t("doc.subtotal"), money(r.subtotal)));
  if (r.taxRate > 0)
    out.push(
      padRow(
        `${t("till.vat")} ${r.taxRate}%${r.taxInclusive ? ` (${t("till.included")})` : ""}`,
        money(r.tax),
      ),
    );
  out.push(padRow(t("doc.total"), money(r.total)));
  if (r.refunded && r.refunded > 0) {
    out.push(padRow(t("status.refunded"), "-" + money(r.refunded)));
    out.push(padRow(t("doc.net"), money(r.total - r.refunded)));
  }
  out.push(rule);
  out.push(padRow(t("doc.method"), methodLabel(r.method)));
  for (const tnd of r.tenders ?? [])
    out.push(padRow(`  ${methodLabel(tnd.method)}`, money(tnd.raw)));
  out.push(padRow(r.kind === "layby" ? t("doc.deposit") : t("doc.paid"), money(r.paid)));
  if (r.change > 0) out.push(padRow(t("doc.change"), money(r.change)));
  if (r.customerName) {
    out.push(rule);
    out.push(`${t("doc.customer")}: ${r.customerName}`);
    if (r.customerPhone) out.push(`${t("till.phoneLabel")}: ${r.customerPhone}`);
  }
  if (r.note) out.push(`${t("doc.noteLabel")} ${r.note}`);
  out.push(rule);
  out.push(t("doc.thankYouKeep"));
  out.push(`*${r.number}*`);
  return out.join("\n");
}

/** 80mm thermal HTML for the print sheet. */
export function receiptHtml(r: Receipt, money: MoneyFmt) {
  const status = statusLabel(r.status);
  const row = (l: string, v: string, bold = false) =>
    '<div class="lr' +
    (bold ? " b" : "") +
    '"><span>' +
    esc(l) +
    "</span><span>" +
    v +
    "</span></div>";
  const dashed = '<div class="dashed"></div>';
  const itemRows = r.lines
    .map(
      (l) =>
        '<div class="it"><div class="nm">' +
        esc(l.name) +
        '</div><div class="lr"><span>' +
        l.qty +
        " × " +
        esc(money(l.price)) +
        "</span><span>" +
        esc(money(l.total)) +
        "</span></div></div>",
    )
    .join("");
  const titleChip = status ? ' <span class="chip">' + esc(status) + "</span>" : "";
  const vatRow =
    r.taxRate > 0
      ? row(
          `${t("till.vat")} ${r.taxRate}% ${r.taxInclusive ? t("till.included") : t("till.added")}`,
          esc(money(r.tax)),
        )
      : "";
  const paidRow = row(r.kind === "layby" ? t("doc.deposit") : t("doc.paid"), esc(money(r.paid)));
  const tenderRows = (r.tenders ?? [])
    .map((tnd) => row(methodLabel(tnd.method), esc(money(tnd.raw))))
    .join("");
  const discountRow =
    r.discount && r.discount > 0 ? row(t("doc.discount"), esc("-" + money(r.discount))) : "";
  const refundRows =
    r.refunded && r.refunded > 0
      ? row(t("status.refunded"), esc("-" + money(r.refunded))) +
        row(t("doc.net"), esc(money(r.total - r.refunded)), true)
      : "";
  const changeRow = r.change > 0 ? row(t("doc.change"), esc(money(r.change))) : "";
  const meta =
    (r.customerName ? row(t("doc.customer"), esc(r.customerName)) : "") +
    (r.customerPhone ? row(t("till.phoneLabel"), esc(r.customerPhone)) : "") +
    (r.note ? row(t("doc.noteLabel"), esc(r.note)) : "");
  const metaBlock = meta ? dashed + meta : "";
  const contactBlock = storeContact(r)
    .map((line) => '<div class="sm">' + esc(line) + "</div>")
    .join("");
  const parts = [
    '<div class="rcp">',
    '<div class="hd">' + esc(r.bizName) + "</div>",
    '<div class="sub">' + esc(r.storeName) + "</div>",
    contactBlock,
    '<div class="ttl">' + esc(receiptTitle(r)) + titleChip + "</div>",
    dashed,
    row(t("doc.invoice"), "#" + r.number),
    row(t("doc.date"), esc(new Date(r.date).toLocaleString())),
    row(t("doc.servedBy"), esc(r.cashier)),
    dashed,
    itemRows,
    dashed,
    discountRow,
    row(t("doc.subtotal"), esc(money(r.subtotal))),
    vatRow,
    row(t("doc.total"), esc(money(r.total)), true),
    refundRows,
    dashed,
    row(t("doc.method"), esc(methodLabel(r.method))),
    tenderRows,
    paidRow,
    changeRow,
    metaBlock,
    dashed,
    '<div class="ft">' + esc(t("doc.thankYouKeep")) + "</div>",
    '<div class="bc">*' + r.number + "*</div>",
    "</div>",
  ];
  return parts.join("");
}

const PRINT_CSS =
  "@page{size:80mm auto;margin:4mm}*{box-sizing:border-box;margin:0;padding:0}" +
  "body{font-family:'Courier New',ui-monospace,monospace;color:#111;background:#fff;width:72mm}" +
  ".rcp{width:100%;font-size:12px;line-height:1.45}" +
  ".hd{font-size:16px;font-weight:800;text-align:center;letter-spacing:1px}" +
  ".sub,.ft,.bc{text-align:center}.sub{font-size:11px;margin-top:2px}" +
  ".sm{text-align:center;font-size:9px;line-height:1.35}" +
  ".ttl{text-align:center;font-weight:700;margin:6px 0 2px}" +
  ".chip{border:1px solid #111;border-radius:3px;padding:0 4px;font-size:9px;vertical-align:middle}" +
  ".dashed{border-top:1px dashed #999;margin:6px 0}" +
  ".lr{display:flex;justify-content:space-between;gap:8px}.lr.b{font-weight:800;font-size:14px}" +
  ".it{margin:3px 0}.it .nm{font-weight:600}" +
  ".ft{margin-top:8px;font-size:11px}.bc{margin-top:4px;letter-spacing:2px}";

/** Open the receipt in a thermal-sized window and trigger printing. */
export function printReceipt(r: Receipt, money: MoneyFmt) {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return false;
  w.document.write(
    // eslint-disable-next-line no-useless-escape
    `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${r.number}</title><style>${PRINT_CSS}</style></head><body>${receiptHtml(r, money)}<script>window.onload=function(){setTimeout(function(){window.print()},60)}<\/script></body></html>`,
  );
  w.document.close();
  return true;
}

/** Download the receipt as a plain-text file. */
export function downloadReceipt(r: Receipt, money: MoneyFmt) {
  const blob = new Blob([receiptText(r, money)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `storq-receipt-${r.number}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
