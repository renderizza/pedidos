import { describe, expect, it } from "vitest";
import { centsToInputValue, formatCents, parseMoneyToCents } from "./money";

describe("parseMoneyToCents", () => {
  it.each([
    ["12", 1200],
    ["0", 0],
    ["0,99", 99],
    ["12,5", 1250],
    ["12,50", 1250],
    ["1.234,56", 123456],
    ["1.234.567,89", 123456789],
    ["12.50", 1250],
    ["12.5", 1250],
    ["1.234", 123400],
    ["1.234.567", 123456700],
    ["R$ 12,50", 1250],
    ["r$12,50", 1250],
    ["  7,00  ", 700],
    ["1234,56", 123456],
    ["0,05", 5],
    ["19,90", 1990],
    ["12.345,6", 1234560],
  ])("converte %j em %i centavos", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it("não sofre com erros de ponto flutuante (19,90 e 0,29 viram valores exatos)", () => {
    expect(parseMoneyToCents("19,90")).toBe(1990);
    expect(parseMoneyToCents("0,29")).toBe(29);
    expect(parseMoneyToCents("1.005,05")).toBe(100505);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12,345",
    "1,2,3",
    "-5",
    "-5,00",
    "12,",
    ",50",
    "1.23.4",
    "R$",
    "12 reais",
    "1e3",
    "12,5a",
    "1..234,00",
    "99999999999999999999",
  ])("rejeita %j", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe("formatCents", () => {
  it("formata em reais no padrão brasileiro", () => {
    // O Intl usa espaço não separável entre "R$" e o número.
    expect(formatCents(1250).replace(/\s/g, " ")).toBe("R$ 12,50");
    expect(formatCents(5).replace(/\s/g, " ")).toBe("R$ 0,05");
    expect(formatCents(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(formatCents(0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
});

describe("centsToInputValue", () => {
  it.each([
    [1250, "12,50"],
    [5, "0,05"],
    [100, "1,00"],
    [123456, "1234,56"],
    [0, "0,00"],
  ])("%i → %s", (cents, text) => {
    expect(centsToInputValue(cents)).toBe(text);
  });

  it("ida e volta: o valor do campo volta aos mesmos centavos", () => {
    for (const cents of [1, 9, 10, 99, 100, 1999, 123456, 2_147_483_647]) {
      expect(parseMoneyToCents(centsToInputValue(cents))).toBe(cents);
    }
  });
});
