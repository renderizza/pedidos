import { describe, expect, it } from "vitest";
import {
  formatAxisCents,
  formatDayLong,
  formatDayShort,
  formatShare,
  formatSignedPercent,
  niceScale,
  percentChange,
} from "./scale";

describe("niceScale", () => {
  it.each([
    [123_456, 150_000, [0, 50_000, 100_000, 150_000]], // R$ 1.234,56 → teto R$ 1.500
    [333_160, 400_000, [0, 100_000, 200_000, 300_000, 400_000]], // R$ 3.331,60 → teto R$ 4.000
    [450, 600, [0, 200, 400, 600]], // R$ 4,50 → degraus de R$ 2
    [30, 100, [0, 100]], // R$ 0,30: nunca abaixo de R$ 1 (o eixo não mostra centavos)
    [1_000_000, 1_000_000, [0, 500_000, 1_000_000]],
  ])("máximo de %i centavos → teto %i com degraus limpos", (max, top, ticks) => {
    expect(niceScale(max)).toEqual({ maxCents: top, ticksCents: ticks });
  });

  it("sem valores positivos devolve uma escala fixa, para o eixo não degenerar", () => {
    expect(niceScale(0)).toEqual({ maxCents: 400, ticksCents: [0, 100, 200, 300, 400] });
    expect(niceScale(-50).maxCents).toBe(400);
  });

  it("para qualquer máximo: teto >= máximo, começa em zero, degraus iguais e em reais inteiros", () => {
    for (const max of [1, 99, 100, 101, 999, 5_000, 12_345, 99_999, 250_000, 1_234_567, 98_765_432, 2_147_483_647]) {
      const { maxCents, ticksCents } = niceScale(max);
      expect(maxCents).toBeGreaterThanOrEqual(max);
      expect(ticksCents[0]).toBe(0);
      expect(ticksCents.at(-1)).toBe(maxCents);
      expect(ticksCents.length).toBeGreaterThanOrEqual(2);
      expect(ticksCents.length).toBeLessThanOrEqual(8);
      const step = ticksCents[1] - ticksCents[0];
      expect(step % 100).toBe(0);
      ticksCents.slice(1).forEach((tick, i) => expect(tick - ticksCents[i]).toBe(step));
    }
  });
});

describe("formatAxisCents", () => {
  it.each([
    [0, "R$ 0"],
    [150_000, "R$ 1.500"],
    [999_900, "R$ 9.999"], // abaixo de R$ 10.000: por extenso
    [1_000_000, "R$ 10 mil"], // a partir de R$ 10.000: compacto
    [1_250_000, "R$ 12,5 mil"],
    [100_000_000, "R$ 1 mi"],
  ])("%i centavos → %s", (cents, label) => {
    expect(formatAxisCents(cents)).toBe(label);
  });
});

describe("datas", () => {
  it("formatDayShort: dia/mês", () => {
    expect(formatDayShort("2026-11-19")).toBe("19/11");
    expect(formatDayShort("2026-03-01")).toBe("01/03");
  });

  it("formatDayLong: dia da semana + dia/mês, sem depender do fuso do computador", () => {
    expect(formatDayLong("2026-11-19")).toBe("qui 19/11");
    expect(formatDayLong("2026-11-16")).toBe("seg 16/11");
    expect(formatDayLong("2026-03-01")).toBe("dom 01/03");
  });
});

describe("percentuais", () => {
  it("percentChange: variação com 1 casa; sem base (anterior = 0) devolve null", () => {
    expect(percentChange(11_965_70, 3_624_40)).toBe(230.1);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
    expect(percentChange(0, 100)).toBe(-100);
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it("formatSignedPercent: sinal explícito, vírgula decimal e sinal de menos de verdade", () => {
    expect(formatSignedPercent(230.1)).toBe("+230,1%");
    expect(formatSignedPercent(-8.1)).toBe("−8,1%");
    expect(formatSignedPercent(0)).toBe("0,0%");
    expect(formatSignedPercent(1234.5)).toBe("+1.234,5%");
  });

  it("formatShare: % inteiro, '<1%' quando existe mas é pequeno, 0% sem base", () => {
    expect(formatShare(71, 100)).toBe("71%");
    expect(formatShare(1, 3)).toBe("33%");
    expect(formatShare(1, 1000)).toBe("<1%");
    expect(formatShare(0, 100)).toBe("0%");
    expect(formatShare(5, 0)).toBe("0%");
    expect(formatShare(100, 100)).toBe("100%");
  });
});
