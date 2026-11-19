import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { listCategories } from "@/lib/categories/service";
import {
  createProduct,
  deleteProduct,
  DuplicateReferenceError,
  getCatalogStats,
  getProduct,
  listProducts,
  ProductCategoryNotFoundError,
  ProductNotFoundError,
  updateProduct,
} from "@/lib/products/service";
import { insertCategory, insertProduct } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const valid = { reference: "ab-1", description: "Camiseta básica", priceCents: 4990 };

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("createProduct", () => {
  it("cria com os campos obrigatórios, referência em maiúsculas, ativo e sem categoria", async () => {
    const product = await createProduct(valid);
    expect(product).toMatchObject({
      reference: "AB-1",
      description: "Camiseta básica",
      priceCents: 4990,
      categoryId: null,
      active: true,
    });
  });

  it("vincula a uma categoria existente", async () => {
    const category = await insertCategory("Roupas");
    const product = await createProduct({ ...valid, categoryId: category.id });
    expect(product.categoryId).toBe(category.id);
  });

  it("rejeita referência duplicada, ignorando maiúsculas/minúsculas", async () => {
    await createProduct(valid);
    await expect(createProduct({ ...valid, reference: "AB-1" })).rejects.toBeInstanceOf(DuplicateReferenceError);
    await expect(createProduct({ ...valid, reference: " ab-1 " })).rejects.toBeInstanceOf(DuplicateReferenceError);
  });

  it("rejeita categoria que não existe", async () => {
    await expect(createProduct({ ...valid, categoryId: MISSING_ID })).rejects.toBeInstanceOf(
      ProductCategoryNotFoundError,
    );
  });

  it.each([
    { ...valid, reference: "" },
    { ...valid, description: "ab" },
    { ...valid, priceCents: 0 },
    { ...valid, priceCents: -1 },
    { ...valid, priceCents: 10.5 },
    { reference: "X" },
  ])("valida com Zod antes de gravar: %j", async (input) => {
    await expect(createProduct(input)).rejects.toBeInstanceOf(ZodError);
    expect((await listProducts()).total).toBe(0);
  });
});

