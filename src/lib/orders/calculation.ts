import { MAX_INT } from "@/lib/validation/common";
import { MAX_ITEM_QUANTITY } from "@/lib/validation/order";

/** O total do pedido é gravado numa coluna `integer` (centavos): este é o teto. */
export const MAX_ORDER_TOTAL_CENTS = MAX_INT;

export type OrderLineInput = {
  productId: string;
  reference: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
};

export type OrderLine = OrderLineInput & { lineTotalCents: number };

export type OrderTotals = {
  lines: OrderLine[];
  /** Soma dos totais das linhas, em centavos. */
  totalCents: number;
  /** Quantidade de linhas (produtos distintos). */
  lineCount: number;
  /** Soma das quantidades de todas as linhas. */
  unitCount: number;
  /** true quando o total passa do que cabe no banco — o pedido não pode ser salvo. */
  exceedsLimit: boolean;
};

/** Valor unitário × quantidade, só com inteiros (centavos). */
export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new RangeError(`Valor unitário inválido: ${unitPriceCents}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
    throw new RangeError(`Quantidade inválida: ${quantity}`);
  }
  return unitPriceCents * quantity;
}

/** Calcula o total de cada linha e o total geral do pedido. */
export function calculateOrder(inputs: readonly OrderLineInput[]): OrderTotals {
  const lines = inputs.map((line) => ({
    ...line,
    lineTotalCents: lineTotalCents(line.unitPriceCents, line.quantity),
  }));
  const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const unitCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  return {
    lines,
    totalCents,
    lineCount: lines.length,
    unitCount,
    exceedsLimit: totalCents > MAX_ORDER_TOTAL_CENTS,
  };
}

/**
 * Lê a quantidade digitada: inteiro de 1 a 9999 (espaços nas pontas são ignorados).
 * Devolve `null` para vazio, zero, negativos, decimais, notação científica e texto.
 */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const quantity = Number(trimmed);
  return quantity >= 1 && quantity <= MAX_ITEM_QUANTITY ? quantity : null;
}
