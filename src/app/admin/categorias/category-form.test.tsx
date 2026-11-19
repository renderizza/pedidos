import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryForm } from "./category-form";

async function submitForm() {
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /criar|salvar/i }).closest("form")!);
  });
}

describe("CategoryForm", () => {
  it("renderiza o campo, o botão e o link de cancelar", () => {
    render(<CategoryForm action={vi.fn()} submitLabel="Criar categoria" />);
    expect(screen.getByLabelText("Nome da categoria")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Criar categoria" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancelar" })).toHaveAttribute("href", "/admin/categorias");
  });

  it("na edição, começa com o nome atual", () => {
    render(<CategoryForm action={vi.fn()} initialName="Bebidas" submitLabel="Salvar alterações" />);
    expect(screen.getByLabelText("Nome da categoria")).toHaveValue("Bebidas");
  });

  it("envia o nome digitado para a action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<CategoryForm action={action} submitLabel="Criar categoria" />);
    fireEvent.change(screen.getByLabelText("Nome da categoria"), { target: { value: "Roupas" } });

    await submitForm();

    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0][1] as FormData;
    expect(formData.get("name")).toBe("Roupas");
  });

  it("mostra erro de validação e mantém o que foi digitado", async () => {
    const action = vi.fn().mockResolvedValue({
      fieldErrors: { name: ["Nome da categoria deve ter ao menos 2 caracteres"] },
      values: { name: "A" },
    });
    render(<CategoryForm action={action} submitLabel="Criar categoria" />);

    await submitForm();

    expect(await screen.findByText("Nome da categoria deve ter ao menos 2 caracteres")).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da categoria")).toHaveValue("A");
    expect(screen.getByLabelText("Nome da categoria")).toHaveAttribute("aria-invalid", "true");
  });

  it("mostra erro geral do servidor", async () => {
    const action = vi.fn().mockResolvedValue({ error: "Categoria não encontrada", values: { name: "X" } });
    render(<CategoryForm action={action} submitLabel="Salvar alterações" />);

    await submitForm();

    expect(await screen.findByTestId("form-error")).toHaveTextContent("Categoria não encontrada");
  });
});
