import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL é obrigatória" })
    .url("DATABASE_URL deve ser uma URL válida")
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      error: "DATABASE_URL deve usar o protocolo postgres:// ou postgresql://",
    }),
  /**
   * Número de WhatsApp que recebe os pedidos (opcional). Aceita máscara; guarda só dígitos.
   * Sem ele, o link do pedido abre o WhatsApp para o usuário escolher o contato.
   */
  WHATSAPP_ORDERS_NUMBER: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      if (trimmed === "") return undefined; // em branco = não configurado
      return trimmed.replace(/\D/g, ""); // texto sem nenhum dígito vira "" e é rejeitado abaixo
    })
    .pipe(
      z
        .string()
        .regex(/^\d{10,15}$/, { error: "WHATSAPP_ORDERS_NUMBER deve ter de 10 a 15 dígitos (com DDD)" })
        .optional(),
    ),
});

export type Env = z.infer<typeof envSchema>;

/** Valida variáveis de ambiente (função pura, fácil de testar). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Variáveis de ambiente inválidas — ${details}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lê e memoriza o ambiente do processo. Falha cedo se algo estiver errado. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
