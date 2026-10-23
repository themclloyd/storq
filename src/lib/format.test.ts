import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";

describe("formatMoney — currency display", () => {
  it("prints ISO codes as their local sign", () => {
    expect(formatMoney("MWK", 6000)).toBe("MK6,000");
    expect(formatMoney("zar", 2500.5)).toBe("R2,500.50");
  });
  it("leaves a symbol an older tenant stored untouched", () => {
    expect(formatMoney("MK", 41400)).toBe("MK41,400");
    expect(formatMoney("", 12)).toBe("12");
  });
  it("keeps the real minus before the sign", () => {
    expect(formatMoney("MWK", -41400)).toBe("\u2212MK41,400");
  });
});
