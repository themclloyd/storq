import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ type: "direct" as "direct" | "approval", rpc: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/pos", () => ({ usePos: () => ({ store: { id: "store", name: "Test store", store_type: state.type }, money: (n: number) => `R ${n}`, rpc: state.rpc, business: null }) }));
vi.mock("@/lib/products", () => ({ useProducts: () => ({ data: [{ id: "item", name: "Test item", active: true, price: 100, cost: 50 }] }), useStock: () => ({ data: { item: 10 } }) }));
vi.mock("@/lib/collections", () => ({ useCollections: () => ({ data: { list: [], byProduct: {} } }), salePrice: (p: { price: number }) => p.price }));

import { Route } from "@/routes/_authenticated/app.index";
const Register = (Route as unknown as { options: { component: React.ComponentType } }).options.component;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Store-specific checkout controls", () => {
  it("takes payment immediately for direct stores", () => {
    state.type = "direct";
    render(<Register />);
    fireEvent.click(screen.getByRole("button", { name: /Test item/ }));
    fireEvent.click(screen.getByRole("button", { name: "Charge R 100" }));
    expect(screen.getByRole("heading", { name: "Take payment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mobile money" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for approval" })).not.toBeInTheDocument();
  });

  it("creates an invoice without payment controls in approval stores", async () => {
    state.type = "approval";
    state.rpc.mockResolvedValue({ number: 1, status: "pending_approval" });
    render(<Register />);
    fireEvent.click(screen.getByRole("button", { name: /Test item/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(screen.getByRole("heading", { name: "Invoice for approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mobile money" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cash received")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send for approval" })); });
    expect(state.rpc).toHaveBeenCalledWith("checkout", expect.objectContaining({ p_store: "store", p_payment: 0, p_kind: "sale" }));
  });

  it("keeps approval laybys as invoices, not immediate payments", () => {
    state.type = "approval";
    render(<Register />);
    fireEvent.click(screen.getByRole("button", { name: /Test item/ }));
    fireEvent.click(screen.getByRole("button", { name: "Layby invoice" }));
    expect(screen.getByRole("heading", { name: "Layby invoice for approval" })).toBeInTheDocument();
    expect(screen.queryByText("Deposit paid now")).not.toBeInTheDocument();
  });
});