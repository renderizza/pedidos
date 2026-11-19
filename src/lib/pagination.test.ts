import { describe, expect, it } from "vitest";
import { clampPage, parsePage, totalPagesFor } from "./pagination";

describe("parsePage", () => {
  it.each([
    ["3", 3],
    ["1", 1],
    ["1000", 1000],
    [["4", "9"], 4],
  ])("%j → %i", (input, page) => {
    expect(parsePage(input)).toBe(page);
  });

  it.each(["0", "-1", "abc", "1.5", "", " 2", "99999999", undefined, null, 5, {}])("%j cai em 1", (input) => {
    expect(parsePage(input)).toBe(1);
  });
});

describe("totalPagesFor / clampPage", () => {
  it("calcula o total de páginas (mínimo 1, mesmo sem resultados)", () => {
    expect(totalPagesFor(0, 10)).toBe(1);
    expect(totalPagesFor(10, 10)).toBe(1);
    expect(totalPagesFor(11, 10)).toBe(2);
    expect(totalPagesFor(95, 10)).toBe(10);
  });

  it("mantém a página dentro do intervalo válido", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(99, 5)).toBe(5);
  });
});
