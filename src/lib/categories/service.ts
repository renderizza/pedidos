import { and, asc, count, eq, notExists, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { categories, products, type Category } from "@/db/schema";
import { categoryInputSchema, type CategoryInput } from "@/lib/validation/category";
import { uuidSchema } from "@/lib/validation/common";

export class DuplicateCategoryError extends Error {
  constructor(name: string) {
    super(`Já existe uma categoria chamada "${name}"`);
    this.name = "DuplicateCategoryError";
  }
}

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Categoria não encontrada");
    this.name = "CategoryNotFoundError";
  }
}

export class CategoryInUseError extends Error {
  constructor(public readonly productCount: number) {
    super(
      `A categoria possui ${productCount} produto(s). Mova-os para outra categoria antes de excluí-la.`,
    );
    this.name = "CategoryInUseError";
  }
}

export type CategoryWithCount = Category & { productCount: number };

const isUuid = (value: string) => uuidSchema.safeParse(value).success;

export async function listCategories(): Promise<CategoryWithCount[]> {
  return getDb()
    .select({
      id: categories.id,
      name: categories.name,
      createdAt: categories.createdAt,
      updatedAt: categories.updatedAt,
      productCount: count(products.id),
    })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(sql`lower(${categories.name})`));
}

export async function getCategory(id: string): Promise<Category | null> {
  if (!isUuid(id)) return null;
  const [row] = await getDb().select().from(categories).where(eq(categories.id, id)).limit(1);
  return row ?? null;
}

export async function createCategory(input: CategoryInput | Record<string, unknown>): Promise<Category> {
  const data = categoryInputSchema.parse(input);
  try {
    const [created] = await getDb().insert(categories).values({ name: data.name }).returning();
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCategoryError(data.name);
    throw error;
  }
}

export async function updateCategory(
  id: string,
  input: CategoryInput | Record<string, unknown>,
): Promise<Category> {
  const data = categoryInputSchema.parse(input);
  if (!isUuid(id)) throw new CategoryNotFoundError();
  try {
    const [updated] = await getDb()
      .update(categories)
      .set({ name: data.name })
      .where(eq(categories.id, id))
      .returning();
    if (!updated) throw new CategoryNotFoundError();
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCategoryError(data.name);
    throw error;
  }
}

/** Exclui apenas categorias sem produtos (a checagem e o DELETE são uma única instrução). */
export async function deleteCategory(id: string): Promise<void> {
  if (!isUuid(id)) throw new CategoryNotFoundError();
  const db = getDb();

  const deleted = await db
    .delete(categories)
    .where(
      and(
        eq(categories.id, id),
        notExists(db.select({ one: sql`1` }).from(products).where(eq(products.categoryId, categories.id))),
      ),
    )
    .returning({ id: categories.id });
  if (deleted.length > 0) return;

  // Nada foi excluído: ou a categoria não existe, ou ainda tem produtos.
  const [{ total }] = await db
    .select({ total: count() })
    .from(products)
    .where(eq(products.categoryId, id));
  if (total > 0) throw new CategoryInUseError(total);
  throw new CategoryNotFoundError();
}
