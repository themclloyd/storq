import { describe, expect, it } from "vitest";
import {
  AUTO_PREFIX,
  findCodeClash,
  isAutoCode,
  normalizeCode,
  qrPayload,
  suggestCode,
  takenCodes,
} from "@/lib/item-codes";

/** Catalog stubs: only `id` + `sku` matter to the code helpers. */
const items = [
  { id: "a", sku: "BOX 1" },
  { id: "b", sku: null },
  { id: "c", sku: "  box   1 " },
];

describe("normalizeCode", () => {
  it("trims and collapses inner space runs so a pasted code matches a typed one", () => {
    expect(normalizeCode("  ABC \t 12 \n")).toBe("ABC 12");
    expect(normalizeCode("   ")).toBe("");
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
  });
});

describe("suggestCode", () => {
  it("mints codes of the generated shape, without ambiguous characters", () => {
    const code = suggestCode([]);
    expect(code.startsWith(AUTO_PREFIX)).toBe(true);
    expect(code).toHaveLength(1 + 10);
    expect(isAutoCode(code)).toBe(true);
    // I/O/1/0/U are excluded: a code read aloud or retyped from a label stays unambiguous.
    expect(/[IOU01]/.test(code.slice(1))).toBe(false);
  });

  it("never returns a code already in the catalog", () => {
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const next = suggestCode(seen);
      expect(seen).not.toContain(next);
      seen.push(next);
    }
    expect(new Set(seen).size).toBe(60);
  });

  it("ignores blank and case-matched entries in the taken pool", () => {
    expect(isAutoCode(suggestCode([" ", "", "s2222222222"]))).toBe(true);
  });
});

describe("isAutoCode", () => {
  it("is case-insensitive but length-strict", () => {
    const code = suggestCode([]);
    expect(isAutoCode(code.toLowerCase())).toBe(true);
    expect(isAutoCode(` ${code} `)).toBe(true);
    expect(isAutoCode(`${code}X`)).toBe(false);
    expect(isAutoCode("S-1")).toBe(false);
    expect(isAutoCode("")).toBe(false);
  });
});

describe("findCodeClash", () => {
  it("matches on the normalized code, whatever case or spacing each side used", () => {
    expect(findCodeClash(items, "Box  1")?.id).toBe("a");
    expect(findCodeClash(items, "box1")?.id).toBeUndefined();
  });

  it("lets an edit ignore its own row", () => {
    expect(findCodeClash(items, "BOX 1", "a")?.id).toBe("c");
    expect(findCodeClash(items, "  Box 1  ", "c")?.id).toBe("a");
  });

  it("never clashes on an empty code — the server generates one", () => {
    expect(findCodeClash(items, "")).toBeUndefined();
    expect(findCodeClash(items, "   ")).toBeUndefined();
  });
});

describe("takenCodes", () => {
  it("lists only real codes for the generator to avoid", () => {
    expect(takenCodes(items)).toEqual(["BOX 1", "  box   1 "]);
    expect(takenCodes([{ sku: "  " }, { sku: null }])).toEqual([]);
  });
});

describe("qrPayload", () => {
  it("carries the raw code and nothing else, so guns and cameras agree", () => {
    expect(qrPayload(" Box  1 ")).toBe("Box 1");
    expect(qrPayload("S4K7HM2P9QX")).toBe("S4K7HM2P9QX");
    expect(qrPayload("https://storq.app/x")).toBe("https://storq.app/x");
  });
});
