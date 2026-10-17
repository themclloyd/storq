// Client-side branded PDF documents (real vector text, not screenshots).
// Load lazily so jsPDF never enters the SSR bundle path.

import { csvCell } from "@/lib/validate";
import { t } from "@/lib/i18n";
import {
  methodLabel,
  receiptTitle,
  statusLabel,
  type MoneyFmt,
  type Receipt,
} from "@/lib/receipts";

export type PdfKpi = [label: string, value: string];
export type PdfSection =
  | {
      type: "table";
      heading?: string | undefined;
      head: string[];
      body: (string | number)[][];
      foot?: (string | number)[] | undefined;
      align?: ("left" | "right")[] | undefined;
    }
  | { type: "pairs"; heading?: string | undefined; rows: [string, string][] }
  | { type: "text"; heading?: string | undefined; text: string };

export type PdfDoc = {
  filename: string;
  title: string;
  business?: string | undefined;
  subtitle?: string | undefined;
  badge?: string | undefined;
  meta?: [string, string][] | undefined;
  kpis?: PdfKpi[] | undefined;
  sections: PdfSection[];
  totals?: [string, string][] | undefined;
  footerNote?: string | undefined;
  orientation?: "portrait" | "landscape" | undefined;
};

const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [113, 113, 122];
const LINE: [number, number, number] = [228, 228, 231];
const LIME: [number, number, number] = [209, 237, 113];
const SOFT: [number, number, number] = [247, 247, 245];

// Standard PDF fonts only cover Latin-1; normalise common typographic glyphs.
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/[\u2212\u2013]/g, "-")
    .replace(/\u00d7/g, "x")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xff\u2014]/g, "");

