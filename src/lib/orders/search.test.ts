import { describe, expect, it } from "vitest";
import { normalizeSearch, searchCatalog } from "./search";

const catalog = [
  { id: "1", reference: "CAF-01", description: "Café especial 500g" },
  { id: "2", reference: "CAM-01", description: "Camiseta azul" },
  { id: "3", reference: "CAM-10", description: "Camiseta vermelha" },
  { id: "4", reference: "SUC-01", description: "Suco de uva" },
  { id: "5", reference: "XYZ-01", description: "Capa para camiseta" },
  { id: "6", reference: "CAM", description: "Referência exata curta" },
];

describe("normalizeSearch", () => {
  it("remove acentos, caixa e espaços das pontas", () => {
    expect(normalizeSearch("  Açúcar ÇÃO  ")).toBe("acucar cao");
  });
});

describe("searchCatalog", () => {
  const refs = (query: string, options?: Parameters<typeof searchCatalog>[2]) =>
    searchCatalog(catalog, query, options).map((p) => p.reference);

  it("texto vazio ou só com espaços não devolve nada", () => {
    expect(refs("")).toEqual([]);
    expect(refs("   ")).toEqual([]);
  });

  it("casa por trecho da referência e da descrição, sem diferenciar maiúsculas", () => {
    expect(refs("suc")).toEqual(["SUC-01"]);
    expect(refs("UVA")).toEqual(["SUC-01"]);
    expect(refs("azul")).toEqual(["CAM-01"]);
  });

  it("ignora acentos nos dois lados", () => {
    expect(refs("cafe")).toEqual(["CAF-01"]);
    expect(refs("café")).toEqual(["CAF-01"]);
    expect(refs("CAFÉ ESPECIAL")).toEqual(["CAF-01"]);
  });

  it("ordena: referência exata, começa com, contém na referência, depois descrição", () => {
    // "cam": exata (CAM) → começa com (CAM-01, CAM-10, em ordem de catálogo) → só descrição (Capa para camiseta)
    expect(refs("cam")).toEqual(["CAM", "CAM-01", "CAM-10", "XYZ-01"]);
  });

  it("referência no meio também casa (grau 'contém')", () => {
    expect(refs("-10")).toEqual(["CAM-10"]);
  });

  it("exclui produtos já no pedido", () => {
    expect(refs("cam", { exclude: new Set(["1", "2", "6"]) })).toEqual(["CAM-10", "XYZ-01"]);
  });

  it("respeita o limite", () => {
    expect(searchCatalog(catalog, "cam", { limit: 2 })).toHaveLength(2);
  });

  it("sem correspondência: lista vazia", () => {
    expect(refs("nada-disso")).toEqual([]);
  });

  it("não altera o catálogo de entrada", () => {
    const copy = structuredClone(catalog);
    searchCatalog(catalog, "cam");
    expect(catalog).toEqual(copy);
  });
});
