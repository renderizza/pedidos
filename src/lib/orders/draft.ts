import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { isForeignKeyViolation } from "@/db/errors";
import { categories, orderDraftItems, orderDrafts, products } from "@/db/schema";
import { MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS, draftItemsSchema } from "@/lib/validation/order";
import { uuidSchema } from "@/lib/validation/common";

export class DraftProductUnavailableError extends Error {
  constructor(public readonly productIds: string[]) {
    super(
      productIds.length === 1
        ? "Um dos produtos não está mais disponível"
        : `${productIds.length} produtos não estão mais disponíveis`,
    );
    this.name = "DraftProductUnavailableError";
  }
}

export class DraftLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftLimitError";
  }
}

export type DraftLine = {
  productId: string;
  reference: string;
  description: string;
  priceCents: number;
  categoryName: string | null;
  quantity: number;
};

export type DraftView = {
  /** Linhas ainda disponíveis (produto ativo), na ordem em que foram montadas. */
  lines: DraftLine[];
  /** Linhas gravadas cujo produto foi desativado depois — não entram na tabela. */
  unavailableCount: number;
};

/** Rascunho atual do usuário, com os preços VIGENTES do cadastro. */
export async function getDraft(userId: string): Promise<DraftView> {
  const rows = await getDb()
    .select({
      productId: products.id,
      reference: products.reference,
      description: products.description,
      priceCents: products.priceCents,
      active: products.active,
      categoryName: categories.name,
      quantity: orderDraftItems.quantity,
    })
    .from(orderDraftItems)
    .innerJoin(products, eq(products.id, orderDraftItems.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(orderDraftItems.userId, userId))
    .orderBy(asc(orderDraftItems.position));

  const lines = rows.filter((row) => row.active).map(({ active: _active, ...line }) => line);
  return { lines, unavailableCount: rows.length - lines.length };
}

/**
 * Substitui o rascunho inteiro pelas linhas informadas (produto + quantidade).
 * Lista vazia apaga o rascunho. Todos os produtos precisam existir e estar ativos.
 */
export async function saveDraft(userId: string, items: unknown): Promise<void> {
  const parsed = draftItemsSchema.parse(items);
  if (parsed.length === 0) return clearDraft(userId);

  const db = getDb();
  const ids = parsed.map((item) => item.productId);
  const found = await db
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.active, true)));
  const available = new Set(found.map((product) => product.id));
  const missing = ids.filter((id) => !available.has(id));
  if (missing.length > 0) throw new DraftProductUnavailableError(missing);

  try {
    await db.transaction(async (tx) => {
      // O upsert trava a linha do rascunho: dois salvamentos simultâneos do mesmo
      // usuário são serializados, então o resultado final é sempre UMA das listas inteiras.
      await tx
        .insert(orderDrafts)
        .values({ userId })
        .onConflictDoUpdate({ target: orderDrafts.userId, set: { updatedAt: new Date() } });
      await tx.delete(orderDraftItems).where(eq(orderDraftItems.userId, userId));
      await tx.insert(orderDraftItems).values(
        parsed.map((item, position) => ({ userId, productId: item.productId, quantity: item.quantity, position })),
      );
    });
  } catch (error) {
    // O produto foi excluído entre a conferência e a gravação.
    if (isForeignKeyViolation(error)) throw new DraftProductUnavailableError(ids);
    throw error;
  }
}

/** Soma 1 à quantidade do produto no rascunho (cria a linha se ainda não existir). */
export async function addToDraft(userId: string, productId: string): Promise<{ quantity: number }> {
  if (!uuidSchema.safeParse(productId).success) throw new DraftProductUnavailableError([productId]);
  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.active, true)))
        .limit(1);
      if (!product) throw new DraftProductUnavailableError([productId]);

      await tx
        .insert(orderDrafts)
        .values({ userId })
        .onConflictDoUpdate({ target: orderDrafts.userId, set: { updatedAt: new Date() } });

      const [existing] = await tx
        .select({ id: orderDraftItems.id, quantity: orderDraftItems.quantity })
        .from(orderDraftItems)
        .where(and(eq(orderDraftItems.userId, userId), eq(orderDraftItems.productId, productId)))
        .limit(1);

      if (existing) {
        if (existing.quantity >= MAX_ITEM_QUANTITY) {
          throw new DraftLimitError(`A quantidade máxima por produto é ${MAX_ITEM_QUANTITY}`);
        }
        const quantity = existing.quantity + 1;
        await tx.update(orderDraftItems).set({ quantity }).where(eq(orderDraftItems.id, existing.id));
        return { quantity };
      }

      const [{ total, last }] = await tx
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          last: sql<number>`coalesce(max(${orderDraftItems.position}), -1)`.mapWith(Number),
        })
        .from(orderDraftItems)
        .where(eq(orderDraftItems.userId, userId));
      if (total >= MAX_ORDER_ITEMS) {
        throw new DraftLimitError(`O pedido pode ter no máximo ${MAX_ORDER_ITEMS} produtos`);
      }
      await tx.insert(orderDraftItems).values({ userId, productId, quantity: 1, position: last + 1 });
      return { quantity: 1 };
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw new DraftProductUnavailableError([productId]);
    throw error;
  }
}

export async function clearDraft(userId: string): Promise<void> {
  // As linhas saem junto (ON DELETE CASCADE).
  await getDb().delete(orderDrafts).where(eq(orderDrafts.userId, userId));
}
