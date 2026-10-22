import { describe, expect, it } from "vitest";
import {
  sanitizeText,
  requireText,
  payloadKind,
  validateEmail,
  validatePassword,
  validatePasswordInput,
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
  it("rejects a pasted JSON document or SQL payload", () => {
    expect(requireText('{"$gt":""}', "name", LIMITS.name)).not.toBeNull();
    expect(requireText("'; drop table sales; --", "name", LIMITS.name)).not.toBeNull();
    expect(requireText("1 union select pin_hash from staff", "name", LIMITS.name)).not.toBeNull();
  });
  it("no longer rejects a double dash — writes are parameterized, not interpolated", () => {
    expect(requireText("drop--users", "name", LIMITS.name)).toBeNull();
    expect(requireText("Tee -- blue", "name", LIMITS.name)).toBeNull();
    // Markup is still refused on the same path.
    expect(requireText("drop<script>", "name", LIMITS.name)).not.toBeNull();
  });
});

describe("payloadKind — a document is not a name", () => {
  it("recognises JSON objects and arrays", () => {
    expect(payloadKind('{"$gt":""}')).toBe("json");
    expect(payloadKind('[{"id":1}]')).toBe("json");
    expect(payloadKind('  {"a": {"b": 1}}  ')).toBe("json");
  });
  it("recognises SQL statement payloads", () => {
    expect(payloadKind("'; drop table sales; --")).toBe("sql");
    expect(payloadKind("x'; select pg_sleep(9); --")).toBe("sql");
    expect(payloadKind("1 union select pin_hash from staff")).toBe("sql");
    expect(payloadKind("admin' or 1=1 --")).toBe("sql");
    expect(payloadKind("note /* hidden */ here")).toBe("sql");
  });
  it("leaves prose and labels alone", () => {
    expect(payloadKind("Tee -- blue")).toBeNull();
    expect(payloadKind("[2-pack]")).toBeNull();
    expect(payloadKind("{clearance}")).toBeNull();
    expect(payloadKind("O'Brien's Bread")).toBeNull();
    expect(payloadKind("50% off; while stocks last")).toBeNull();
  });
});

describe("credential rules", () => {
  it("email shape is enforced and capped", () => {
    expect(validateEmail("owner@shop.co")).toBeNull();
    expect(validateEmail("owner+tag@sub.shop.co")).toBeNull();
    expect(validateEmail("first.last@shop.co")).toBeNull();
    expect(validateEmail("OWNER@SHOP.CO")).toBeNull();
    expect(validateEmail("not-an-email")).not.toBeNull();
    expect(validateEmail("")).not.toBeNull();
  });
  it("email refuses payload characters and malformed domains", () => {
    // JSON and SQL payloads in the local part used to pass the loose regex.
    expect(validateEmail('{"$gt":""}@shop.co')).not.toBeNull();
    expect(validateEmail("a');drop--@shop.co")).not.toBeNull();
    expect(validateEmail('a"b@shop.co')).not.toBeNull();
    expect(validateEmail("a;b@shop.co")).not.toBeNull();
    expect(validateEmail("a\\b@shop.co")).not.toBeNull();
    expect(validateEmail("<script>@shop.co")).not.toBeNull();
    expect(validateEmail("a..b@shop.co")).not.toBeNull();
    expect(validateEmail(".a@shop.co")).not.toBeNull();
    expect(validateEmail("a.@shop.co")).not.toBeNull();
    expect(validateEmail("a@shop")).not.toBeNull();
    expect(validateEmail("a@shop..co")).not.toBeNull();
    expect(validateEmail("a@-shop.co")).not.toBeNull();
    expect(validateEmail("a@shop.c")).not.toBeNull();
    expect(validateEmail("a@shop.123")).not.toBeNull();
    expect(validateEmail("a".repeat(65) + "@shop.co")).not.toBeNull();
  });
  it("password needs length + a letter + a digit", () => {
    expect(validatePassword("correct42")).toBeNull();
    expect(validatePassword("short1")).not.toBeNull(); // < 8
    expect(validatePassword("allletters")).not.toBeNull(); // no digit
    expect(validatePassword("12345678")).not.toBeNull(); // no letter
  });
  it("sign-in bounds reject control chars, payloads and >72 bytes", () => {
    expect(validatePasswordInput("")).not.toBeNull();
    expect(validatePasswordInput("pass\tword1")).not.toBeNull(); // control char
    expect(validatePasswordInput('{"$gt":""}')).not.toBeNull(); // whole JSON document
    expect(validatePasswordInput("'; drop table sales; --")).not.toBeNull(); // SQL payload
    // Payload *characters* inside a password are inert (bcrypt hashes them).
    expect(validatePasswordInput('Corr3ct-Horse;"Battery"')).toBeNull();
    // bcrypt only compares 72 bytes; anything longer must be refused up front.
    expect(validatePasswordInput("a1" + "\u00e9".repeat(36))).not.toBeNull(); // 74 bytes
    expect(validatePasswordInput("a1" + "x".repeat(70))).toBeNull();
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
