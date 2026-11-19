import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteButton } from "./delete-button";

afterEach(() => {
  vi.restoreAllMocks();
});

async function submit() {
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /excluir/i }).closest("form")!);
  });
}

describe("DeleteButton", () => {
  it("pede confirmação e NÃO exclui quando o usuário cancela", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const action = vi.fn().mockResolvedValue(undefined);
    render(<DeleteButton action={action} confirmMessage="Excluir X?" />);

    await submit();

    expect(confirm).toHaveBeenCalledWith("Excluir X?");
    expect(action).not.toHaveBeenCalled();
  });

  it("executa a ação quando o usuário confirma", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const action = vi.fn().mockResolvedValue(undefined);
    render(<DeleteButton action={action} confirmMessage="Excluir X?" />);

    await submit();

    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("mostra a mensagem de erro devolvida pelo servidor", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const action = vi.fn().mockResolvedValue({ error: "A categoria possui 3 produto(s)." });
    render(<DeleteButton action={action} confirmMessage="Excluir?" />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("A categoria possui 3 produto(s).");
  });

  it("aceita um rótulo personalizado", () => {
    render(<DeleteButton action={vi.fn()} confirmMessage="?" label="Remover" />);
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
  });
});