export async function downloadPdf(d: PdfDoc) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: d.orientation ?? "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  // Brand header
  doc.setFillColor(...LIME);
  doc.rect(0, 0, W, 6, "F");
  doc.setFillColor(...INK);
  doc.roundedRect(M, y, 22, 22, 5, 5, "F");
  doc
    .setTextColor(...LIME)
    .setFont("helvetica", "bold")
    .setFontSize(13)
    .text("S", M + 7, y + 15.5);
  doc
    .setTextColor(...INK)
    .setFontSize(11)
    .text(clean(d.business || "Storq"), M + 30, y + 9);
  doc
    .setFont("helvetica", "normal")
    .setFontSize(8)
    .setTextColor(...MUTED)
    .text(clean(t("doc.poweredBy")), M + 30, y + 20);
  if (d.badge) {
    doc.setFont("helvetica", "bold").setFontSize(8);
    const bw = doc.getTextWidth(clean(d.badge)) + 16;
    doc.setFillColor(...LIME).roundedRect(W - M - bw, y + 3, bw, 16, 8, 8, "F");
    doc.setTextColor(...INK).text(clean(d.badge), W - M - bw + 8, y + 14);
  }
  y += 50;
  doc
    .setTextColor(...INK)
    .setFont("helvetica", "bold")
    .setFontSize(22)
    .text(clean(d.title), M, y);
  if (d.subtitle) {
    y += 16;
    doc
      .setFont("helvetica", "normal")
      .setFontSize(10)
      .setTextColor(...MUTED)
      .text(clean(d.subtitle), M, y);
  }
  y += 14;

  // Meta grid
  if (d.meta?.length) {
    const cols = Math.min(4, d.meta.length);
    const cw = (W - 2 * M) / cols;
    d.meta.forEach(([k, v], i) => {
      const cx = M + (i % cols) * cw;
      const cy = y + 14 + Math.floor(i / cols) * 32;
      doc
        .setFont("helvetica", "normal")
        .setFontSize(7.5)
        .setTextColor(...MUTED)
        .text(clean(k).toUpperCase(), cx, cy);
      doc
        .setFont("helvetica", "bold")
        .setFontSize(10)
        .setTextColor(...INK)
        .text(clean(v), cx, cy + 13, { maxWidth: cw - 8 });
    });
    y += 14 + Math.ceil(d.meta.length / cols) * 32;
  }

  // KPI cards
  if (d.kpis?.length) {
    const n = d.kpis.length;
    const gap = 8;
    const cw = (W - 2 * M - gap * (n - 1)) / n;
    d.kpis.forEach(([k, v], i) => {
      const cx = M + i * (cw + gap);
      doc
        .setFillColor(...SOFT)
        .setDrawColor(...LINE)
        .roundedRect(cx, y, cw, 50, 6, 6, "FD");
      doc
        .setFont("helvetica", "normal")
        .setFontSize(7.5)
        .setTextColor(...MUTED)
        .text(clean(k).toUpperCase(), cx + 10, y + 17);
      doc
        .setFont("helvetica", "bold")
        .setFontSize(12)
        .setTextColor(...INK)
        .text(clean(v), cx + 10, y + 37, { maxWidth: cw - 16 });
    });
    y += 66;
  }

  const heading = (t?: string) => {
    if (!t) return;
    if (y > H - 100) {
      doc.addPage();
      y = M;
    }
    doc
      .setFont("helvetica", "bold")
      .setFontSize(11)
      .setTextColor(...INK)
      .text(clean(t), M, y + 10);
    y += 18;
  };
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  for (const s of d.sections) {
    heading(s.heading);
    if (s.type === "text") {
      doc
        .setFont("helvetica", "normal")
        .setFontSize(9.5)
        .setTextColor(...MUTED);
      const lines = doc.splitTextToSize(clean(s.text), W - 2 * M);
      doc.text(lines, M, y + 8);
      y += lines.length * 12 + 14;
      continue;
    }
    const isPairs = s.type === "pairs";
    const align = s.type === "table" ? s.align : undefined;
    const colStyles: Record<number, { halign: "left" | "right"; fontStyle?: "bold" }> = {};
    if (isPairs) colStyles[1] = { halign: "right", fontStyle: "bold" };
    align?.forEach((a, i) => (colStyles[i] = { halign: a }));
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      ...(isPairs ? {} : { head: [s.head.map(clean)] }),
      body: (isPairs ? s.rows : s.body).map((r) => r.map(clean)),
      ...(!isPairs && s.foot ? { foot: [s.foot.map(clean)] } : {}),
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 9,
        textColor: INK,
        cellPadding: { top: 6, bottom: 6, left: 8, right: 8 },
        lineColor: LINE,
        lineWidth: { bottom: 0.5 },
      },
      headStyles: {
        fillColor: INK,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
        lineWidth: 0,
      },
      footStyles: { fillColor: SOFT, textColor: INK, fontStyle: "bold" },
      ...(isPairs
        ? {}
        : { alternateRowStyles: { fillColor: [252, 252, 251] as [number, number, number] } }),
      columnStyles: colStyles,
      didParseCell: (c) => {
        if ((c.section === "head" || c.section === "foot") && align?.[c.column.index])
          c.cell.styles.halign = align[c.column.index]!;
      },
    });
    y = last() + 18;
  }

  if (d.totals?.length) {
    if (y > H - 40 - d.totals.length * 20) {
      doc.addPage();
      y = M;
    }
    const bx = W - M - 220;
    d.totals.forEach(([k, v], i) => {
      const bold = i === d.totals!.length - 1;
      if (bold) {
        doc.setFillColor(...LIME).roundedRect(bx - 8, y - 2, 228, 22, 4, 4, "F");
      }
      doc
        .setFont("helvetica", bold ? "bold" : "normal")
        .setFontSize(bold ? 11 : 9.5)
        .setTextColor(...(bold ? INK : MUTED))
        .text(clean(k), bx, y + 13);
      doc
        .setTextColor(...INK)
        .setFont("helvetica", "bold")
        .text(clean(v), W - M, y + 13, { align: "right" });
      y += 22;
    });
    y += 8;
  }

  if (d.footerNote) {
    if (y > H - 70) {
      doc.addPage();
      y = M;
    }
    doc
      .setFont("helvetica", "normal")
      .setFontSize(9)
      .setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(clean(d.footerNote), W - 2 * M), M, y + 8);
  }

  const pages = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE).line(M, H - 32, W - M, H - 32);
    doc
      .setFont("helvetica", "normal")
      .setFontSize(7.5)
      .setTextColor(...MUTED);
    doc.text(`Generated ${stamp} · Storq`, M, H - 20);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 20, { align: "right" });
  }
  doc.save(d.filename.endsWith(".pdf") ? d.filename : `${d.filename}.pdf`);
}

