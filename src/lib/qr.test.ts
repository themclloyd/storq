import { describe, expect, it } from "vitest";
import { QR_QUIET, buildQr, codeSlug, qrPath, qrSide, qrSvgString, type QrMatrix } from "@/lib/qr";

/** Hand-built grid: row 0 solid, row 2 dark at the edges, other rows empty. */
const tiny = (): QrMatrix => ({
  size: 4,
  dark: Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]),
});

describe("qrPath", () => {
  it("merges each horizontal run and offsets the grid by the quiet zone", () => {
    const d = qrPath(tiny(), 1);
    expect(d.match(/M/g)?.length).toBe(3);
    expect(d).toContain("M4.000 4.000h4.000v1.000h-4.000z");
    expect(d).toContain("M4.000 6.000h1.000v1.000h-1.000z");
    expect(d).toContain("M7.000 6.000h1.000v1.000h-1.000z");
  });

  it("scales modules and quiet zone together, so a print stays proportional", () => {
    expect(qrPath(tiny(), 2)).toContain("M8.000 8.000h8.000v2.000h-8.000z");
    expect(qrPath(tiny(), 2)).not.toContain("M4.000");
  });

  it("draws nothing for an all-light grid", () => {
    expect(qrPath({ size: 3, dark: new Uint8Array(9) })).toBe("");
  });
});

describe("qrSide", () => {
  it("adds the quiet zone to both edges before scaling", () => {
    const m: QrMatrix = { size: 21, dark: new Uint8Array(21 * 21) };
    expect(QR_QUIET).toBe(4);
    expect(qrSide(m, 1)).toBe(29);
    expect(qrSide(m, 3)).toBe(87);
  });
});

describe("buildQr", () => {
  it("returns no grid for a blank payload", async () => {
    expect(await buildQr("")).toBeNull();
    expect(await buildQr("   ")).toBeNull();
  });

  it("encodes the code into a square grid with finder patterns", async () => {
    const m = await buildQr("BOX 1");
    expect(m).not.toBeNull();
    const grid = m!;
    expect(grid.dark).toHaveLength(grid.size * grid.size);
    expect(grid.size).toBeGreaterThanOrEqual(21);

    const at = (r: number, c: number) => grid.dark[r * grid.size + c] === 1;
    // The three finder patterns are the reason a scanner can lock on at any angle.
    expect([at(0, 0), at(0, 6), at(6, 0), at(6, 6), at(3, 3)]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(at(0, 7)).toBe(false);
    expect([at(0, grid.size - 1), at(0, grid.size - 7), at(6, grid.size - 7)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("is deterministic for one code, so preview and label cannot diverge", async () => {
    const [a, b, other] = await Promise.all([
      buildQr("S4K7HM2P9QX"),
      buildQr("S4K7HM2P9QX"),
      buildQr("S4K7HM2P9QY"),
    ]);
    expect(qrPath(a!)).toBe(qrPath(b!));
    expect(qrPath(a!)).not.toBe(qrPath(other!));
  });
});

describe("qrSvgString", () => {
  it("emits a standalone black-on-white document sized to the grid", () => {
    const svg = qrSvgString(tiny());
    const side = qrSide(tiny(), 1);
    expect(svg.startsWith("<?xml ")).toBe(true);
    expect(svg).toContain(`width="${side}" height="${side}"`);
    expect(svg).toContain(`viewBox="0 0 ${side} ${side}"`);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("<path");
  });
});

describe("codeSlug", () => {
  it("makes a file-safe name from a code that legally holds spaces and dots", () => {
    expect(codeSlug("Box 1.5")).toBe("box-1-5");
    expect(codeSlug("  S4K7HM2P9QX ")).toBe("s4k7hm2p9qx");
    expect(codeSlug("///")).toBe("code");
    expect(codeSlug("")).toBe("code");
  });
});
