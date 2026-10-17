import { describe, expect, it } from "vitest";
import { buildBusinessReport } from "./business-report";

const sale = (id: string, total: number, items: { id: string; qty: number; price: number }[], method = "cash") => ({
  id,
  store_id: "s1",
  status: "completed",
  total,
  paid: total,
  tax: 0,
  payment_method: method,
  sale_items: items.map((i) => ({ ...i, product_id: "p1", name: "Gas" })),
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
      refunds: [{ store_id: "s1", amount: 500, cost: 300, tax: 0, refund_items: [] }],
      expenses: [],
      costs: { i1: 300 },
    });
    expect(r.moneyCollected).toBe(500);
    expect(r.stockCost).toBe(300);
    expect(r.realProfit).toBe(200);
  });

  it("pending approval sales are not counted", () => {
    const s = { ...sale("a", 1000, [{ id: "i1", qty: 1, price: 1000 }]), status: "pending_approval" };
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
  });
});
