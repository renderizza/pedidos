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

  it("renderiza a ação recebida (ou nenhuma, para visitantes)", () => {
    const { rerender } = render(<ul><ProductCard product={product} action={<button>Pedir</button>} /></ul>);
    expect(screen.getByRole("button", { name: "Pedir" })).toBeInTheDocument();
    rerender(<ul><ProductCard product={product} /></ul>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
