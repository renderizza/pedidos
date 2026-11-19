/** Auxiliares puros dos gráficos do painel (escala do eixo, rótulos e formatos). Valores monetários em centavos. */

const REAL_STEPS = [1, 2, 5] as const;

/**
 * Escala "redonda" de 0 até um teto: degraus em reais inteiros (1, 2, 5, 10, 20, 50, 100...), para o
 * eixo ter rótulos limpos (R$ 0, R$ 500, R$ 1.000). O teto nunca fica abaixo do maior valor.
 * Sem valores positivos (tudo zero), devolve uma escala de 0 a R$ 4 só para o eixo não degenerar.
 */
export function niceScale(maxCents: number, targetTicks = 4): { maxCents: number; ticksCents: number[] } {
  const maxReais = Math.max(maxCents, 0) / 100;
  if (maxReais === 0) return { maxCents: 400, ticksCents: [0, 100, 200, 300, 400] };

  const rough = maxReais / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    magnitude < 1
      ? 1 // nunca abaixo de R$ 1: o eixo não mostra centavos
      : (REAL_STEPS.map((s) => s * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude);

  const top = Math.ceil(maxReais / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(Math.round(value * 100));
  return { maxCents: Math.round(top * 100), ticksCents: ticks };
}

const axisFull = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const axisCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

/** Rótulo do eixo: por extenso abaixo de R$ 10.000 (R$ 1.500) e compacto a partir dele (R$ 12 mil). */
export function formatAxisCents(cents: number): string {
  const reais = cents / 100;
  return (reais < 10_000 ? axisFull : axisCompact).format(reais).replace(/\s/g, " ");
}

function parseDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** 2026-11-19 → "19/11" */
export function formatDayShort(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

/** 2026-11-19 → "qui 19/11" (o dia da semana ajuda a ler padrões como "sempre cai na segunda"). */
export function formatDayLong(isoDate: string): string {
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(parseDay(isoDate));
  return `${weekday.replace(".", "")} ${formatDayShort(isoDate)}`;
}

const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 12.3 → "+12,3%"; -8.1 → "−8,1%" (sinal de menos de verdade); 0 → "0,0%". */
export function formatSignedPercent(value: number): string {
  if (value === 0) return "0,0%";
  return `${value > 0 ? "+" : "−"}${percent.format(Math.abs(value))}%`;
}

/** Participação de uma parte no todo, em % inteiro; "<1%" quando existe mas é menor que 1%. */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const share = (part / whole) * 100;
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
}

/** Variação percentual de `current` sobre `previous` (1 casa decimal). `null` quando não há base (anterior = 0). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
