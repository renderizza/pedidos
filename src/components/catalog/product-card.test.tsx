import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductCard } from "./product-card";

const product = { id: "p1", reference: "CAM-01", description: "Camiseta azul", priceCents: 4990, categoryName: "Roupas" };

describe("ProductCard", () => {
  it("mostra referência, descrição, categoria e preço formatado", () => {
    render(<ul><ProductCard product={product} /></ul>);
    expect(screen.getByText("CAM-01")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Camiseta azul" })).toBeInTheDocument();
    expect(screen.getByText("Roupas")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s49,90/)).toBeInTheDocument();
  });

  it("omite a categoria quando o produto não tem", () => {
    render(<ul><ProductCard product={{ ...product, categoryName: null }} /></ul>);
    expect(screen.queryByText("Roupas")).not.toBeInTheDocument();
  });

  it("mostra a imagem quando o produto tem endereço de imagem", () => {
    const imageUrl = "https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    render(<ul><ProductCard product={{ ...product, imageUrl }} /></ul>);
    expect(screen.getByTestId("product-image")).toBeInTheDocument();
    // Decorativa: o título já descreve o produto, então o leitor de tela não repete o texto.
    expect(screen.getByRole("presentation")).toHaveAttribute("src", `${imageUrl}=w400`);
  });

  it.each([undefined, null, ""])("sem imagem (%j): o cartão não reserva espaço de imagem", (imageUrl) => {
    render(<ul><ProductCard product={{ ...product, imageUrl }} /></ul>);
    expect(screen.queryByTestId("product-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("product-image-fallback")).not.toBeInTheDocument();
  });

  it("renderiza a ação recebida (ou nenhuma, para visitantes)", () => {
    const { rerender } = render(<ul><ProductCard product={product} action={<button>Pedir</button>} /></ul>);
    expect(screen.getByRole("button", { name: "Pedir" })).toBeInTheDocument();
    rerender(<ul><ProductCard product={product} /></ul>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
