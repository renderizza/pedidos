import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { isForeignKeyViolation, isUniqueViolation } from "@/db/errors";
import { categories, products, type Product } from "@/db/schema";
import { clampPage, DEFAULT_PAGE_SIZE, totalPagesFor } from "@/lib/pagination";
import { escapeLike } from "@/lib/sql";
import { uuidSchema } from "@/lib/validation/common";
import { productInputSchema, type ProductInput } from "@/lib/validation/product";

export class DuplicateReferenceError extends Error {
  constructor(reference: string) {
    super(`Já existe um produto com a referência ${reference}`);
    this.name = "DuplicateReferenceError";
  }
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("Produto não encontrado");
    this.name = "ProductNotFoundError";
  }
}

export class ProductCategoryNotFoundError extends Error {
  constructor() {
    super("A categoria informada não existe");
    this.name = "ProductCategoryNotFoundError";
  }
}

export type ProductRow = Product & { categoryName: string | null };

export type ProductStatusFilter = "all" | "active" | "inactive";

export type ProductListParams = {
  /** Busca por trecho da referência ou da descrição (sem diferenciar maiúsculas). */
  search?: string;
  /** UUID de uma categoria, ou "none" para produtos sem categoria. */
  categoryId?: string;
  status?: ProductStatusFilter;
  page?: number;
  pageSize?: number;
};

export type ProductListResult = {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const isUuid = (value: string) => uuidSchema.safeParse(value).success;

export async function listProducts(params: ProductListParams = {}): Promise<ProductListResult> {
  const db = getDb();
  const pageSize = Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE);

  const filters: SQL[] = [];
  const search = params.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    filters.push(or(ilike(products.reference, pattern), ilike(products.description, pattern))!);
  }
  if (params.categoryId === "none") {
    filters.push(isNull(products.categoryId));
  } else if (params.categoryId) {
    // UUID malformado nunca casa com nada (e evita erro de cast no PostgreSQL).
    filters.push(isUuid(params.categoryId) ? eq(products.categoryId, params.categoryId) : sql`false`);
  }
  if (params.status === "active") filters.push(eq(products.active, true));
  if (params.status === "inactive") filters.push(eq(products.active, false));
  const where = filters.length ? and(...filters) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(products).where(where);
  const totalPages = totalPagesFor(total, pageSize);
  const page = clampPage(params.page ?? 1, totalPages);

  const items = await db
    .select({
      id: products.id,
      reference: products.reference,
      description: products.description,
      priceCents: products.priceCents,
      imageUrl: products.imageUrl,
      categoryId: products.categoryId,
      active: products.active,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(asc(products.reference), asc(products.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total, page, pageSize, totalPages };
}

export async function getProduct(id: string): Promise<Product | null> {
  if (!isUuid(id)) return null;
  const [row] = await getDb().select().from(products).where(eq(products.id, id)).limit(1);
  return row ?? null;
}

export async function createProduct(input: ProductInput | Record<string, unknown>): Promise<Product> {
  const data = productInputSchema.parse(input);
  try {
    const [created] = await getDb().insert(products).values(data).returning();
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateReferenceError(data.reference);
    if (isForeignKeyViolation(error)) throw new ProductCategoryNotFoundError();
    throw error;
  }
}

export async function updateProduct(id: string, input: ProductInput | Record<string, unknown>): Promise<Product> {
  const data = productInputSchema.parse(input);
  if (!isUuid(id)) throw new ProductNotFoundError();
  try {
    const [updated] = await getDb().update(products).set(data).where(eq(products.id, id)).returning();
    if (!updated) throw new ProductNotFoundError();
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateReferenceError(data.reference);
    if (isForeignKeyViolation(error)) throw new ProductCategoryNotFoundError();
    throw error;
  }
}

/**
 * Exclui o produto. Itens de pedidos antigos continuam intactos: eles guardam uma
 * cópia (referência, descrição e preço) e apenas perdem o vínculo `product_id`.
 */
export async function deleteProduct(id: string): Promise<void> {
  if (!isUuid(id)) throw new ProductNotFoundError();
  const deleted = await getDb().delete(products).where(eq(products.id, id)).returning({ id: products.id });
  if (deleted.length === 0) throw new ProductNotFoundError();
}

export const MAX_ORDERABLE_PRODUCTS = 2000;

export type OrderableProduct = {
  id: string;
  reference: string;
  description: string;
  priceCents: number;
  imageUrl: string | null;
  categoryName: string | null;
};

/** Catálogo completo de produtos ATIVOS, usado pelo seletor da tabela de pedido. */
export async function listOrderableProducts(): Promise<OrderableProduct[]> {
  return getDb()
    .select({
      id: products.id,
      reference: products.reference,
      description: products.description,
      priceCents: products.priceCents,
      imageUrl: products.imageUrl,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.active, true))
    .orderBy(asc(products.reference), asc(products.id))
    .limit(MAX_ORDERABLE_PRODUCTS);
}

export type CatalogStats = { categories: number; products: number; activeProducts: number };

export async function getCatalogStats(): Promise<CatalogStats> {
  const db = getDb();
  const [{ total: categoryTotal }] = await db.select({ total: count() }).from(categories);
  const [{ total: productTotal, active }] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${products.active})`.mapWith(Number),
    })
    .from(products);
  return { categories: categoryTotal, products: productTotal, activeProducts: active };
}