describe("updateProduct", () => {
  it("altera todos os campos e atualiza updated_at", async () => {
    const category = await insertCategory("Roupas");
    const product = await insertProduct({ reference: "A1", priceCents: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await updateProduct(product.id, {
      reference: "a1-novo",
      description: "Descrição nova",
      priceCents: 2550,
      categoryId: category.id,
      active: false,
    });

    expect(updated).toMatchObject({
      reference: "A1-NOVO",
      description: "Descrição nova",
      priceCents: 2550,
      categoryId: category.id,
      active: false,
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(product.updatedAt.getTime());
  });

  it("permite salvar mantendo a própria referência", async () => {
    const product = await insertProduct({ reference: "KEEP" });
    await expect(updateProduct(product.id, { ...valid, reference: "keep" })).resolves.toMatchObject({
      reference: "KEEP",
    });
  });

  it("rejeita referência de OUTRO produto", async () => {
    await insertProduct({ reference: "OUTRO" });
    const product = await insertProduct({ reference: "MEU" });
    await expect(updateProduct(product.id, { ...valid, reference: "outro" })).rejects.toBeInstanceOf(
      DuplicateReferenceError,
    );
    expect((await getProduct(product.id))?.reference).toBe("MEU");
  });

  it("falha para id inexistente/malformado e para categoria inexistente", async () => {
    await expect(updateProduct(MISSING_ID, valid)).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(updateProduct("xyz", valid)).rejects.toBeInstanceOf(ProductNotFoundError);
    const product = await insertProduct({ reference: "P" });
    await expect(updateProduct(product.id, { ...valid, categoryId: MISSING_ID })).rejects.toBeInstanceOf(
      ProductCategoryNotFoundError,
    );
  });
});

describe("deleteProduct", () => {
  it("exclui o produto", async () => {
    const product = await insertProduct({ reference: "DEL" });
    await deleteProduct(product.id);
    expect(await getProduct(product.id)).toBeNull();
  });

  it("falha para id inexistente ou malformado", async () => {
    await expect(deleteProduct(MISSING_ID)).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(deleteProduct("xyz")).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it("preserva o histórico: itens de pedidos antigos continuam com referência, descrição e preço", async () => {
    const { user } = await createUserWithSession("CONSULTOR");
    const product = await insertProduct({ reference: "HIST", description: "Produto histórico", priceCents: 3300 });
    const [order] = await getDb()
      .insert(orders)
      .values({ userId: user.id, customerName: "Cliente", totalCents: 6600 })
      .returning();
    await getDb().insert(orderItems).values({
      orderId: order.id,
      productId: product.id,
      reference: product.reference,
      description: product.description,
      unitPriceCents: 3300,
      quantity: 2,
      lineTotalCents: 6600,
    });

    await deleteProduct(product.id);

    const [item] = await getDb().select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(item).toMatchObject({
      productId: null,
      reference: "HIST",
      description: "Produto histórico",
      unitPriceCents: 3300,
      lineTotalCents: 6600,
    });
  });
});

describe("listProducts", () => {
  beforeEach(async () => {
    const roupas = await insertCategory("Roupas");
    const bebidas = await insertCategory("Bebidas");
    await insertProduct({ reference: "CAM-01", description: "Camiseta azul", categoryId: roupas.id, priceCents: 4990 });
    await insertProduct({ reference: "CAM-02", description: "Camiseta vermelha", categoryId: roupas.id, active: false });
    await insertProduct({ reference: "SUC-01", description: "Suco de uva 1L", categoryId: bebidas.id });
    await insertProduct({ reference: "AVU-01", description: "Desconto 50% na loja" });
    await insertProduct({ reference: "AVU-02", description: "Item_especial" });
  });

  it("ordena por referência e traz o nome da categoria", async () => {
    const { items, total } = await listProducts();
    expect(total).toBe(5);
    expect(items.map((p) => p.reference)).toEqual(["AVU-01", "AVU-02", "CAM-01", "CAM-02", "SUC-01"]);
    expect(items.find((p) => p.reference === "CAM-01")?.categoryName).toBe("Roupas");
    expect(items.find((p) => p.reference === "AVU-01")?.categoryName).toBeNull();
  });

  it("busca por trecho da referência ou da descrição, sem diferenciar maiúsculas", async () => {
    expect((await listProducts({ search: "cam-0" })).items.map((p) => p.reference)).toEqual(["CAM-01", "CAM-02"]);
    expect((await listProducts({ search: "UVA" })).items.map((p) => p.reference)).toEqual(["SUC-01"]);
    expect((await listProducts({ search: "  camiseta  " })).total).toBe(2);
    expect((await listProducts({ search: "nada-disso" })).total).toBe(0);
  });

  it("trata % e _ da busca como texto literal (sem curingas)", async () => {
    expect((await listProducts({ search: "%" })).items.map((p) => p.reference)).toEqual(["AVU-01"]);
    expect((await listProducts({ search: "50%" })).items.map((p) => p.reference)).toEqual(["AVU-01"]);
    expect((await listProducts({ search: "_" })).items.map((p) => p.reference)).toEqual(["AVU-02"]);
    expect((await listProducts({ search: "\\" })).total).toBe(0);
  });

  it("filtra por categoria, por 'sem categoria' e ignora UUID malformado", async () => {
    const roupas = (await listCategories()).find((c) => c.name === "Roupas")!;
    expect((await listProducts({ categoryId: roupas.id })).total).toBe(2);
    expect((await listProducts({ categoryId: "none" })).items.map((p) => p.reference)).toEqual(["AVU-01", "AVU-02"]);
    expect((await listProducts({ categoryId: "'; drop table products;--" })).total).toBe(0);
  });

  it("filtra por situação", async () => {
    expect((await listProducts({ status: "active" })).total).toBe(4);
    expect((await listProducts({ status: "inactive" })).items.map((p) => p.reference)).toEqual(["CAM-02"]);
    expect((await listProducts({ status: "all" })).total).toBe(5);
  });

  it("combina filtros", async () => {
    const result = await listProducts({ search: "cam", status: "active" });
    expect(result.items.map((p) => p.reference)).toEqual(["CAM-01"]);
  });

  it("pagina e ajusta páginas fora do intervalo", async () => {
    const first = await listProducts({ pageSize: 2, page: 1 });
    expect(first).toMatchObject({ total: 5, totalPages: 3, page: 1 });
    expect(first.items.map((p) => p.reference)).toEqual(["AVU-01", "AVU-02"]);

    const last = await listProducts({ pageSize: 2, page: 3 });
    expect(last.items.map((p) => p.reference)).toEqual(["SUC-01"]);

    const beyond = await listProducts({ pageSize: 2, page: 99 });
    expect(beyond.page).toBe(3);
    expect(beyond.items.map((p) => p.reference)).toEqual(["SUC-01"]);

    expect((await listProducts({ pageSize: 2, page: -5 })).page).toBe(1);
  });

  it("sem resultados: 1 página, lista vazia", async () => {
    expect(await listProducts({ search: "zzz" })).toMatchObject({ items: [], total: 0, totalPages: 1, page: 1 });
  });
});

describe("getCatalogStats", () => {
  it("conta categorias, produtos e produtos ativos", async () => {
    expect(await getCatalogStats()).toEqual({ categories: 0, products: 0, activeProducts: 0 });
    await insertCategory("A1");
    await insertCategory("B2");
    await insertProduct({ reference: "P1" });
    await insertProduct({ reference: "P2", active: false });
    await insertProduct({ reference: "P3" });
    expect(await getCatalogStats()).toEqual({ categories: 2, products: 3, activeProducts: 2 });
  });
});
