/**
 * Converte o que o usuário digita em um preço (formato brasileiro) para centavos,
 * usando só aritmética de inteiros — sem ponto flutuante.
 *
 *   "12" → 1200      "12,5" → 1250     "12,50" → 1250      "R$ 1.234,56" → 123456
 *   "12.50" → 1250   "1.234" → 123400  (ponto sem vírgula: milhar se houver grupos de 3)
 *
 * Devolve `null` para qualquer entrada inválida (vazia, negativa, letras, 3+ casas decimais).
 */
export function parseMoneyToCents(input: string): number | null {
  const text = input.replace(/^\s*R\$\s*/i, "").trim();
  if (!text) return null;

  let whole: string;
  let fraction = "";

  if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length !== 2) return null;
    const [integerPart, decimalPart] = parts;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(integerPart)) return null;
    // Com vírgula, exige 1 ou 2 casas decimais ("12," é digitação incompleta, não 12,00).
    if (!/^\d{1,2}$/.test(decimalPart)) return null;
    whole = integerPart.replaceAll(".", "");
    fraction = decimalPart;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    whole = text.replaceAll(".", ""); // "1.234" → milhar
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    [whole, fraction = ""] = text.split("."); // "12.5" → decimal
  } else {
    return null;
  }

  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return null;

  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 1250 → "R$ 12,50" */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

/** 1250 → "12,50" (valor inicial de campos de formulário). */
export function centsToInputValue(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
