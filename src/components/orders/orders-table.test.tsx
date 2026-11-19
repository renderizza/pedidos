import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrderSummary } from "@/lib/orders/history";
import { OrdersTable } from "./orders-table";

const order = (overrides: Partial<OrderSummary> = {}): OrderSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: 42,
  customerName: "João da Loja",
  status: "PENDENTE",
  totalCents: 14790,
  createdAt: new Date("2026-11-18T17:35:00Z"),
  requesterName: "Caio Consultor",
  lineCount: 2,
  unitCount: 15,
  ...overrides,
});

describe("OrdersTable", () => {
  it("mostra número (link para o detalhe), data, cliente, itens, total e situação", () => {
    render(<OrdersTable orders={[order()]} showRequester={false} />);
    const row = screen.getByRole("row", { name: /João da Loja/ });
    expect(within(row).getByRole("link", { name: "#42" })).toHaveAttribute("href", "/pedidos/11111111-1111-4111-8111-111111111111");
    expect(row).toHaveTextContent("18/11/2026 14:35");
    expect(row).toHaveTextContent("2 produto(s) · 15 un.");
    expect(row.textContent?.replace(/\s/g, " ")).toContain("R$ 147,90");
    expect(within(row).getByTestId("order-status")).toHaveTextContent("Pendente");
  });

  it("a coluna 'Lançado por' só existe para quem vê todos os pedidos (ADMIN)", () => {
    const { rerender } = render(<OrdersTable orders={[order()]} showRequester={false} />);
    expect(screen.queryByRole("columnheader", { name: "Lançado por" })).not.toBeInTheDocument();
    expect(screen.queryByText("Caio Consultor")).not.toBeInTheDocument();

    rerender(<OrdersTable orders={[order()]} showRequester />);
    expect(screen.getByRole("columnheader", { name: "Lançado por" })).toBeInTheDocument();
    expect(screen.getByText("Caio Consultor")).toBeInTheDocument();
  });

  it("pedido interno (sem cliente) mostra um traço na coluna Cliente", () => {
    render(<OrdersTable orders={[order({ customerName: null })]} showRequester={false} />);
    const row = screen.getByRole("row", { name: /#42/ });
    expect(within(row).getAllByRole("cell")[2]).toHaveTextContent("—");
  });

  it("pedido de visitante mostra 'Cliente sem cadastro' em 'Lançado por'", () => {
    render(<OrdersTable orders={[order({ requesterName: null })]} showRequester />);
    expect(screen.getByText("Cliente sem cadastro")).toBeInTheDocument();
  });

  it("uma linha por pedido, na ordem recebida", () => {
    render(
      <OrdersTable
        orders={[order({ id: "a", orderNumber: 3, customerName: "C" }), order({ id: "b", orderNumber: 2, customerName: "B" }), order({ id: "c", orderNumber: 1, customerName: "A" })]}
        showRequester={false}
      />,
    );
    const numbers = screen.getAllByRole("link").map((link) => link.textContent);
    expect(numbers).toEqual(["#3", "#2", "#1"]);
  });
});
