// Pure money maths behind the Reports page and its PDF, kept free of React so
// the plain-language profit statement can be unit tested.

import { methodKind } from "@/lib/payment-methods";

/** One tender row: the method that actually took this part of a payment. */
export type ReportPayment = { amount: number | string; method: string };

export type ReportSale = {
  id: string;
  store_id: string;
  status: string;
  total: number | string;
  paid: number | string;
  tax?: number | string | null;
  payment_method: string | null;
  /** Tender rows; absent on list reads that do not join payments. */
  payments?: ReportPayment[];
  sale_items: { id: string; product_id: string | null; name: string; qty: number; price: number }[];
};
export type ReportRefund = {
  store_id: string;
  amount: number | string;
  cost: number | string;
  tax: number | string;
  method: string;
  refund_items: {
    product_id: string | null;
    name: string;
    qty: number | string;
    amount: number | string;
    cost: number | string;
  }[];
};

/** Coarse bucket used to show cash vs bank vs mobile money at a glance. */
export type ReportKind = "cash" | "bank" | "mobile" | "other";

/**
 * `split` is a sale-level label with no money behind it, the tender rows say
 * which provider took each part. Only a legacy sale with no tender rows can
 * reach the fallback and land in `other`.
 */
export function reportKind(code: string): ReportKind {
  return code === "split" ? "other" : methodKind(code);
}
export type ReportExpense = {
  store_id: string;
  amount: number | string;
  category: string;
  source: string;
};

export type ItemLine = {
  key: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
};

const COUNTED = ["completed", "layby_completed", "partially_refunded", "refunded"];

export function buildBusinessReport(input: {
  sales: ReportSale[];
  refunds: ReportRefund[];
  expenses: ReportExpense[];
  costs: Record<string, number | string | undefined>;
}) {
  const done = input.sales.filter((s) => COUNTED.includes(s.status));
  let grossSales = 0,
    stockCost = 0,
    tax = 0;
  const items: Record<string, ItemLine> = {};
  const byMethod: Record<string, number> = {};
  const byKind: Record<ReportKind, number> = { cash: 0, bank: 0, mobile: 0, other: 0 };
  const byStore: Record<string, { sales: number; stockCost: number; expenses: number }> = {};
  const byStoreMethod: Record<string, Record<string, number>> = {};
  const store = (id: string) => (byStore[id] ??= { sales: 0, stockCost: 0, expenses: 0 });
  // Money is credited to the provider that actually took it, per location.
  // Refunds use the negative form so one helper keeps every map in step.
  const credit = (storeId: string, code: string, amount: number) => {
    const m = code || "cash";
    byMethod[m] = (byMethod[m] ?? 0) + amount;
    byKind[reportKind(m)] += amount;
    const sm = (byStoreMethod[storeId] ??= {});
    sm[m] = (sm[m] ?? 0) + amount;
  };

  for (const s of done) {
    const total = Number(s.total);
    grossSales += total;
    tax += Number(s.tax ?? 0);
    // Tender rows let a split sale count under each provider that took part;
    // older rows without them fall back to the sale-level method.
    const tenders = (s.payments ?? []).filter((p) => Number(p.amount) > 0);
    if (tenders.length) {
      for (const p of tenders) credit(s.store_id, p.method, Number(p.amount));
    } else {
      credit(s.store_id, s.payment_method ?? "cash", total);
    }
    const st = store(s.store_id);
    st.sales += total;
    for (const i of s.sale_items) {
      const rev = Number(i.qty) * Number(i.price);
      const c = Number(i.qty) * Number(input.costs[i.id] ?? 0);
      stockCost += c;
      st.stockCost += c;
      const k = i.product_id ?? i.name;
      const it = (items[k] ??= { key: k, name: i.name, qty: 0, revenue: 0, cost: 0, profit: 0 });
      it.qty += Number(i.qty);
      it.revenue += rev;
      it.cost += c;
      it.profit += rev - c;
    }
  }

  let refunds = 0;
  for (const f of input.refunds) {
    const a = Number(f.amount),
      c = Number(f.cost);
    refunds += a;
    stockCost -= c;
    tax -= Number(f.tax);
    credit(f.store_id, f.method, -a);
    const st = store(f.store_id);
    st.sales -= a;
    st.stockCost -= c;
    for (const i of f.refund_items) {
      const it = items[i.product_id ?? i.name];
      if (!it) continue;
      it.qty -= Number(i.qty);
      it.revenue -= Number(i.amount);
      it.cost -= Number(i.cost);
      it.profit -= Number(i.amount) - Number(i.cost);
    }
  }

  let expenses = 0,
    tillExpenses = 0;
  const byCategory: Record<string, number> = {};
  for (const e of input.expenses) {
    const a = Number(e.amount);
    expenses += a;
    if (e.source === "till") tillExpenses += a;
    byCategory[e.category] = (byCategory[e.category] ?? 0) + a;
    store(e.store_id).expenses += a;
  }

  const byStoreKind: Record<string, Record<ReportKind, number>> = {};
  for (const [storeId, methods] of Object.entries(byStoreMethod)) {
    const k = (byStoreKind[storeId] ??= { cash: 0, bank: 0, mobile: 0, other: 0 });
    for (const [code, amount] of Object.entries(methods)) k[reportKind(code)] += amount;
  }
  const tenderTotal = Object.values(byMethod).reduce((a, v) => a + v, 0);

  const moneyCollected = grossSales - refunds;
  const productProfit = moneyCollected - stockCost;
  const realProfit = productProfit - expenses;
  const orders = done.length;
  const itemList = Object.values(items);
  const belowCost = itemList
    .filter((i) => i.qty > 0 && i.profit < 0)
    .sort((a, b) => a.profit - b.profit);
  return {
    grossSales,
    refunds,
    moneyCollected,
    stockCost,
    productProfit,
    expenses,
    realProfit,
    tax,
    tillExpenses,
    productMargin: moneyCollected ? (productProfit / moneyCollected) * 100 : 0,
    realMargin: moneyCollected ? (realProfit / moneyCollected) * 100 : 0,
    orders,
    avgSale: orders ? grossSales / orders : 0,
    unitsSold: itemList.reduce((a, i) => a + i.qty, 0),
    byMethod,
    byKind,
    byStoreMethod,
    byStoreKind,
    tenderTotal,
    byCategory,
    byStore,
    topProfit: [...itemList].sort((a, b) => b.profit - a.profit),
    lowMargin: itemList.filter((i) => i.revenue > 0 && i.profit / i.revenue < 0.1),
    soldKeys: new Set(itemList.filter((i) => i.qty > 0).map((i) => i.key)),
    belowCost,
    belowCostLoss: belowCost.reduce((a, i) => a + i.profit, 0),
  };
}
export type BusinessReport = ReturnType<typeof buildBusinessReport>;
