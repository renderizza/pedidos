import { describe, expect, it } from "vitest";
import { buildProductListHref, parseProductListParams } from "./list-params";

const UUID = "3f0c1b3e-8c3b-4f4e-9a57-0a5d0f6f1c11";

describe("parseProductListParams", () => {
  it("usa padrões quando não há parâmetros", () => {
    expect(parseProductListParams({})).toEqual({ search: "", categoryId: undefined, status: "all", page: 1 });
  });

  it("lê busca, categoria, situação e página", () => {
    expect(parseProductListParams({ q: "  camisa ", categoria: UUID, status: "ativos", pagina: "3" })).toEqual({
      search: "camisa",
      categoryId: UUID,
      status: "active",
      page: 3,
    });
  });

  it("aceita 'none' como 'sem categoria' e 'inativos'", () => {
    const query = parseProductListParams({ categoria: "none", status: "inativos" });
    expect(query.categoryId).toBe("none");
    expect(query.status).toBe("inactive");
  });

  it("valores inválidos viram o padrão em vez de gerar erro", () => {
    expect(parseProductListParams({ categoria: "'; drop table", status: "xyz", pagina: "-4" })).toEqual({
      search: "",
      categoryId: undefined,
      status: "all",
      page: 1,
    });
  });

  it("usa o primeiro valor quando o parâmetro se repete e limita o tamanho da busca", () => {
    expect(parseProductListParams({ q: ["a", "b"] }).search).toBe("a");
    expect(parseProductListParams({ q: "x".repeat(500) }).search).toHaveLength(100);
  });
});

describe("buildProductListHref", () => {
  it("omite valores padrão", () => {
    expect(buildProductListHref({ search: "", categoryId: undefined, status: "all" })).toBe("/admin/produtos");
    expect(buildProductListHref({ search: "", categoryId: undefined, status: "all" }, 1)).toBe("/admin/produtos");
  });

  it("preserva os filtros ao trocar de página, com URL-encode", () => {
    const href = buildProductListHref({ search: "50% & azul", categoryId: UUID, status: "active" }, 2);
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/admin/produtos");
    expect(url.searchParams.get("q")).toBe("50% & azul");
    expect(url.searchParams.get("categoria")).toBe(UUID);
    expect(url.searchParams.get("status")).toBe("ativos");
    expect(url.searchParams.get("pagina")).toBe("2");
  });

  it("aceita outro caminho base (ex.: a vitrine em /)", () => {
    expect(buildProductListHref({ search: "", categoryId: undefined, status: "all" }, 1, "/")).toBe("/");
    expect(buildProductListHref({ search: "x", categoryId: undefined, status: "all" }, 3, "/")).toBe("/?q=x&pagina=3");
  });

  it("ida e volta: o que é gerado é lido de volta igual", () => {
    const original = { search: "camisa", categoryId: "none", status: "inactive" as const };
    const url = new URL(buildProductListHref(original, 4), "http://x");
    const parsed = parseProductListParams(Object.fromEntries(url.searchParams));
    expect(parsed).toEqual({ ...original, page: 4 });
  });
});
