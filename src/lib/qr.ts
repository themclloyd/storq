// QR rendering for item codes. `qrcode` is pulled in dynamically so it never
// enters the till's base bundle — only screens that actually show a code pay it.
//
// One matrix, three outputs: the on-screen SVG, the downloadable SVG/PNG and the
// printed label sheet all come from the same module grid, so a label can never
// disagree with what the dialog previewed.

export type QrMatrix = {
  /** Modules per side, quiet zone excluded. */
  size: number;
  /** Row-major flags, 1 = dark. */
  dark: Uint8Array;
};

/** Quiet zone in modules: 4 is the spec minimum and what scanners expect. */
export const QR_QUIET = 4;

/** Error-correction level: M survives a scuffed or partially covered label. */
const EC_LEVEL = "M" as const;

let loader: Promise<typeof import("qrcode")> | null = null;
const loadQr = () => (loader ??= import("qrcode"));

type QrLib = Awaited<ReturnType<typeof loadQr>>;
/**
 * `qrcode` ships CommonJS, so the dynamic import can arrive either as named
 * exports or as a single `default` depending on how the bundler interops it.
 * The types only declare the named shape, so resolve both at runtime.
 */
const qrLib = async (): Promise<QrLib> => {
  const mod = await loadQr();
  return (mod as QrLib & { default?: QrLib }).default ?? mod;
};

/** Build the module grid for a value. Empty values yield null (nothing to draw). */
export async function buildQr(value: string): Promise<QrMatrix | null> {
  const v = value.trim();
  if (!v) return null;
  const { create } = await qrLib();
  const qr = create(v, { errorCorrectionLevel: EC_LEVEL });
  const mod = qr.modules as unknown as { size: number; data: ArrayLike<number> };
  const dark = new Uint8Array(mod.size * mod.size);
  for (let i = 0; i < dark.length; i++) dark[i] = mod.data[i] ? 1 : 0;
  return { size: mod.size, dark };
}

/**
 * One path covering every dark module, with runs merged per row. `q` is the
 * module size in user units; the quiet zone is added around the grid.
 */
export function qrPath(m: QrMatrix, q = 1): string {
  let d = "";
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark[r * m.size + c]) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < m.size && m.dark[r * m.size + c + run]) run++;
      const x = (c + QR_QUIET) * q;
      const y = (r + QR_QUIET) * q;
      d += `M${x.toFixed(3)} ${y.toFixed(3)}h${(run * q).toFixed(3)}v${q.toFixed(3)}h${(-run * q).toFixed(3)}z`;
      c += run;
    }
  }
  return d;
}

/** Total edge length of a square SVG/PNG, quiet zone included. */
export const qrSide = (m: QrMatrix, q: number) => (m.size + QR_QUIET * 2) * q;

/** Standalone SVG document (viewBox-sized, black on white) for download. */
export function qrSvgString(m: QrMatrix): string {
  const side = qrSide(m, 1);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" ` +
    `viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#ffffff"/>` +
    `<path d="${qrPath(m)}" fill="#000000"/></svg>`
  );
}

/** PNG at a fixed pixel edge — 4× the on-screen size prints sharp. */
export async function qrPngDataUrl(value: string, px = 512): Promise<string> {
  const { toDataURL } = await qrLib();
  return toDataURL(value.trim(), {
    errorCorrectionLevel: EC_LEVEL,
    width: px,
    margin: QR_QUIET,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}

/** Trigger a browser download for a generated file (data URL or Blob). */
export function saveFile(name: string, data: Blob | string) {
  const url = typeof data === "string" ? data : URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof data !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File-safe slug for a code (codes may legally contain spaces and dots). */
export const codeSlug = (code: string) =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "code";
