import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./product-form";

const categories = [
  { id: "c1", name: "Bebidas" },
  { id: "c2", name: "Roupas" },
];

async function submitForm() {
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /criar|salvar/i }).closest("form")!);
  });
}

describe("ProductForm", () => {
  it("criação: campos vazios, 'Sem categoria' selecionada e produto ativo por padrão", () => {
    render(<ProductForm action={vi.fn()} categories={categories} submitLabel="Criar produto" />);
    expect(screen.getByLabelText("Referência")).toHaveValue("");
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
    expect(screen.getByLabelText("Preço (R$)")).toHaveValue("");
    expect(screen.getByLabelText("Categoria")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /produto ativo/i })).toBeChecked();
  });

  it("lista as categorias no select, depois de 'Sem categoria'", () => {
    render(<ProductForm action={vi.fn()} categories={categories} submitLabel="Criar produto" />);
    const options = within(screen.getByLabelText("Categoria")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Sem categoria", "Bebidas", "Roupas"]);
  });

  it("edição: começa com os valores do produto", () => {
    render(
      <ProductForm
        action={vi.fn()}
        categories={categories}
        submitLabel="Salvar alterações"
        initial={{ reference: "AB-1", description: "Camiseta", price: "49,90", categoryId: "c2", active: false }}
      />,
    );
    expect(screen.getByLabelText("Referência")).toHaveValue("AB-1");
    expect(screen.getByLabelText("Descrição")).toHaveValue("Camiseta");
    expect(screen.getByLabelText("Preço (R$)")).toHaveValue("49,90");
    expect(screen.getByLabelText("Categoria")).toHaveValue("c2");
    expect(screen.getByRole("checkbox", { name: /produto ativo/i })).not.toBeChecked();
  });

  it("envia todos os campos para a action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<ProductForm action={action} categories={categories} submitLabel="Criar produto" />);
    fireEvent.change(screen.getByLabelText("Referência"), { target: { value: "x-9" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Suco de uva" } });
    fireEvent.change(screen.getByLabelText("Preço (R$)"), { target: { value: "7,50" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c1" } });

    await submitForm();

    const data = action.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({
      reference: "x-9",
      description: "Suco de uva",
      price: "7,50",
      categoryId: "c1",
      active: "on",
    });
  });

  it("após erro de validação, mostra as mensagens e mantém o que foi digitado", async () => {
    const action = vi.fn().mockResolvedValue({
      fieldErrors: {
        reference: ["Já existe um produto com a referência X-9"],
        price: ["Preço inválido. Use o formato 12,50"],
      },
      values: { reference: "x-9", description: "Suco", price: "abc", categoryId: "c1", active: "" },
    });
    render(<ProductForm action={action} categories={categories} submitLabel="Criar produto" />);

    await submitForm();

    expect(await screen.findByText("Já existe um produto com a referência X-9")).toBeInTheDocument();
    expect(screen.getByText("Preço inválido. Use o formato 12,50")).toBeInTheDocument();
    expect(screen.getByLabelText("Referência")).toHaveValue("x-9");
    expect(screen.getByLabelText("Descrição")).toHaveValue("Suco");
    expect(screen.getByLabelText("Preço (R$)")).toHaveValue("abc");
    expect(screen.getByLabelText("Categoria")).toHaveValue("c1");
    // O checkbox desmarcado pelo usuário continua desmarcado (não volta ao padrão "ativo").
    expect(screen.getByRole("checkbox", { name: /produto ativo/i })).not.toBeChecked();
    expect(screen.getByLabelText("Preço (R$)")).toHaveAttribute("aria-invalid", "true");
  });
});
