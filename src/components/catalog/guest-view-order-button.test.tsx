import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { addToGuestCart, clearGuestCart, GUEST_CART_KEY, writeGuestCart } from "@/lib/orders/guest-cart";
import { GuestViewOrderButton } from "./guest-view-order-button";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => window.localStorage.clear());

describe("GuestViewOrderButton", () => {
  it("não aparece quando não há produto no pedido", () => {
    render(<GuestViewOrderButton />);
    expect(screen.queryByRole("link", { name: "Ver pedido" })).not.toBeInTheDocument();
  });

  it("aparece, levando à tabela de pedido, quando já há produto guardado", () => {
    writeGuestCart([{ productId: A, quantity: 2 }]);
    render(<GuestViewOrderButton />);
    expect(screen.getByRole("link", { name: "Ver pedido" })).toHaveAttribute("href", "/pedidos/novo");
  });

  it("aparece na hora em que um produto é adicionado e some quando o pedido é esvaziado", () => {
    render(<GuestViewOrderButton />);
    expect(screen.queryByRole("link", { name: "Ver pedido" })).not.toBeInTheDocument();

    act(() => {
      addToGuestCart(A);
    });
    expect(screen.getByRole("link", { name: "Ver pedido" })).toBeInTheDocument();

    act(() => {
      addToGuestCart(B);
    });
    expect(screen.getAllByRole("link", { name: "Ver pedido" })).toHaveLength(1);

    act(() => {
      clearGuestCart();
    });
    expect(screen.queryByRole("link", { name: "Ver pedido" })).not.toBeInTheDocument();
  });

  it("acompanha mudanças feitas em outra aba (evento 'storage')", () => {
    render(<GuestViewOrderButton />);
    act(() => {
      window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify([{ productId: A, quantity: 1 }]));
      window.dispatchEvent(new StorageEvent("storage", { key: GUEST_CART_KEY }));
    });
    expect(screen.getByRole("link", { name: "Ver pedido" })).toBeInTheDocument();
  });

  it("conteúdo corrompido no navegador vale como pedido vazio (botão escondido)", () => {
    window.localStorage.setItem(GUEST_CART_KEY, "{lixo");
    render(<GuestViewOrderButton />);
    expect(screen.queryByRole("link", { name: "Ver pedido" })).not.toBeInTheDocument();
  });
});
