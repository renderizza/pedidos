import { describe, expect, it } from "vitest";
import { maskBrazilPhone } from "./phone-mask";

describe("maskBrazilPhone", () => {
  it.each([
    ["", ""],
    ["1", "(1"],
    ["11", "(11"], // o parêntese só fecha no 3º dígito (senão o Backspace ficaria preso)
    ["119", "(11)9"],
    ["1198888", "(11)98888"],
    ["11988887", "(11)98888-7"],
    ["119888877", "(11)98888-77"],
    ["11988887777", "(11)98888-7777"],
  ])("celular: %j → %j", (typed, shown) => {
    expect(maskBrazilPhone(typed)).toBe(shown);
  });

  it.each([
    ["1133", "(11)33"],
    ["113333", "(11)3333"],
    ["1133334", "(11)3333-4"],
    ["1133334444", "(11)3333-4444"],
  ])("fixo (começa sem 9): %j → %j", (typed, shown) => {
    expect(maskBrazilPhone(typed)).toBe(shown);
  });

  it("um fixo ao qual se acrescenta o 11º dígito vira 5 + 4", () => {
    expect(maskBrazilPhone("11333344445")).toBe("(11)33334-4445");
  });

  it("é idempotente: aplicar sobre um valor já mascarado não muda nada", () => {
    for (const value of ["(1", "(11", "(11)9", "(11)98888-7", "(11)98888-7777", "(11)3333-4444"]) {
      expect(maskBrazilPhone(value, value)).toBe(value);
    }
  });

  it("aceita pontuação digitada ou colada, em qualquer formato", () => {
    expect(maskBrazilPhone("(11) 98888-7777")).toBe("(11)98888-7777");
    expect(maskBrazilPhone("11 98888 7777")).toBe("(11)98888-7777");
    expect(maskBrazilPhone("11.98888.7777")).toBe("(11)98888-7777");
  });

  it("ignora letras e símbolos", () => {
    expect(maskBrazilPhone("abc")).toBe("");
    expect(maskBrazilPhone("1a1b9c")).toBe("(11)9");
  });

  it("limita a 11 dígitos", () => {
    expect(maskBrazilPhone("11988887777123")).toBe("(11)98888-7777");
  });

  describe("código do país (+55)", () => {
    it.each([
      ["+55 (11) 98888-7777", "(11)98888-7777"],
      ["5511988887777", "(11)98888-7777"],
      ["+55 11 3333-4444", "(11)3333-4444"], // fixo: 12 dígitos
    ])("colar %j em campo vazio descarta o 55 → %j", (pasted, shown) => {
      expect(maskBrazilPhone(pasted, "")).toBe(shown);
    });

    it("colar por cima de um número completo também descarta o 55", () => {
      expect(maskBrazilPhone("+5511988887777", "(21)97777-6666")).toBe("(11)98888-7777");
    });

    it("digitar o 12º dígito num número com DDD 55 só o descarta (55 é DDD do RS)", () => {
      expect(maskBrazilPhone("(55)98888-77771", "(55)98888-7777")).toBe("(55)98888-7777");
    });

    it("número com DDD 55 de 11 dígitos não perde nada", () => {
      expect(maskBrazilPhone("55988887777")).toBe("(55)98888-7777");
    });

    it("mais de 11 dígitos que não começam com 55 apenas são cortados", () => {
      expect(maskBrazilPhone("1198888777712", "")).toBe("(11)98888-7777");
    });
  });
});
