import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { SiteHeaderView } from "./site-header";

vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

const base = { id: "1", name: "Fulana", email: "f@x.com" };

describe("SiteHeaderView", () => {
  it("visitante vê só a marca: sem 'Entrar', sem 'Montar pedido' e sem dados de usuário", () => {
    render(<SiteHeaderView user={null} />);
    expect(screen.getByRole("link", { name: "Sistema de Pedidos" })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Entrar" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("user-role")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sair" })).not.toBeInTheDocument();
  });

  it("ADMIN vê o nome, o perfil, o link do painel e o botão Sair", () => {
    const user: SessionUser = { ...base, role: "ADMIN" };
    render(<SiteHeaderView user={user} />);
    expect(screen.getByTestId("user-name")).toHaveTextContent("Fulana");
    expect(screen.getByTestId("user-role")).toHaveTextContent("ADMIN");
    expect(screen.getByRole("link", { name: "Painel administrativo" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it.each(["ADMIN", "CONSULTOR", "CLIENTE"] as const)("%s vê o link 'Montar pedido'", (role) => {
    render(<SiteHeaderView user={{ ...base, role }} />);
    expect(screen.getByRole("link", { name: "Montar pedido" })).toHaveAttribute("href", "/pedidos/novo");
  });

  it("ADMIN vê 'Pedidos' (todos); CONSULTOR e CLIENTE veem 'Meus pedidos'", () => {
    const { unmount } = render(<SiteHeaderView user={{ ...base, role: "ADMIN" }} />);
    expect(screen.getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/pedidos");
    expect(screen.queryByRole("link", { name: "Meus pedidos" })).not.toBeInTheDocument();
    unmount();

    for (const role of ["CONSULTOR", "CLIENTE"] as const) {
      const view = render(<SiteHeaderView user={{ ...base, role }} />);
      expect(screen.getByRole("link", { name: "Meus pedidos" })).toHaveAttribute("href", "/pedidos");
      view.unmount();
    }
  });

  it("visitante não vê links de pedidos", () => {
    render(<SiteHeaderView user={null} />);
    expect(screen.queryByRole("link", { name: "Pedidos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Meus pedidos" })).not.toBeInTheDocument();
  });

  it("visitante não vê o link 'Montar pedido' no navbar (o pedido nasce nos botões da vitrine)", () => {
    render(<SiteHeaderView user={null} />);
    expect(screen.queryByRole("link", { name: "Montar pedido" })).not.toBeInTheDocument();
  });

  it.each(["CONSULTOR", "CLIENTE"] as const)("%s não vê o link do painel administrativo", (role) => {
    render(<SiteHeaderView user={{ ...base, role }} />);
    expect(screen.getByTestId("user-role")).toHaveTextContent(role);
    expect(screen.queryByRole("link", { name: "Painel administrativo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
