import { describe, expect, it, vi } from "vitest";
import { invalidateKeys, SALE_TOUCHED } from "@/lib/cache-invalidation";

// A stand-in QueryClient: we only care that each prefix is invalidated on its
// own (TanStack batches them), never that a real refetch happens.
const makeQc = () =>
  ({ invalidateQueries: vi.fn() }) as unknown as Parameters<typeof invalidateKeys>[0];

describe("SALE_TOUCHED — targeted invalidation, not a cache wipe", () => {
  it("covers every money/stock surface a sale or refund can move", () => {
    const prefixes = SALE_TOUCHED.map((k) => String(k[0]));
    for (const key of ["sales", "sale", "refunds", "stock", "movements", "drawer", "shifts"]) {
      expect(prefixes).toContain(key);
    }
  });

  it("never touches the catalog/subscription keys (a sale must not re-pull them)", () => {
    const prefixes = SALE_TOUCHED.map((k) => String(k[0]));
    expect(prefixes).not.toContain("products");
    expect(prefixes).not.toContain("subscription");
    expect(prefixes).not.toContain("stores");
  });

  it("invalidateKeys fires one scoped invalidateQueries per prefix", () => {
    const qc = makeQc();
    invalidateKeys(qc, SALE_TOUCHED);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(SALE_TOUCHED.length);
    // Each call is keyed and never a keyless wipe.
    for (const call of vi.mocked(qc.invalidateQueries).mock.calls) {
      expect(call[0]).toHaveProperty("queryKey");
    }
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["sales"] });
  });
});