// ---------- Thermal receipt PDF (80mm roll) ----------
// The till prints on an 80mm thermal roll (see PRINT_CSS in receipts.ts), so a
// saved receipt is cut to that same roll — an A4 sheet shrinks the receipt into
// a corner and looks nothing like what leaves the printer. Courier matches the
// monospace look of the printed sheet.

const ROLL = 80; // roll width in mm
const R_SIDE = 4; // matches the 4mm @page margin of the print sheet
const R_TEXT = ROLL - R_SIDE * 2; // printable width inside the margins
const R_PT = 0.3528; // one point in mm

export async function downloadReceiptPdf(r: Receipt, money: MoneyFmt) {
  const { jsPDF } = await import("jspdf");
  // A receipt is one continuously tall page: draw once on a tall scratch page
  // to measure the roll length, then draw the same deterministic layout at the
  // exact size. The floor height keeps jsPDF's portrait normalisation from
  // turning a short receipt sideways.
  const draw = (doc: InstanceType<typeof jsPDF>) => {
    let y = 7;
    const setF = (style: "normal" | "bold", size: number) =>
      doc.setFont("courier", style).setFontSize(size);
    const line = (size: number) => size * R_PT * 1.5;
    const center = (text: string, size: number, style: "normal" | "bold" = "normal") => {
      setF(style, size);
      doc.text(clean(text), ROLL / 2, y, { align: "center" });
      y += line(size);
    };
    const left = (text: string, size = 9) => {
      setF("normal", size);
      const ls = doc.splitTextToSize(clean(text), R_TEXT) as string[];
      doc.text(ls, R_SIDE, y);
      y += ls.length * line(size);
    };
    // Left label / right value; the pair shrinks a step at a time so a long
    // label can never run its amount over.
    const row = (l: string, v: string, size = 9, style: "normal" | "bold" = "normal") => {
      let s = size;
      setF(style, s);
      const fits = () => doc.getTextWidth(clean(l)) + doc.getTextWidth(clean(v)) + 3 <= R_TEXT;
      while (!fits() && s > 6.5) {
        s -= 0.5;
        setF(style, s);
      }
      doc.text(clean(l), R_SIDE, y);
      doc.text(clean(v), ROLL - R_SIDE, y, { align: "right" });
      y += line(s);
    };
    const rule = () => {
      doc.setDrawColor(153).setLineWidth(0.25).setLineDashPattern([1, 1], 0);
      doc.line(R_SIDE, y - 1.5, ROLL - R_SIDE, y - 1.5);
      doc.setLineDashPattern([], 0);
      y += 3;
    };

    center(r.bizName, 13, "bold");
    center(r.storeName, 8.5);
    center(receiptTitle(r), 10, "bold");
    const status = statusLabel(r.status);
    if (status) center(status, 8);
    rule();
    row(t("doc.invoice"), `#${r.number}`);
    row(t("doc.date"), new Date(r.date).toLocaleString());
    row(t("doc.servedBy"), r.cashier);
    rule();
    for (const l of r.lines) {
      setF("bold", 9);
      const names = doc.splitTextToSize(clean(l.name), R_TEXT) as string[];
      doc.text(names, R_SIDE, y);
      y += names.length * line(9);
      row(`  ${l.qty} x ${money(l.price)}`, money(l.total));
    }
    rule();
    if (r.discount && r.discount > 0) row(t("doc.discount"), `-${money(r.discount)}`);
    row(t("doc.subtotal"), money(r.subtotal));
    if (r.taxRate > 0)
      row(
        `${t("till.vat")} ${r.taxRate}%${r.taxInclusive ? ` (${t("till.included")})` : ""}`,
        money(r.tax),
      );
    row(t("doc.total"), money(r.total), 11, "bold");
    rule();
    row(t("doc.method"), methodLabel(r.method));
    for (const tnd of r.tenders ?? []) row(`  ${methodLabel(tnd.method)}`, money(tnd.raw));
    row(r.kind === "layby" ? t("doc.deposit") : t("doc.paid"), money(r.paid));
    if (r.change > 0) row(t("doc.change"), money(r.change));
    if (r.customerName) {
      rule();
      left(`${t("doc.customer")}: ${r.customerName}`);
      if (r.customerPhone) left(`${t("till.phoneLabel")}: ${r.customerPhone}`);
    }
    if (r.note) left(`${t("doc.noteLabel")} ${r.note}`);
    rule();
    center(t("doc.thankYouKeep"), 8);
    setF("bold", 11);
    doc.text(`*${r.number}*`, ROLL / 2, y, { align: "center", charSpace: 0.8 });
    y += line(11);
    return y;
  };

  const end = draw(new jsPDF({ unit: "mm", format: [ROLL, 6000] }));
  const doc = new jsPDF({
    unit: "mm",
    format: [ROLL, Math.max(ROLL + 4, Math.ceil(end + 6))],
  });
  draw(doc);
  doc.save(`storq-receipt-${r.number}.pdf`);
}

