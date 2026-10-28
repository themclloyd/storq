import { describe, expect, it } from "vitest";
import {
  TILL_BROWSE_LIMIT,
  TILL_SEARCH_LIMIT,
  codePattern,
  likePattern,
  tillSearchTerm,
} from "@/lib/till-catalog";

describe("till pages stay bounded", () => {
  it("never asks the database for a catalogue-sized answer", () => {
    expect(TILL_SEARCH_LIMIT).toBeGreaterThan(0);
    expect(TILL_SEARCH_LIMIT).toBeLessThanOrEqual(50);
    expect(TILL_BROWSE_LIMIT).toBeGreaterThan(0);
    expect(TILL_BROWSE_LIMIT).toBeLessThanOrEqual(100);
  });
});

describe("tillSearchTerm, safe to hand to PostgREST", () => {
  it("removes the characters PostgREST reads as filter syntax", () => {
    expect(tillSearchTerm("sugar, 1kg (red)")).toBe("sugar 1kg red");
    expect(tillSearchTerm('say "hi"')).toBe("say hi");
  });

  it("collapses whitespace, trims, and caps runaway input", () => {
    expect(tillSearchTerm("  coca   cola ")).toBe("coca cola");
    expect(tillSearchTerm("x".repeat(120))).toHaveLength(60);
  });

  it("keeps the letters, digits and dashes a cashier actually types", () => {
    expect(tillSearchTerm("Coke-500ml")).toBe("Coke-500ml");
  });
});

describe("likePattern, a cashier's punctuation is literal", () => {
  it("escapes LIKE wildcards instead of dropping them", () => {
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });

  it("wraps a plain term in wildcards", () => {
    expect(likePattern("sugar")).toBe("%sugar%");
  });
});

describe("codePattern, one code, however it was typed", () => {
  it("lets a single space stand for any spacing in the stored code", () => {
    expect(codePattern("  abc   123 ")).toBe("abc%123");
  });

  it("never turns code punctuation into a wildcard", () => {
    expect(codePattern("a_b")).toBe("a\\_b");
    expect(codePattern("100%")).toBe("100\\%");
  });
});
