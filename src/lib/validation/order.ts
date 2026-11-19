import { z } from "zod";
import { ORDER_STATUSES } from "@/lib/orders/status";
import { requiredText, uuidSchema } from "./common";

export const MAX_ITEM_QUANTITY = 9999;
export const MAX_ORDER_ITEMS = 200;

export const orderStatusSchema = z.enum(ORDER_STATUSES, { error: "Status de pedido inválido" });

/**
 * Telefone opcional: aceita máscara ("(11) 98888-7777"), guarda só dígitos e exige
 * de 10 a 13 dígitos (DDD + número, com ou sem o código do país 55).
 */
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{10,13}$/, { error: "Telefone inválido (informe DDD + número)" }));

export const orderItemInputSchema = z.object({
  productId: uuidSchema,
  quantity: z
    .number({ error: "Quantidade é obrigatória" })
    .int("Quantidade deve ser um número inteiro")
    .min(1, "Quantidade deve ser ao menos 1")
    .max(MAX_ITEM_QUANTITY, `Quantidade deve ser no máximo ${MAX_ITEM_QUANTITY}`),
});

const uniqueProducts = (items: { productId: string }[]) =>
  new Set(items.map((item) => item.productId)).size === items.length;
const DUPLICATE_PRODUCT_MESSAGE = "O mesmo produto não pode aparecer em mais de uma linha";
const tooManyItems = `O pedido deve ter no máximo ${MAX_ORDER_ITEMS} itens`;

/** Linhas de um rascunho: pode estar vazio (pedido ainda sem produtos). */
export const draftItemsSchema = z
  .array(orderItemInputSchema)
  .max(MAX_ORDER_ITEMS, tooManyItems)
  .refine(uniqueProducts, { error: DUPLICATE_PRODUCT_MESSAGE });

/**
 * Entrada de um pedido. Preços NÃO fazem parte da entrada: o servidor sempre busca o
 * valor unitário no cadastro de produtos (nunca confia no valor enviado pelo cliente).
 */
export const createOrderInputSchema = z.object({
  customerName: requiredText("Nome do cliente", 2, 120),
  customerPhone: z
    .union([phoneSchema, z.literal("")])
    .optional()
    .transform((value) => (value ? value : null)),
  notes: z
    .string()
    .trim()
    .max(500, "Observações devem ter no máximo 500 caracteres")
    .optional()
    .transform((value) => (value ? value : null)),
  items: z
    .array(orderItemInputSchema)
    .min(1, "O pedido deve ter ao menos um item")
    .max(MAX_ORDER_ITEMS, tooManyItems)
    .refine(uniqueProducts, { error: DUPLICATE_PRODUCT_MESSAGE }),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type DraftItemInput = z.infer<typeof orderItemInputSchema>;

/** Dados informados ao finalizar: cliente + o total que o usuário viu na tela (proteção contra preço alterado). */
export const finalizeOrderSchema = createOrderInputSchema
  .pick({ customerName: true, customerPhone: true, notes: true })
  .extend({
    expectedTotalCents: z
      .number({ error: "Total esperado é obrigatório" })
      .int("Total esperado inválido")
      .min(0, "Total esperado inválido"),
  });

export type FinalizeOrderInput = z.input<typeof finalizeOrderSchema>;

/** Pedido interno (CONSULTOR): sem dados de cliente, só o total que a pessoa viu na tela. Outros campos são descartados. */
export const internalOrderSchema = finalizeOrderSchema.pick({ expectedTotalCents: true });

/**
 * Pedido de visitante (sem cadastro): não existe rascunho no banco, então os itens
 * (produto + quantidade) chegam junto, além dos dados do cliente e do total que ele viu.
 * Os preços continuam vindo SEMPRE do cadastro de produtos.
 */
export const guestOrderSchema = createOrderInputSchema.extend({
  expectedTotalCents: finalizeOrderSchema.shape.expectedTotalCents,
});

export type GuestOrderInput = z.input<typeof guestOrderSchema>;
