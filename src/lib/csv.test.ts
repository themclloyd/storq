import { describe, expect, it } from "vitest";
import { parseCsv, readCsvText, toCsv } from "@/lib/pdf";
import { LIMITS, csvFileIssue, parseAmountCell, validateCsvFile } from "@/lib/validate";

describe("parseCsv — text tables only", () => {
  it("reads quoted fields, doubled quotes and both delimiters", () => {
    expect(parseCsv('name,note\n"Sugar, 1kg","say ""hi"""')).toEqual([
      ["name", "note"],
      ["Sugar, 1kg", 'say "hi"'],
    ]);
    expect(parseCsv("a;b\nc;d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("strips a BOM, handles CRLF and skips blank lines", () => {
    expect(parseCsv("\ufeffa,b\r\n\r\n\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("keeps a newline inside a quoted cell", () => {
    expect(parseCsv('name,note\n"a\nb",c')).toEqual([
      ["name", "note"],
      ["a\nb", "c"],
    ]);
  });
  it("refuses an unclosed quote instead of inventing rows", () => {
    expect(() => parseCsv('name,sku\n"abc,1')).toThrow();
  });
  it("refuses a row wider than the column cap", () => {
    expect(() => parseCsv("a" + ",".repeat(LIMITS.csvColumns + 1))).toThrow();
  });
  it("round-trips an export through the parser", () => {
    expect(
      parseCsv(
        toCsv([
          ["name", "note"],
          ["Sugar, 1kg", 'say "hi"'],
        ]),
      ),
    ).toEqual([
      ["name", "note"],
      ["Sugar, 1kg", 'say "hi"'],
    ]);
  });
});

describe("validateCsvFile — the picker's accept is only a hint", () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });

  it("accepts what a browser actually reports for a CSV", () => {
    expect(validateCsvFile(file("items.csv", "text/csv", 2048))).toBeNull();
    expect(validateCsvFile(file("ITEMS.CSV", "application/vnd.ms-excel", 2048))).toBeNull();
    expect(validateCsvFile(file("items.csv", "", 2048))).toBeNull();
  });
  it("rejects an empty, oversized or misnamed file", () => {
    expect(validateCsvFile(file("items.csv", "text/csv", 0))).not.toBeNull();
    expect(validateCsvFile(file("items.csv", "text/csv", LIMITS.csvBytes + 1))).not.toBeNull();
    expect(validateCsvFile(file("items.xlsx", "application/vnd.ms-excel", 2048))).not.toBeNull();
    expect(validateCsvFile(file("items", "text/csv", 2048))).not.toBeNull();
  });
  it("rejects a markup type dressed up with a .csv name", () => {
    expect(validateCsvFile(file("items.csv", "text/html", 2048))).not.toBeNull();
    expect(validateCsvFile(file("items.csv", "image/svg+xml", 2048))).not.toBeNull();
    expect(validateCsvFile(file("items.csv", "application/json", 2048))).not.toBeNull();
  });
});

describe("csvFileIssue — contents, not just the extension", () => {
  it("accepts a real table, BOM and accents included", () => {
    expect(csvFileIssue("name,sku,cost\nSugar 1kg,SUG-1,90")).toBeNull();
    expect(csvFileIssue("\ufeffname,note\nCafé,naïve — ok")).toBeNull();
    expect(csvFileIssue("name,note\nRice 🍚,fine")).toBeNull();
  });
  it("rejects a renamed workbook, PDF, gzip and RTF", () => {
    expect(csvFileIssue("PK\u0003\u0004\u0014\u0000\u0006\u0000")).not.toBeNull();
    expect(csvFileIssue("%PDF-1.7\n1 0 obj")).not.toBeNull();
    expect(csvFileIssue("\x1f\x8b\b\u0000")).not.toBeNull();
    expect(csvFileIssue("{\\rtf1\\ansi")).not.toBeNull();
  });
  it("rejects a saved web page or XML document", () => {
    expect(csvFileIssue("<!doctype html><html><body>hi</body></html>")).not.toBeNull();
    expect(csvFileIssue('  <svg xmlns="http://www.w3.org/2000/svg"/>')).not.toBeNull();
    expect(csvFileIssue('<?xml version="1.0"?><rows/>')).not.toBeNull();
  });
  it("rejects binary that decoded with control characters", () => {
    expect(csvFileIssue("name,note\nSugar\u0000,1")).not.toBeNull();
    expect(csvFileIssue("name,note\nSugar\u0001,1")).not.toBeNull();
    expect(csvFileIssue("name\tnote\nSugar,1")).toBeNull();
  });
});

describe("readCsvText — Excel's ANSI export still imports", () => {
  const fileOf = (bytes: number[]) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer });

  it("decodes UTF-8, BOM included", async () => {
    const bytes = [0xef, 0xbb, 0xbf, 0x6e, 0x6f, 0x74, 0x65, 0x2c, 0x0a, 0xc3, 0xa9]; // BOM + "note,\né"
    expect(await readCsvText(fileOf(bytes))).toBe("note,\né");
  });
  it("falls back to windows-1252 instead of mangling Café", async () => {
    const bytes = [0x6e, 0x6f, 0x74, 0x65, 0x2c, 0x0a, 0x43, 0x61, 0x66, 0xe9]; // "note,\nCafé" in 1252
    expect(await readCsvText(fileOf(bytes))).toBe("note,\nCafé");
  });
});

describe("parseAmountCell — a payload is not a price", () => {
  it("parses plain and spreadsheet-formatted numbers", () => {
    expect(parseAmountCell("25")).toBe(25);
    expect(parseAmountCell(" 25.50 ")).toBe(25.5);
    expect(parseAmountCell("MK1,200.00")).toBe(1200);
    expect(parseAmountCell("1 200")).toBe(1200);
    expect(parseAmountCell("$12.50")).toBe(12.5);
  });
  it("returns NaN for a payload or an ambiguous cell", () => {
    expect(parseAmountCell("1' OR '1'='1")).toBeNaN();
    expect(parseAmountCell("25; drop table pricing")).toBeNaN();
    expect(parseAmountCell('{"$gt":""}')).toBeNaN();
    expect(parseAmountCell("1,20")).toBeNaN();
    expect(parseAmountCell("")).toBeNaN();
    expect(parseAmountCell(undefined)).toBeNaN();
  });
});
