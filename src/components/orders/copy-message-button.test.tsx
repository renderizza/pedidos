import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyMessageButton } from "./copy-message-button";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

const click = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copiar mensagem" }));
  });

describe("CopyMessageButton", () => {
  it("copia exatamente a mensagem e confirma ao usuário", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyMessageButton message={"*PEDIDO #1*\nTotal: R$ 10,00"} />);

    expect(screen.getByTestId("copy-status")).toBeEmptyDOMElement();
    await click();

    expect(writeText).toHaveBeenCalledWith("*PEDIDO #1*\nTotal: R$ 10,00");
    expect(screen.getByTestId("copy-status")).toHaveTextContent("Mensagem copiada!");
  });

  it("se a área de transferência estiver indisponível, orienta a copiar manualmente", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("negado")));
    render(<CopyMessageButton message="texto" />);
    await click();
    expect(screen.getByTestId("copy-status")).toHaveTextContent("Não foi possível copiar");
  });

  it("não quebra quando a API de clipboard nem existe", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<CopyMessageButton message="texto" />);
    await click();
    expect(screen.getByTestId("copy-status")).toHaveTextContent("Não foi possível copiar");
  });
});
