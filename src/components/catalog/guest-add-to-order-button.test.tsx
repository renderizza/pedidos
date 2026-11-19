import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGuestCart } from "@/lib/orders/guest-cart";
import { GuestAddToOrderButton } from "./guest-add-to-order-button";

const ID = "11111111-1111-4111-8111-111111111111";

const click = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Adicionar CAM-01 ao pedido" }));
  });

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("GuestAddToOrderButton", () => {
  it("soma 1 unidade ao pedido guardado no navegador, sem ir ao servidor e sem link abaixo do produto", async () => {
    render(<GuestAddToOrderButton productId={ID} reference="CAM-01" />);

    await click();
    expect(screen.getByRole("status")).toHaveTextContent("No pedido: 1 un.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    await click();
    expect(screen.getByRole("status")).toHaveTextContent("No pedido: 2 un.");
    expect(readGuestCart()).toEqual([{ productId: ID, quantity: 2 }]);
  });

  it("avisa quando o navegador não consegue guardar o pedido", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<GuestAddToOrderButton productId={ID} reference="CAM-01" />);
    await click();
    expect(screen.getByRole("status")).toHaveTextContent("Não foi possível guardar o pedido neste navegador.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
