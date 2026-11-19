import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "@/lib/orders/status";
import { OrderStatusBadge } from "./status-badge";

describe("OrderStatusBadge", () => {
  it.each([
    ["PENDENTE", "Pendente"],
    ["CONFIRMADO", "Confirmado"],
    ["CANCELADO", "Cancelado"],
  ] as const)("%s → %s", (status, label) => {
    render(<OrderStatusBadge status={status} />);
    expect(screen.getByTestId("order-status")).toHaveTextContent(label);
  });

  it("cobre todos os status existentes (nenhum fica sem rótulo)", () => {
    for (const status of ORDER_STATUSES) {
      const { unmount } = render(<OrderStatusBadge status={status} />);
      expect(screen.getByTestId("order-status").textContent).toMatch(/\w+/);
      unmount();
    }
  });
});
