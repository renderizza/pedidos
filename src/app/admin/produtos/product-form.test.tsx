import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./product-form";

const categories = [
  { id: "c1", name: "Bebidas" },
  { id: "c2", name: "Roupas" },
];

const IMAGE_LABEL = "URL da imagem (opcional)";
const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const SHARE_LINK = `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`;
const DIRECT = `https://lh3.googleusercontent.com/d/${FILE_ID}`;

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
    expect(screen.getByLabelText(IMAGE_LABEL)).toHaveValue("");
    expect(screen.getByLabelText("Categoria")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /produto ativo/i })).toBeChecked();
    expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
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
        initial={{ reference: "AB-1", description: "Camiseta", price: "49,90", imageUrl: DIRECT, categoryId: "c2", active: false }}
      />,
    );
    expect(screen.getByLabelText("Referência")).toHaveValue("AB-1");
    expect(screen.getByLabelText(IMAGE_LABEL)).toHaveValue(DIRECT);
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
    fireEvent.change(screen.getByLabelText(IMAGE_LABEL), { target: { value: SHARE_LINK } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "c1" } });

    await submitForm();

    const data = action.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({
      reference: "x-9",
      description: "Suco de uva",
      price: "7,50",
      // O formulário envia o link como foi colado; quem converte para o endereço direto é o servidor.
      imageUrl: SHARE_LINK,
      categoryId: "c1",
      active: "on",
    });
  });

  it("imagem é opcional: sem preencher, envia o campo vazio", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<ProductForm action={action} categories={categories} submitLabel="Criar produto" />);
    await submitForm();
    expect((action.mock.calls[0][1] as FormData).get("imageUrl")).toBe("");
  });

  describe("prévia da imagem", () => {
    it("aparece ao sair do campo, já com o link do Drive convertido e em miniatura", () => {
      render(<ProductForm action={vi.fn()} categories={categories} submitLabel="Criar produto" />);
      const field = screen.getByLabelText(IMAGE_LABEL);

      fireEvent.change(field, { target: { value: SHARE_LINK } });
      // Enquanto digita/cola, nada é carregado: um link pela metade não deve disparar requisições ao Google.
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();

      fireEvent.blur(field);
      const preview = screen.getByTestId("image-preview");
      expect(within(preview).getByRole("presentation")).toHaveAttribute("src", `${DIRECT}=w80`);
      expect(field).toHaveValue(SHARE_LINK); // o que o usuário colou não é alterado na tela
    });

    it("ocupa SEMPRE o mesmo espaço: atualizar a prévia não pode empurrar o botão de salvar (o clique se perderia)", () => {
      render(<ProductForm action={vi.fn()} categories={categories} submitLabel="Criar produto" />);
      const field = screen.getByLabelText(IMAGE_LABEL);
      const heightClass = () => screen.getByTestId("image-preview-slot").className.match(/\bh-\d+\b/)?.[0];
      const vazio = heightClass();
      expect(vazio).toBeDefined();

      for (const value of [SHARE_LINK, "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz", "", "foto"]) {
        fireEvent.change(field, { target: { value } });
        fireEvent.blur(field);
        expect(heightClass()).toBe(vazio);
      }
    });

    it("na edição, já mostra a imagem cadastrada", () => {
      render(
        <ProductForm
          action={vi.fn()}
          categories={categories}
          submitLabel="Salvar alterações"
          initial={{ reference: "A", description: "Camiseta", price: "1,00", imageUrl: DIRECT, categoryId: "", active: true }}
        />,
      );
      expect(within(screen.getByTestId("image-preview")).getByRole("presentation")).toHaveAttribute("src", `${DIRECT}=w80`);
    });

    it("avisa na hora quando o link é de uma pasta ou não é um endereço válido", () => {
      render(<ProductForm action={vi.fn()} categories={categories} submitLabel="Criar produto" />);
      const field = screen.getByLabelText(IMAGE_LABEL);

      fireEvent.change(field, { target: { value: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz" } });
      fireEvent.blur(field);
      expect(screen.getByTestId("image-preview-warning")).toHaveTextContent("pasta do Google Drive");
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();

      fireEvent.change(field, { target: { value: "http://exemplo.com/a.jpg" } });
      fireEvent.blur(field);
      expect(screen.getByTestId("image-preview-warning")).toHaveTextContent("https://");
    });

    it("apagar o endereço some com a prévia", () => {
      render(<ProductForm action={vi.fn()} categories={categories} submitLabel="Criar produto" />);
      const field = screen.getByLabelText(IMAGE_LABEL);
      fireEvent.change(field, { target: { value: SHARE_LINK } });
      fireEvent.blur(field);
      expect(screen.getByTestId("image-preview")).toBeInTheDocument();

      fireEvent.change(field, { target: { value: "" } });
      fireEvent.blur(field);
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
      expect(screen.queryByTestId("image-preview-warning")).not.toBeInTheDocument();
    });
  });

  it("erro do servidor no endereço da imagem: mostra a mensagem no campo e mantém o que foi digitado", async () => {
    const action = vi.fn().mockResolvedValue({
      fieldErrors: { imageUrl: ["O endereço da imagem deve começar com https://"] },
      values: { reference: "x-9", description: "Suco", price: "7,50", imageUrl: "http://exemplo.com/a.jpg", categoryId: "", active: "on" },
    });
    render(<ProductForm action={action} categories={categories} submitLabel="Criar produto" />);

    await submitForm();

    expect(await screen.findByText("O endereço da imagem deve começar com https://")).toBeInTheDocument();
    const field = screen.getByLabelText(IMAGE_LABEL);
    expect(field).toHaveValue("http://exemplo.com/a.jpg");
    expect(field).toHaveAttribute("aria-invalid", "true");
    // A mensagem do campo basta: o aviso da prévia não repete o problema.
    expect(screen.queryByTestId("image-preview-warning")).not.toBeInTheDocument();
  });

  it("após erro de validação, mostra as mensagens e mantém o que foi digitado", async () => {
    const action = vi.fn().mockResolvedValue({
      fieldErrors: {
        reference: ["Já existe um produto com a referência X-9"],
        price: ["Preço inválido. Use o formato 12,50"],
      },
      values: { reference: "x-9", description: "Suco", price: "abc", imageUrl: SHARE_LINK, categoryId: "c1", active: "" },
    });
    render(<ProductForm action={action} categories={categories} submitLabel="Criar produto" />);

    await submitForm();

    expect(await screen.findByText("Já existe um produto com a referência X-9")).toBeInTheDocument();
    expect(screen.getByText("Preço inválido. Use o formato 12,50")).toBeInTheDocument();
    expect(screen.getByLabelText("Referência")).toHaveValue("x-9");
    expect(screen.getByLabelText("Descrição")).toHaveValue("Suco");
    expect(screen.getByLabelText("Preço (R$)")).toHaveValue("abc");
    expect(screen.getByLabelText(IMAGE_LABEL)).toHaveValue(SHARE_LINK);
    expect(screen.getByLabelText("Categoria")).toHaveValue("c1");
    // O checkbox desmarcado pelo usuário continua desmarcado (não volta ao padrão "ativo").
    expect(screen.getByRole("checkbox", { name: /produto ativo/i })).not.toBeChecked();
    expect(screen.getByLabelText("Preço (R$)")).toHaveAttribute("aria-invalid", "true");
  });
});
