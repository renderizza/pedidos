import { z } from "zod";
import { normalizeImageUrl } from "@/lib/images/image-url";
import { priceCentsSchema, priceInputSchema, requiredText, uuidSchema } from "./common";

/** Referência: normalizada em maiúsculas; letras, números e . _ - / */
export const productReferenceSchema = requiredText("Referência", 1, 40)
  .transform((value) => value.toUpperCase())
  .pipe(
    z.string().regex(/^[A-Z0-9][A-Z0-9._\-/]*$/, {
      error: "Referência deve conter apenas letras, números, ponto, hífen, underline ou barra",
    }),
  );

/**
 * Endereço da imagem (opcional): vazio vira `null`; links do Google Drive viram o endereço direto da
 * imagem; só https é aceito. A mensagem de erro já explica o que o usuário deve fazer.
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const result = normalizeImageUrl(value);
    if (!result.ok) {
      ctx.issues.push({ code: "custom", message: result.error, input: value });
      return z.NEVER;
    }
    return result.url;
  });

export const productInputSchema = z.object({
  reference: productReferenceSchema,
  description: requiredText("Descrição", 3, 500),
  priceCents: priceCentsSchema,
  imageUrl: imageUrlSchema,
  categoryId: uuidSchema.nullish().transform((value) => value ?? null),
  active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * Versão para formulários HTML: tudo chega como texto.
 *  - `price` ("12,50") vira `priceCents`;
 *  - `imageUrl` vazio vira null; link do Google Drive vira o endereço direto da imagem;
 *  - `categoryId` vazio vira null;
 *  - `active` é um checkbox ("on" quando marcado, ausente quando não).
 */
export const productFormSchema = z
  .object({
    reference: productReferenceSchema,
    description: requiredText("Descrição", 3, 500),
    price: priceInputSchema,
    imageUrl: imageUrlSchema,
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
