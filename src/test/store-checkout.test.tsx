import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  type: "direct" as "direct" | "approval",
  manager: true,
  rpc: vi.fn(),
  offlineOk: undefined as boolean | undefined,
  products: [
    {
      id: "item",
      name: "Test item",
      sku: "123456",
      category: null,
      price: 100,
      cost: 50,
      active: true,
      reorder_point: null,
    },
  ],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/pos", () => ({
  usePos: () => ({
    store: { id: "store", name: "Test store", store_type: state.type },
    stores: [{ id: "store", name: "Test store", store_type: state.type }],
    staff: { id: "s1", name: "Casey", role: "manager" },
    business: null,
    money: (n: number) => `R ${n}`,
    can: (...roles: string[]) =>
      state.manager ? roles.includes("manager") || roles.includes("admin") : false,
    rpc: state.rpc,
    checkout: (a: Record<string, unknown>, o: { offlineOk: boolean }) => {
      state.offlineOk = o.offlineOk;
      return state.rpc("checkout", a);
    },
  }),
}));
vi.mock("@/lib/products", () => {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    useProducts: () => ({ data: state.products, isFetched: true }),
    useStock: () => ({ data: { item: 10 } }),
    findByBarcode: (list: { sku?: string | null }[], code: string) =>
      list.find((p) => p.sku?.toLowerCase() === code.trim().toLowerCase()),
    DISCOUNT_CAP_RATIO: 0.1,
    round2,
    lineCapBlocked: (lineGross: number, lineDiscount: number) =>
      lineDiscount > round2(lineGross * 0.1),
    cartCapBlocked: (gross: number, discountTotal: number) =>
      gross > 0 && discountTotal > round2(gross * 0.1),
  };
});
vi.mock("@/lib/collections", () => ({
  useCollections: () => ({ data: { list: [], byProduct: {} } }),
  salePrice: (p: { price: number }) => p.price,
}));

import { Route } from "@/routes/_authenticated/app.index";
const Register = (Route as unknown as { options: { component: React.ComponentType } }).options
  .component;

const addItem = () => fireEvent.click(screen.getByRole("button", { name: /Test item/ }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.manager = true;
  state.type = "direct";
});

describe("Store-specific checkout controls", () => {
  it("takes payment immediately for direct stores", () => {
    state.type = "direct";
    render(<Register />);
    addItem();
    fireEvent.click(screen.getByRole("button", { name: "Charge R 100" }));
    expect(screen.getByRole("heading", { name: "Take payment" })).toBeInTheDocument();
    expect(screen.getByText("Mobile money")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for approval" })).not.toBeInTheDocument();
  });

  it("creates an invoice without payment controls in approval stores", async () => {
    state.type = "approval";
    state.rpc.mockResolvedValue({ number: 1, status: "pending_approval" });
    render(<Register />);
    addItem();
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(screen.getByRole("heading", { name: "Invoice for approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mobile money" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cash received")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "checkout",
      expect.objectContaining({ p_store: "store", p_payment: 0, p_kind: "sale" }),
    );
    expect(state.offlineOk).toBe(false); // approval invoices never queue offline
  });

  it("keeps approval laybys as invoices, not immediate payments", () => {
    state.type = "approval";
    render(<Register />);
    addItem();
    fireEvent.click(screen.getByRole("button", { name: "Layby invoice" }));
    expect(screen.getByRole("heading", { name: "Layby invoice for approval" })).toBeInTheDocument();
    expect(screen.queryByText("Deposit paid now")).not.toBeInTheDocument();
  });

  it("sends p_tenders when the sale is split across methods", async () => {
    state.type = "direct";
    state.rpc.mockResolvedValue({ offline: true, total: 100 });
    render(<Register />);
    addItem();
    fireEvent.click(screen.getByRole("button", { name: "Charge R 100" }));
    fireEvent.click(screen.getByRole("button", { name: "Add another payment" }));
    const amounts = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(amounts[0]!, { target: { value: "60" } });
    fireEvent.change(amounts[1]!, { target: { value: "40" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Complete sale/ }));
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "checkout",
      expect.objectContaining({
        p_tenders: [
          { method: "cash", amount: 60 },
          { method: "card", amount: 40 },
        ],
      }),
    );
  });

  it("keeps a single cash tender on the backward-compatible payment path", async () => {
    state.type = "direct";
    state.rpc.mockResolvedValue({ offline: true, total: 100 });
    render(<Register />);
    addItem();
    fireEvent.click(screen.getByRole("button", { name: "Charge R 100" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Complete sale/ }));
    });
    const args = state.rpc.mock.calls.at(-1)?.[1] as {
      p_tenders?: unknown;
      p_method?: string;
    };
    expect(args.p_tenders).toBeUndefined();
    expect(args.p_method).toBe("cash");
  });

  it("asks a cashier for a manager PIN and forwards p_override_pin past the discount cap", async () => {
    state.type = "direct";
    state.manager = false; // cashier
    state.rpc.mockResolvedValue({ offline: true, total: 80 });
    render(<Register />);
    addItem();
    fireEvent.click(screen.getByRole("button", { name: "Add discount" }));
    fireEvent.change(screen.getByLabelText("Discount for Test item"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply R 20 off/ }));
    fireEvent.click(screen.getByRole("button", { name: "Charge R 80" }));
    // the manager PIN field only appears once the discount is past the cashier cap
    fireEvent.change(screen.getByPlaceholderText("Enter manager PIN"), {
      target: { value: "1234" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Complete sale/ }));
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "checkout",
      expect.objectContaining({
        p_override_pin: "1234",
        p_discounts: [{ product_id: "item", amount: 20 }],
      }),
    );
  });
});
