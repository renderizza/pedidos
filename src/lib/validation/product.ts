import { z } from "zod";
import { priceCentsSchema, priceInputSchema, requiredText, uuidSchema } from "./common";

/** Referência: normalizada em maiúsculas; letras, números e . _ - / */
export const productReferenceSchema = requiredText("Referência", 1, 40)
  .transform((value) => value.toUpperCase())
  .pipe(
    z.string().regex(/^[A-Z0-9][A-Z0-9._\-/]*$/, {
      error: "Referência deve conter apenas letras, números, ponto, hífen, underline ou barra",
    }),
  );

export const productInputSchema = z.object({
  reference: productReferenceSchema,
  description: requiredText("Descrição", 3, 500),
  priceCents: priceCentsSchema,
  categoryId: uuidSchema.nullish().transform((value) => value ?? null),
  active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * Versão para formulários HTML: tudo chega como texto.
 *  - `price` ("12,50") vira `priceCents`;
 *  - `categoryId` vazio vira null;
 *  - `active` é um checkbox ("on" quando marcado, ausente quando não).
 */
export const productFormSchema = z
  .object({
    reference: productReferenceSchema,
    description: requiredText("Descrição", 3, 500),
    price: priceInputSchema,
    categoryId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(uuidSchema.nullable()),
    active: z
      .string()
      .optional()
      .transform((value) => value === "on" || value === "true"),
  })
  .transform(({ price, ...rest }) => ({ ...rest, priceCents: price }));

export type ProductFormInput = z.output<typeof productFormSchema>;
