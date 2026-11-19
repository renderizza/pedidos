import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankedBars } from "./ranked-bars";

const rows = [
  { id: "a", label: "Sérum Facial", detail: "SKN-003 · 10 un.", valueCents: 100_000 },
  { id: "b", label: "Deo Colônia", detail: "PRF-001 · 12 un.", valueCents: 50_000 },
  { id: "c", label: "Esmalte", valueCents: 1 },
  { id: "d", label: "Sem vendas", valueCents: 0 },
];

const widthOf = (row: HTMLElement) => within(row).queryByTestId("ranked-bar")?.style.width;

describe("RankedBars", () => {
  it("é uma lista nomeada, com uma linha por item, na ordem recebida", () => {
    render(<RankedBars rows={rows} label="Produtos que mais faturam" />);
    const list = screen.getByRole("list", { name: "Produtos que mais faturam" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Sérum Facial",
      "Deo Colônia",
      "Esmalte",
      "Sem vendas",
    ]);
  });

  it("mostra nome, apoio e valor em texto (a barra só dá a proporção)", () => {
    render(<RankedBars rows={rows} label="x" />);
    const [first] = screen.getAllByTestId("ranked-row");
    expect(first).toHaveTextContent("Sérum Facial");
    expect(first).toHaveTextContent("SKN-003 · 10 un.");
    expect(first.textContent?.replace(/\s/g, " ")).toContain("R$ 1.000,00");
  });

  it("largura proporcional ao maior valor: o maior ocupa 100%", () => {
    render(<RankedBars rows={rows} label="x" />);
    const [a, b] = screen.getAllByTestId("ranked-row");
    expect(widthOf(a)).toBe("max(2px, 100%)");
    expect(widthOf(b)).toBe("max(2px, 50%)");
  });

  it("valor minúsculo ainda aparece (mínimo de 2px) e valor zero não desenha barra", () => {
    render(<RankedBars rows={rows} label="x" />);
    const [, , c, d] = screen.getAllByTestId("ranked-row");
    expect(widthOf(c)).toMatch(/^max\(2px, 0\.001/);
    expect(within(d).queryByTestId("ranked-bar")).not.toBeInTheDocument();
  });

  it("nome longo tem o texto completo no title (a linha trunca, o valor nunca some)", () => {
    render(<RankedBars rows={[{ id: "x", label: "Loção Hidratante Corporal Manteiga de Karité 400ml", valueCents: 100 }]} label="x" />);
    expect(screen.getByTitle("Loção Hidratante Corporal Manteiga de Karité 400ml")).toBeInTheDocument();
  });

  it("todos os valores zerados: sem barras e sem divisão por zero", () => {
    render(<RankedBars rows={[{ id: "z", label: "Nada", valueCents: 0 }]} label="x" />);
    expect(screen.queryByTestId("ranked-bar")).not.toBeInTheDocument();
  });

  it("usa a mesma cor da série em todas as barras (categorias sem ordem natural não ganham rampa)", () => {
    render(<RankedBars rows={rows} label="x" />);
    const classes = screen.getAllByTestId("ranked-bar").map((bar) => bar.className);
    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).toContain("var(--viz-series-1)");
  });
});
