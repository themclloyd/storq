// Pure money maths behind the Reports page and its PDF, kept free of React so
// the plain-language profit statement can be unit tested.

export type ReportSale = {
  id: string;
  store_id: string;
  status: string;
  total: number | string;
  paid: number | string;
  tax?: number | string | null;
  payment_method: string | null;
  sale_items: { id: string; product_id: string | null; name: string; qty: number; price: number }[];
};
export type ReportRefund = {
  store_id: string;
  amount: number | string;
  cost: number | string;
  tax: number | string;
  refund_items: {
    product_id: string | null;
    name: string;
    qty: number | string;
    amount: number | string;
    cost: number | string;
  }[];
};
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
  const byStore: Record<string, { sales: number; stockCost: number; expenses: number }> = {};
  const store = (id: string) => (byStore[id] ??= { sales: 0, stockCost: 0, expenses: 0 });

  for (const s of done) {
    const total = Number(s.total);
    grossSales += total;
    tax += Number(s.tax ?? 0);
    const m = s.payment_method ?? "cash";
    byMethod[m] = (byMethod[m] ?? 0) + total;
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
