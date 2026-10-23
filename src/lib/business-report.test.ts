import { describe, expect, it } from "vitest";
import { buildBusinessReport, reportKind } from "./business-report";

const sale = (
  id: string,
  total: number,
  items: { id: string; qty: number; price: number }[],
  method = "cash",
  extra: { payments?: { amount: number; method: string }[]; storeId?: string } = {},
) => ({
  id,
  store_id: extra.storeId ?? "s1",
  status: "completed",
  total,
  paid: total,
  tax: 0,
  payment_method: method,
  ...(extra.payments ? { payments: extra.payments } : {}),
  sale_items: items.map((i) => ({ ...i, product_id: "p1", name: "Gas" })),
});

const refund = (amount: number, method = "cash", storeId = "s1") => ({
  store_id: storeId,
  amount,
  cost: 0,
  tax: 0,
  method,
  refund_items: [],
});

describe("business report", () => {
  it("real profit = money collected - stock cost - expenses", () => {
    const r = buildBusinessReport({
      sales: [sale("a", 1000, [{ id: "i1", qty: 2, price: 500 }])],
      refunds: [],
      expenses: [{ store_id: "s1", amount: 100, category: "Rent", source: "bank" }],
      costs: { i1: 300 },
    });
    expect(r.moneyCollected).toBe(1000);
    expect(r.stockCost).toBe(600);
    expect(r.productProfit).toBe(400);
    expect(r.realProfit).toBe(300);
  });

  it("refunds reduce money collected and return their stock cost", () => {
    const r = buildBusinessReport({
      sales: [sale("a", 1000, [{ id: "i1", qty: 2, price: 500 }])],
      refunds: [
        { store_id: "s1", amount: 500, cost: 300, tax: 0, method: "cash", refund_items: [] },
      ],
      expenses: [],
      costs: { i1: 300 },
    });
    expect(r.moneyCollected).toBe(500);
    expect(r.stockCost).toBe(300);
    expect(r.realProfit).toBe(200);
  });

  it("pending approval sales are not counted", () => {
    const s = {
      ...sale("a", 1000, [{ id: "i1", qty: 1, price: 1000 }]),
      status: "pending_approval",
    };
    const r = buildBusinessReport({ sales: [s], refunds: [], expenses: [], costs: {} });
    expect(r.moneyCollected).toBe(0);
  });

  it("groups money by payment method", () => {
    const r = buildBusinessReport({
      sales: [sale("a", 100, [], "cash"), sale("b", 250, [], "mobile")],
      refunds: [],
      expenses: [],
      costs: {},
    });
    expect(r.byMethod).toEqual({ cash: 100, mobile: 250 });
    expect(r.byKind).toEqual({ cash: 100, bank: 0, mobile: 250, other: 0 });
  });

  it("credits a split sale to each tender's own method", () => {
    const r = buildBusinessReport({
      sales: [
        sale("a", 1000, [], "split", {
          payments: [
            { amount: 400, method: "cash" },
            { amount: 600, method: "airtel_money" },
          ],
        }),
      ],
      refunds: [],
      expenses: [],
      costs: {},
    });
    expect(r.byMethod).toEqual({ cash: 400, airtel_money: 600 });
    expect(r.byMethod["split"]).toBeUndefined();
    expect(r.byKind).toEqual({ cash: 400, bank: 0, mobile: 600, other: 0 });
    expect(r.tenderTotal).toBe(1000);
  });

  it("takes refunds off the method they were paid from", () => {
    const r = buildBusinessReport({
      sales: [sale("a", 1000, [], "national_bank")],
      refunds: [refund(200, "cash")],
      expenses: [],
      costs: {},
    });
    expect(r.byMethod).toEqual({ national_bank: 1000, cash: -200 });
    expect(r.byKind.cash).toBe(-200);
    expect(r.byKind.bank).toBe(1000);
    expect(r.tenderTotal).toBe(800);
  });

  it("keeps the method breakdown per location", () => {
    const r = buildBusinessReport({
      sales: [
        sale("a", 100, [], "cash", { storeId: "s1" }),
        sale("b", 250, [], "mpamba", { storeId: "s2" }),
      ],
      refunds: [refund(50, "cash", "s2")],
      expenses: [],
      costs: {},
    });
    expect(r.byStoreMethod).toEqual({ s1: { cash: 100 }, s2: { mpamba: 250, cash: -50 } });
    expect(r.byStoreKind["s1"]).toEqual({ cash: 100, bank: 0, mobile: 0, other: 0 });
    expect(r.byStoreKind["s2"]).toEqual({ cash: -50, bank: 0, mobile: 250, other: 0 });
  });

  it("keeps a split sale with no tender rows out of the provider buckets", () => {
    const r = buildBusinessReport({
      sales: [sale("a", 300, [], "split")],
      refunds: [],
      expenses: [],
      costs: {},
    });
    expect(r.byMethod).toEqual({ split: 300 });
    expect(r.byKind.other).toBe(300);
  });

  it("maps method codes to cash, bank and mobile buckets", () => {
    expect(reportKind("cash")).toBe("cash");
    expect(reportKind("card")).toBe("bank");
    expect(reportKind("fdh")).toBe("bank");
    expect(reportKind("mobile")).toBe("mobile");
    expect(reportKind("mpamba")).toBe("mobile");
    expect(reportKind("split")).toBe("other");
  });

  it("flags items sold below cost as money losers", () => {
    const r = buildBusinessReport({
      sales: [sale("a", 500, [{ id: "i1", qty: 1, price: 500 }])],
      refunds: [],
      expenses: [],
      costs: { i1: 800 },
    });
    expect(r.belowCost).toHaveLength(1);
    expect(r.belowCost[0]?.profit).toBe(-300);
    expect(r.belowCostLoss).toBe(-300);
  });
});
