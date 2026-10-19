import { describe, expect, it } from "vitest";
import {
  sanitizeText,
  requireText,
  validateEmail,
  validatePassword,
  validateAmount,
  validateSku,
  csvCell,
  LIMITS,
} from "@/lib/validate";

describe("sanitizeText — nothing that starts markup leaves the browser", () => {
  it("strips control chars, angle brackets, backticks and collapses whitespace", () => {
    expect(sanitizeText("  a\u0000b <script> `x`  y  ", 100)).toBe("ab script x y");
  });
  it("truncates to the max length", () => {
    expect(sanitizeText("abcdefghij", 4)).toBe("abcd");
  });
});

describe("requireText — server bounds mirrored with a readable message", () => {
  it("accepts a clean value", () => {
    expect(requireText("Fresh Bread", "item name", LIMITS.productName)).toBeNull();
  });
  it("rejects empty, over-long and unsafe input", () => {
    expect(requireText("   ", "item name")).not.toBeNull();
    expect(requireText("x".repeat(LIMITS.name + 1), "name", LIMITS.name)).not.toBeNull();
    expect(requireText("a<b", "name", LIMITS.name)).not.toBeNull(); // angle bracket
  });
  it("no longer rejects a double dash — writes are parameterized, not interpolated", () => {
    expect(requireText("drop--users", "name", LIMITS.name)).toBeNull();
    expect(requireText("Tee -- blue", "name", LIMITS.name)).toBeNull();
    // Markup is still refused on the same path.
    expect(requireText("drop<script>", "name", LIMITS.name)).not.toBeNull();
  });
});

describe("credential rules", () => {
  it("email shape is enforced and capped", () => {
    expect(validateEmail("owner@shop.co")).toBeNull();
    expect(validateEmail("not-an-email")).not.toBeNull();
    expect(validateEmail("")).not.toBeNull();
  });
  it("password needs length + a letter + a digit", () => {
    expect(validatePassword("correct42")).toBeNull();
    expect(validatePassword("short1")).not.toBeNull(); // < 8
    expect(validatePassword("allletters")).not.toBeNull(); // no digit
    expect(validatePassword("12345678")).not.toBeNull(); // no letter
  });
});

describe("validateAmount — same numeric bounds as the RPC and CHECK", () => {
  it("accepts two-decimal money within range", () => {
    expect(validateAmount("19.99", { label: "price", min: 0 })).toBeNull();
  });
  it("rejects >2 decimals, letters, negatives below min and over-cap values", () => {
    expect(validateAmount("1.234", { label: "price" })).not.toBeNull();
    expect(validateAmount("abc", { label: "price" })).not.toBeNull();
    expect(validateAmount("-5", { label: "price", min: 0 })).not.toBeNull();
    expect(validateAmount(LIMITS.money + 1, { label: "price", min: 0 })).not.toBeNull();
  });
  it("integer fields reject fractions", () => {
    expect(validateAmount("2.5", { label: "qty", integer: true })).not.toBeNull();
    expect(validateAmount("2", { label: "qty", integer: true })).toBeNull();
  });
});

describe("validateSku", () => {
  it("permits blanks (auto-code fills later) and simple codes; blocks markup", () => {
    expect(validateSku("")).toBeNull();
    expect(validateSku("SUG-1_2.0")).toBeNull();
    expect(validateSku("bad/sku")).not.toBeNull();
  });
});

describe("csvCell — Excel formula-injection guard", () => {
  it("neutralises cells that would execute as a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1attack")).toBe("'+1attack");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1")).toBe("'-1");
  });
  it("quotes cells containing a comma, quote or newline", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it("leaves plain text untouched", () => {
    expect(csvCell("Sugar 1kg")).toBe("Sugar 1kg");
  });
});
