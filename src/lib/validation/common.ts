import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";

/** Maior valor aceito em colunas `integer` do PostgreSQL. */
export const MAX_INT = 2_147_483_647;

/** Texto obrigatório, já aparado (trim), com limites de tamanho. */
export function requiredText(label: string, min: number, max: number) {
  const base = z
    .string({ error: `${label} é obrigatório` })
    .trim()
    // `abort`: texto vazio mostra só "é obrigatório", sem somar a mensagem de tamanho mínimo.
    .min(1, { error: `${label} é obrigatório`, abort: true });
  const withMin = min > 1 ? base.min(min, `${label} deve ter ao menos ${min} caracteres`) : base;
  return withMin.max(max, `${label} deve ter no máximo ${max} caracteres`);
}

/** Valor monetário em centavos: inteiro positivo dentro do limite do banco. */
export const priceCentsSchema = z
  .number({ error: "Preço é obrigatório" })
  .int("Preço deve ser um valor em centavos (inteiro)")
  .positive("Preço deve ser maior que zero")
  .max(MAX_INT, "Preço acima do limite permitido");

/** Preço digitado em formulário ("12,50") → centavos, validado pelas mesmas regras de `priceCentsSchema`. */
export const priceInputSchema = z
  .string({ error: "Preço é obrigatório" })
  .trim()
  .min(1, "Preço é obrigatório")
  .transform((value, ctx) => {
    const cents = parseMoneyToCents(value);
    if (cents === null) {
      ctx.issues.push({ code: "custom", message: "Preço inválido. Use o formato 12,50", input: value });
      return z.NEVER;
    }
    return cents;
  })
  .pipe(priceCentsSchema);

export const uuidSchema = z.uuid("Identificador inválido");

/** Converte o resultado de um parse falho em `{ campo: [mensagens] }` para formulários. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
