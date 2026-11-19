import { describe, expect, it } from "vitest";
import { calculateOrder, lineTotalCents, MAX_ORDER_TOTAL_CENTS, parseQuantity } from "./calculation";

const line = (overrides: Partial<Parameters<typeof calculateOrder>[0][number]> = {}) => ({
  productId: "p1",
  reference: "REF-1",
  description: "Produto",
  unitPriceCents: 1000,
  quantity: 1,
  ...overrides,
});

describe("lineTotalCents", () => {
  it.each([
    [1990, 3, 5970],
    [735, 12, 8820],
    [1, 1, 1],
    [0, 5, 0],
    [999, 9999, 9_989_001],
  ])("%i × %i = %i", (unit, quantity, total) => {
    expect(lineTotalCents(unit, quantity)).toBe(total);
  });

  it("trabalha em centavos inteiros: 19,90 × 3 = 59,70 exatos", () => {
    expect(lineTotalCents(1990, 3)).toBe(5970);
    expect(Number.isInteger(lineTotalCents(1990, 3))).toBe(true);
  });

  it.each([
    [-1, 1],
    [10.5, 1],
    [1000, 0],
    [1000, -2],
    [1000, 1.5],
    [1000, 10_000],
    [Number.NaN, 1],
  ])("rejeita valor unitário %p com quantidade %p", (unit, quantity) => {
    expect(() => lineTotalCents(unit, quantity)).toThrow(RangeError);
  });
});

describe("calculateOrder", () => {
  it("pedido vazio: tudo zerado", () => {
    expect(calculateOrder([])).toEqual({ lines: [], totalCents: 0, lineCount: 0, unitCount: 0, exceedsLimit: false });
  });

  it("calcula o total de cada linha e o total geral", () => {
    const result = calculateOrder([
      line({ productId: "a", unitPriceCents: 1990, quantity: 3 }),
      line({ productId: "b", unitPriceCents: 735, quantity: 12 }),
      line({ productId: "c", unitPriceCents: 2500, quantity: 1 }),
    ]);
    expect(result.lines.map((l) => l.lineTotalCents)).toEqual([5970, 8820, 2500]);
    expect(result.totalCents).toBe(17290);
    expect(result.lineCount).toBe(3);
    expect(result.unitCount).toBe(16);
    expect(result.exceedsLimit).toBe(false);
  });

  it("preserva os dados das linhas e não altera a entrada", () => {
    const input = [line({ reference: "ABC", description: "Descrição X" })];
    const snapshot = structuredClone(input);
    const result = calculateOrder(input);
    expect(result.lines[0]).toMatchObject({ reference: "ABC", description: "Descrição X", lineTotalCents: 1000 });
    expect(input).toEqual(snapshot);
  });

  it("o total geral é a soma exata das linhas (sem acumular erro com centavos quebrados)", () => {
    const lines = Array.from({ length: 100 }, (_, i) => line({ productId: `p${i}`, unitPriceCents: 33, quantity: 3 }));
    expect(calculateOrder(lines).totalCents).toBe(9900);
  });

  it("sinaliza quando o total passa do que cabe no banco (integer)", () => {
    const fits = calculateOrder([line({ unitPriceCents: 214_748_364, quantity: 10 })]);
    expect(fits.totalCents).toBe(2_147_483_640);
    expect(fits.exceedsLimit).toBe(false);

    const exactly = calculateOrder([line({ unitPriceCents: MAX_ORDER_TOTAL_CENTS, quantity: 1 })]);
    expect(exactly.exceedsLimit).toBe(false);

    const over = calculateOrder([line({ unitPriceCents: 214_748_365, quantity: 10 })]);
    expect(over.totalCents).toBe(2_147_483_650);
    expect(over.exceedsLimit).toBe(true);
  });

  it("mesmo no pior caso permitido (200 linhas × preço máximo × 9999) o cálculo continua exato", () => {
    const lines = Array.from({ length: 200 }, (_, i) =>
      line({ productId: `p${i}`, unitPriceCents: 2_147_483_647, quantity: 9999 }),
    );
    const result = calculateOrder(lines);
    expect(Number.isSafeInteger(result.totalCents)).toBe(true);
    expect(result.totalCents).toBe(2_147_483_647 * 9999 * 200);
    expect(result.exceedsLimit).toBe(true);
  });

  it("propaga erro se alguma linha tiver quantidade inválida", () => {
    expect(() => calculateOrder([line({ quantity: 0 })])).toThrow(RangeError);
  });
});

describe("parseQuantity", () => {
  it.each([
    ["1", 1],
    ["12", 12],
    ["9999", 9999],
    ["  7  ", 7],
    ["007", 7],
  ])("%j → %i", (text, quantity) => {
    expect(parseQuantity(text)).toBe(quantity);
  });

  it.each(["", "  ", "0", "00", "-1", "1.5", "1,5", "abc", "1a", "1e3", "+5", "10000", "99999", "123456", "٣", "1 2"])(
    "rejeita %j",
    (text) => {
      expect(parseQuantity(text)).toBeNull();
    },
  );
});
