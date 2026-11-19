import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddToOrderButton } from "./add-to-order-button";

const click = async () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Adicionar CAM-01 ao pedido" }));
  });

describe("AddToOrderButton", () => {
  it("tem nome acessível com a referência e não mostra mensagem de início", () => {
    render(<AddToOrderButton productId="p1" reference="CAM-01" addAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Adicionar CAM-01 ao pedido" })).toHaveTextContent("Adicionar ao pedido");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("chama a ação com o id do produto e mostra só a quantidade no pedido (sem link abaixo do produto)", async () => {
    const addAction = vi.fn().mockResolvedValue({ ok: true, quantity: 3 });
    render(<AddToOrderButton productId="p1" reference="CAM-01" addAction={addAction} />);

    await click();

    expect(addAction).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("status")).toHaveTextContent("No pedido: 3 un.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("mostra a mensagem de erro devolvida pelo servidor", async () => {
    const addAction = vi.fn().mockResolvedValue({ ok: false, error: "Um dos produtos não está mais disponível" });
    render(<AddToOrderButton productId="p1" reference="CAM-01" addAction={addAction} />);
    await click();
    expect(screen.getByRole("status")).toHaveTextContent("Um dos produtos não está mais disponível");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("falha de rede vira mensagem amigável (sem quebrar a tela)", async () => {
    const addAction = vi.fn().mockRejectedValue(new Error("offline"));
    render(<AddToOrderButton productId="p1" reference="CAM-01" addAction={addAction} />);
    await click();
    expect(screen.getByRole("status")).toHaveTextContent("Não foi possível adicionar. Tente novamente.");
  });

  it("cada clique soma de novo (a contagem vem do servidor)", async () => {
    const addAction = vi.fn().mockResolvedValueOnce({ ok: true, quantity: 1 }).mockResolvedValueOnce({ ok: true, quantity: 2 });
    render(<AddToOrderButton productId="p1" reference="CAM-01" addAction={addAction} />);
    await click();
    expect(screen.getByRole("status")).toHaveTextContent("No pedido: 1 un.");
    await click();
    expect(screen.getByRole("status")).toHaveTextContent("No pedido: 2 un.");
    expect(addAction).toHaveBeenCalledTimes(2);
  });
});
