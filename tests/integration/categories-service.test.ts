import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { products } from "@/db/schema";
import {
  CategoryInUseError,
  CategoryNotFoundError,
  createCategory,
  deleteCategory,
  DuplicateCategoryError,
  getCategory,
  listCategories,
  updateCategory,
} from "@/lib/categories/service";
import { insertCategory, insertProduct } from "../setup/catalog-fixtures";
import { resetDatabase } from "../setup/db-helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("createCategory", () => {
  it("cria e apara o nome", async () => {
    const category = await createCategory({ name: "  Bebidas  " });
    expect(category.name).toBe("Bebidas");
    expect(await getCategory(category.id)).toMatchObject({ name: "Bebidas" });
  });

  it("rejeita nome duplicado ignorando maiúsculas/minúsculas", async () => {
    await createCategory({ name: "Bebidas" });
    await expect(createCategory({ name: "BEBIDAS" })).rejects.toBeInstanceOf(DuplicateCategoryError);
  });

  it.each([{ name: "" }, { name: "A" }, { name: "x".repeat(61) }, {}])("valida com Zod: %j", async (input) => {
    await expect(createCategory(input)).rejects.toBeInstanceOf(ZodError);
    expect(await listCategories()).toHaveLength(0);
  });
});

describe("listCategories", () => {
  it("ordena por nome (sem diferenciar maiúsculas) e conta os produtos de cada uma", async () => {
    const roupas = await insertCategory("roupas");
    const bebidas = await insertCategory("Bebidas");
    await insertCategory("Acessórios");
    await insertProduct({ reference: "R1", categoryId: roupas.id });
    await insertProduct({ reference: "R2", categoryId: roupas.id });
    await insertProduct({ reference: "B1", categoryId: bebidas.id });
    await insertProduct({ reference: "SEM" });

    const list = await listCategories();
    expect(list.map((c) => [c.name, c.productCount])).toEqual([
      ["Acessórios", 0],
      ["Bebidas", 1],
      ["roupas", 2],
    ]);
  });
});

describe("getCategory", () => {
  it("devolve null para id inexistente ou malformado (sem erro de cast no banco)", async () => {
    expect(await getCategory(MISSING_ID)).toBeNull();
    expect(await getCategory("nao-e-uuid")).toBeNull();
  });
});

describe("updateCategory", () => {
  it("renomeia e atualiza updated_at", async () => {
    const category = await insertCategory("Antiga");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await updateCategory(category.id, { name: "Nova" });
    expect(updated.name).toBe("Nova");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(category.updatedAt.getTime());
  });

  it("permite salvar com o mesmo nome (ou só trocando maiúsculas) na própria categoria", async () => {
    const category = await insertCategory("Bebidas");
    await expect(updateCategory(category.id, { name: "Bebidas" })).resolves.toBeDefined();
    await expect(updateCategory(category.id, { name: "BEBIDAS" })).resolves.toMatchObject({ name: "BEBIDAS" });
  });

  it("rejeita nome já usado por OUTRA categoria", async () => {
    await insertCategory("Bebidas");
    const roupas = await insertCategory("Roupas");
    await expect(updateCategory(roupas.id, { name: "bebidas" })).rejects.toBeInstanceOf(DuplicateCategoryError);
  });

  it("falha com CategoryNotFoundError para id inexistente ou malformado", async () => {
    await expect(updateCategory(MISSING_ID, { name: "Qualquer" })).rejects.toBeInstanceOf(CategoryNotFoundError);
    await expect(updateCategory("xyz", { name: "Qualquer" })).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("valida o nome com Zod", async () => {
    const category = await insertCategory("Ok");
    await expect(updateCategory(category.id, { name: " " })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("deleteCategory", () => {
  it("exclui categoria sem produtos", async () => {
    const category = await insertCategory("Vazia");
    await deleteCategory(category.id);
    expect(await getCategory(category.id)).toBeNull();
  });

  it("recusa excluir categoria com produtos, informando a quantidade, e não altera nada", async () => {
    const category = await insertCategory("Em uso");
    await insertProduct({ reference: "P1", categoryId: category.id });
    await insertProduct({ reference: "P2", categoryId: category.id });

    const error = await deleteCategory(category.id).catch((e) => e);
    expect(error).toBeInstanceOf(CategoryInUseError);
    expect(error.productCount).toBe(2);
    expect(error.message).toContain("2 produto(s)");
    expect((await listCategories())[0].productCount).toBe(2);
  });

  it("permite excluir depois que os produtos saem da categoria", async () => {
    const category = await insertCategory("Temporária");
    const product = await insertProduct({ reference: "P1", categoryId: category.id });
    await expect(deleteCategory(category.id)).rejects.toBeInstanceOf(CategoryInUseError);

    await getDb().update(products).set({ categoryId: null }).where(eq(products.id, product.id));

    await expect(deleteCategory(category.id)).resolves.toBeUndefined();
  });

  it("falha com CategoryNotFoundError para id inexistente ou malformado", async () => {
    await expect(deleteCategory(MISSING_ID)).rejects.toBeInstanceOf(CategoryNotFoundError);
    await expect(deleteCategory("xyz")).rejects.toBeInstanceOf(CategoryNotFoundError);
  });
});
