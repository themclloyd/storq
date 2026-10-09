import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  transfers: [
    {
      id: "t1",
      number: 7,
      status: "in_transit" as const,
      note: "Weekly top-up",
      created_at: "2026-10-09T10:00:00Z",
      received_at: null,
      created_by: "s1",
      received_by: null,
      from_store: "s1",
      to_store: "s2",
      stock_transfer_lines: [{ id: "l1", product_id: "p2", name: "Widget", qty: 3 }],
    },
  ],
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/pos", () => ({
  usePos: () => ({
    store: { id: "s1", name: "CBD", store_type: "direct" },
    stores: [
      { id: "s1", name: "CBD", store_type: "direct" },
      { id: "s2", name: "Airport", store_type: "direct" },
    ],
    can: () => true,
    money: (n: number) => `R ${n}`,
  }),
}));
vi.mock("@/lib/products", () => ({
  useProducts: () => ({
    data: [
      {
        id: "p2",
        name: "Widget",
        sku: "W",
        category: null,
        price: 10,
        cost: 5,
        active: true,
        reorder_point: null,
      },
    ],
  }),
  useStock: () => ({ data: { p2: 8 } }),
}));
vi.mock("@/lib/transfers", () => ({
  TRANSFER_STATUS_LABELS: {
    in_transit: "In transit",
    received: "Received",
    cancelled: "Cancelled",
  },
  useTransfers: () => ({ data: state.transfers, isPending: false }),
  useLowStock: () => ({ data: [] }),
  useTransferMutations: () => ({ mutateAsync: state.mutateAsync, isPending: false }),
}));

import { Route } from "@/routes/_authenticated/app.transfers";
const Transfers = (Route as unknown as { options: { component: React.ComponentType } }).options
  .component;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Stock transfers screen", () => {
  it("lists an in-transit transfer with its route and lines", () => {
    render(<Transfers />);
    expect(screen.getByText("Transfer #7")).toBeInTheDocument();
    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(screen.getByText(/CBD.*Airport/)).toBeInTheDocument();
    expect(screen.getByText("Widget × 3")).toBeInTheDocument();
  });

  it("opens the create sheet and dispatches through the create_transfer RPC", async () => {
    state.mutateAsync.mockResolvedValue("t2");
    render(<Transfers />);
    fireEvent.click(screen.getByRole("button", { name: "New transfer" }));
    fireEvent.click(screen.getByRole("button", { name: /Widget/ }));
    fireEvent.change(screen.getByLabelText("Quantity for Widget"), { target: { value: "3" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dispatch stock" }));
    });
    expect(state.mutateAsync).toHaveBeenCalledWith({
      action: "create_transfer",
      args: {
        p_from: "s1",
        p_to: "s2",
        p_note: null,
        p_items: [{ product_id: "p2", qty: 3 }],
      },
    });
  });

  it("offers Receive only on the destination side and Cancel while in transit", () => {
    render(<Transfers />);
    // current store is the sender (s1), so Receive is not offered here
    expect(screen.queryByRole("button", { name: /Receive/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
