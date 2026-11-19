import { getDb } from "@/db";
import { categories, products } from "@/db/schema";

export async function insertCategory(name: string) {
  const [category] = await getDb().insert(categories).values({ name }).returning();
  return category;
}

export async function insertProduct(
  overrides: Partial<typeof products.$inferInsert> & { reference: string },
) {
  const [product] = await getDb()
    .insert(products)
    .values({ description: `Produto ${overrides.reference}`, priceCents: 1000, ...overrides })
    .returning();
  return product;
}

export function formWith(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

type OrderLine = { productId: string; priceCents: number; quantity: number };

/**
 * Lança um pedido pelo mesmo caminho do sistema: monta o rascunho e o finaliza.
 * O total esperado é calculado aqui, como a tela faria.
 */
export async function placeOrder(
  userId: string,
  lines: OrderLine[],
  customer: { customerName?: string; customerPhone?: string; notes?: string } = {},
) {
  const { saveDraft } = await import("@/lib/orders/draft");
  const { finalizeDraft } = await import("@/lib/orders/finalize");
  await saveDraft(
    userId,
    lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  );
  return finalizeDraft(userId, {
    customerName: customer.customerName ?? "Cliente Teste",
    customerPhone: customer.customerPhone ?? "",
    notes: customer.notes ?? "",
    expectedTotalCents: lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0),
  });
}