// ---------- CSV ----------
// Every cell passes through csvCell: formula-injection (= + - @ leads) gets an
// apostrophe prefix so Excel/Sheets never executes a stored "formula".
export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((v) => csvCell(v)).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cur = "",
    q = false;
  const t = text.replace(/^\ufeff/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

export const fileStamp = () => new Date().toISOString().slice(0, 10);

// ---------- Printable QR labels ----------
// Shelf/stock labels for the one item code. The QR image is generated from the
// same module grid the dialog previewed (src/lib/qr.ts), and the human-readable
// code is printed under it so the label still works if the print goes smudged.

export type LabelSpec = {
  name: string;
  code: string;
  /** Already-formatted price text ("MK1,200"), or nothing to omit the line. */
  price?: string | null | undefined;
  /** How many copies of this label to cut (default 1). */
  copies?: number | undefined;
};

export async function downloadLabelSheet(d: {
  labels: LabelSpec[];
  business?: string | undefined;
  storeName?: string | undefined;
}) {
  const [{ jsPDF }, { qrPngDataUrl }] = await Promise.all([import("jspdf"), import("@/lib/qr")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const COLS = 3;
  const GAP = 10;
  const LW = (W - 2 * M - GAP * (COLS - 1)) / COLS;
  const LH = 92;
  const QR = 62;

  // One PNG per code, reused across copies: 4x the drawn size keeps it sharp.
  const images = new Map<string, string>();
  for (const l of d.labels) {
    const code = l.code.trim();
    if (!code || images.has(code)) continue;
    images.set(code, await qrPngDataUrl(code, 640));
  }

  let col = 0;
  let y = M;
  for (const l of d.labels) {
    const code = l.code.trim();
    const img = images.get(code);
    const copies = Math.max(1, Math.trunc(l.copies ?? 1));
    for (let c = 0; c < copies; c++) {
      if (col === COLS) col = 0;
      if (col === 0 && y + LH > H - M) {
        doc.addPage();
        y = M;
      }
      const x = M + col * (LW + GAP);
      col = (col + 1) % COLS;
      if (col === 0) y += LH + GAP;

      doc.setDrawColor(...LINE).setFillColor(...SOFT);
      doc.roundedRect(x, y, LW, LH, 6, 6, "FD");
      if (img) doc.addImage(img, "PNG", x + 8, y + (LH - QR) / 2, QR, QR);

      const tx = x + 8 + QR + 8;
      const tw = LW - QR - 32;
      doc
        .setTextColor(...INK)
        .setFont("helvetica", "bold")
        .setFontSize(9);
      const nameLines = doc.splitTextToSize(clean(l.name), tw).slice(0, 2) as string[];
      doc.text(nameLines, tx, y + 20);
      let ty = y + 22 + nameLines.length * 11;
      if (l.price) {
        doc.setFont("helvetica", "bold").setFontSize(11);
        doc.text(clean(l.price), tx, ty);
        ty += 15;
      }
      // Code text pinned to the label foot: readable even if the QR wears off.
      doc
        .setFont("helvetica", "normal")
        .setFontSize(7.5)
        .setTextColor(...MUTED)
        .text(clean(code), tx, Math.min(ty, y + LH - 9));
    }
  }

  const pages = doc.getNumberOfPages();
  const who = [d.business, d.storeName].filter(Boolean).join(" · ");
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc
      .setFont("helvetica", "normal")
      .setFontSize(7.5)
      .setTextColor(...MUTED);
    doc.text(clean(who || "Storq"), M, H - 14);
    doc.text(t("doc.labelPage", { page: p, total: pages }), W - M, H - 14, { align: "right" });
  }
  doc.save(`storq-labels-${fileStamp()}.pdf`);
}
