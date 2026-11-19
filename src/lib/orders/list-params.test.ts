import { describe, expect, it } from "vitest";
import { buildOrderListHref, parseOrderListParams } from "./list-params";

describe("parseOrderListParams", () => {
  it("padrões quando não há parâmetros", () => {
    expect(parseOrderListParams({})).toEqual({ search: "", status: undefined, page: 1 });
  });

  it("lê busca, situação (sem diferenciar caixa) e página", () => {
    expect(parseOrderListParams({ q: "  joão ", status: "confirmado", pagina: "3" })).toEqual({
      search: "joão",
      status: "CONFIRMADO",
      page: 3,
    });
    expect(parseOrderListParams({ status: "PENDENTE" }).status).toBe("PENDENTE");
  });

  it("valores inválidos viram o padrão em vez de erro", () => {
    expect(parseOrderListParams({ status: "hackeado", pagina: "-1", q: ["a", "b"] })).toEqual({
      search: "a",
      status: undefined,
      page: 1,
    });
  });

  it("limita o tamanho da busca", () => {
    expect(parseOrderListParams({ q: "x".repeat(500) }).search).toHaveLength(100);
  });
});

describe("buildOrderListHref", () => {
  it("omite padrões", () => {
    expect(buildOrderListHref({ search: "", status: undefined })).toBe("/pedidos");
  });

  it("preserva os filtros e ida e volta devolve o mesmo estado", () => {
    const original = { search: "José & Filhos", status: "CANCELADO" as const };
    const url = new URL(buildOrderListHref(original, 4), "http://x");
    expect(url.pathname).toBe("/pedidos");
    expect(parseOrderListParams(Object.fromEntries(url.searchParams))).toEqual({ ...original, page: 4 });
  });
});
