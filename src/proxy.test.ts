import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { config, proxy } from "./proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("proxy", () => {
  it("manda visitante sem cookie para /login guardando o destino em ?next=", () => {
    const response = proxy(request("/admin/produtos?page=2"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/admin/produtos?page=2");
  });

  it("deixa passar quando há cookie de sessão (a validação real fica nos guards)", () => {
    const response = proxy(request("/admin", `${SESSION_COOKIE}=qualquer-valor`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  describe("pedido de visitante: /pedidos/novo é pública", () => {
    it.each(["/pedidos/novo", "/pedidos/novo/"])("%s passa sem cookie e sem redirecionar", (path) => {
      const response = proxy(request(path));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it.each(["/pedidos", "/pedidos?q=maria", "/pedidos/11111111-1111-4111-8111-111111111111", "/pedidos/novo-pedido", "/pedidos/novo/outra", "/admin", "/admin/produtos"])(
      "%s continua exigindo login",
      (path) => {
        const response = proxy(request(path));
        expect(response.status).toBe(307);
        expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
      },
    );
  });

  it("só protege as rotas privadas", () => {
    expect(config.matcher).toEqual(["/admin/:path*", "/pedidos/:path*"]);
  });
});
