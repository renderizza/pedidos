import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminNav } from "./admin-nav";

describe("AdminNav", () => {
  it("lista as áreas de administração com os destinos certos", () => {
    render(<AdminNav />);
    expect(screen.getByRole("navigation", { name: "Administração" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visão geral" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Categorias" })).toHaveAttribute("href", "/admin/categorias");
    expect(screen.getByRole("link", { name: "Produtos" })).toHaveAttribute("href", "/admin/produtos");
    expect(screen.getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/pedidos");
  });
});
