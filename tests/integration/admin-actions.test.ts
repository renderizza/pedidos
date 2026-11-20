import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/app/admin/categorias/actions";
import {
  createProductAction,
  deleteProductAction,
  updateProductAction,
} from "@/app/admin/produtos/actions";
import { closeDb } from "@/db";
import { getCategory, listCategories } from "@/lib/categories/service";
import { getProduct, listProducts } from "@/lib/products/service";
import { SESSION_COOKIE } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/roles";
import { formWith, insertCategory, insertProduct } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";
import {
  cookieJar,
  ForbiddenError,
  RedirectError,
  resetNextMocks,
  revalidatedPaths,
} from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("../setup/next-mocks")).nextCacheMock);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function loginAs(role: UserRole) {
  const { token } = await createUserWithSession(role);
  cookieJar.set(SESSION_COOKIE, token);
}

const productForm = (overrides: Record<string, string> = {}) =>
  formWith({
    reference: "cam-01",
    description: "Camiseta básica",
    price: "49,90",
    categoryId: "",
    active: "on",
    ...overrides,
  });

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// Autorização: nenhuma ação pode ser executada por quem não é ADMIN
// ─────────────────────────────────────────────────────────────────────────────
describe("autorização das Server Actions (RBAC)", () => {
  async function runAll() {
    const category = await insertCategory("Existente");
    const product = await insertProduct({ reference: "EXISTENTE" });
    return {
      category,
      product,
      calls: [
        () => createCategoryAction(undefined, formWith({ name: "Nova" })),
        () => updateCategoryAction(category.id, undefined, formWith({ name: "Alterada" })),
        () => deleteCategoryAction(category.id, undefined),
        () => createProductAction(undefined, productForm({ reference: "NOVO" })),
        () => updateProductAction(product.id, undefined, productForm({ reference: "ALTERADO" })),
        () => deleteProductAction(product.id, undefined),
      ],
    };
  }

  async function expectNothingChanged(categoryId: string, productId: string) {
    expect((await listCategories()).map((c) => c.name)).toEqual(["Existente"]);
    expect((await getCategory(categoryId))?.name).toBe("Existente");
    expect((await listProducts()).items.map((p) => p.reference)).toEqual(["EXISTENTE"]);
    expect((await getProduct(productId))?.reference).toBe("EXISTENTE");
    expect(revalidatedPaths).toEqual([]);
  }

  it("visitante é redirecionado ao login em TODAS as ações e nada é alterado", async () => {
    const { category, product, calls } = await runAll();
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ url: "/login" });
    }
    await expectNothingChanged(category.id, product.id);
  });

  it.each(["CONSULTOR", "CLIENTE"] as const)("%s recebe 403 em TODAS as ações e nada é alterado", async (role) => {
    const { category, product, calls } = await runAll();
    await loginAs(role);
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expectNothingChanged(category.id, product.id);
  });

  it("ADMIN executa normalmente", async () => {
    await loginAs("ADMIN");
    await expect(createCategoryAction(undefined, formWith({ name: "Nova" }))).rejects.toBeInstanceOf(RedirectError);
    expect((await listCategories()).map((c) => c.name)).toEqual(["Nova"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Categorias
// ─────────────────────────────────────────────────────────────────────────────
describe("categorias (ADMIN)", () => {
  beforeEach(async () => {
    await loginAs("ADMIN");
  });

  it("criar: grava, revalida a lista e redireciona com status=created", async () => {
    await expect(createCategoryAction(undefined, formWith({ name: "  Bebidas " }))).rejects.toMatchObject({
      url: "/admin/categorias?status=created",
    });
    expect((await listCategories()).map((c) => c.name)).toEqual(["Bebidas"]);
    expect(revalidatedPaths).toEqual(["/admin/categorias"]);
  });

  it.each([
    ["vazio", "", "Nome da categoria é obrigatório"],
    ["curto", "A", "Nome da categoria deve ter ao menos 2 caracteres"],
    ["longo", "x".repeat(61), "Nome da categoria deve ter no máximo 60 caracteres"],
  ])("criar com nome %s: devolve erro de campo e preserva o valor digitado", async (_label, name, message) => {
    const state = await createCategoryAction(undefined, formWith({ name }));
    expect(state?.fieldErrors?.name).toEqual([message]);
    expect(state?.values).toEqual({ name });
    expect(await listCategories()).toHaveLength(0);
    expect(revalidatedPaths).toEqual([]);
  });

  it("criar sem enviar o campo name também é tratado como erro de validação", async () => {
    const state = await createCategoryAction(undefined, new FormData());
    expect(state?.fieldErrors?.name).toBeDefined();
  });

  it("criar com nome duplicado (outra caixa) devolve erro no campo", async () => {
    await insertCategory("Bebidas");
    const state = await createCategoryAction(undefined, formWith({ name: "BEBIDAS" }));
    expect(state?.fieldErrors?.name?.[0]).toContain("Já existe uma categoria");
    expect(await listCategories()).toHaveLength(1);
  });

  it("editar: renomeia e redireciona com status=updated", async () => {
    const category = await insertCategory("Antiga");
    await expect(updateCategoryAction(category.id, undefined, formWith({ name: "Nova" }))).rejects.toMatchObject({
      url: "/admin/categorias?status=updated",
    });
    expect((await getCategory(category.id))?.name).toBe("Nova");
  });

  it("editar: valida, rejeita duplicado e informa categoria inexistente", async () => {
    await insertCategory("Bebidas");
    const roupas = await insertCategory("Roupas");

    expect((await updateCategoryAction(roupas.id, undefined, formWith({ name: "" })))?.fieldErrors?.name).toBeDefined();
    expect(
      (await updateCategoryAction(roupas.id, undefined, formWith({ name: "bebidas" })))?.fieldErrors?.name?.[0],
    ).toContain("Já existe");
    expect((await updateCategoryAction(MISSING_ID, undefined, formWith({ name: "Qualquer" })))?.error).toBe(
      "Categoria não encontrada",
    );
    expect((await getCategory(roupas.id))?.name).toBe("Roupas");
  });

  it("excluir: remove categoria vazia e revalida a lista", async () => {
    const category = await insertCategory("Vazia");
    expect(await deleteCategoryAction(category.id, undefined)).toBeUndefined();
    expect(await getCategory(category.id)).toBeNull();
    expect(revalidatedPaths).toEqual(["/admin/categorias"]);
  });

  it("excluir: recusa categoria com produtos e explica o motivo", async () => {
    const category = await insertCategory("Em uso");
    await insertProduct({ reference: "P1", categoryId: category.id });
    const state = await deleteCategoryAction(category.id, undefined);
    expect(state?.error).toContain("1 produto(s)");
    expect(await getCategory(category.id)).not.toBeNull();
    expect(revalidatedPaths).toEqual([]);
  });

  it("excluir: id inexistente ou malformado devolve erro (sem lançar)", async () => {
    expect((await deleteCategoryAction(MISSING_ID, undefined))?.error).toBe("Categoria não encontrada");
    expect((await deleteCategoryAction("xyz", undefined))?.error).toBe("Categoria não encontrada");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Produtos
// ─────────────────────────────────────────────────────────────────────────────
describe("produtos (ADMIN)", () => {
  beforeEach(async () => {
    await loginAs("ADMIN");
  });

  it("criar: converte '49,90' em centavos, normaliza a referência e redireciona", async () => {
    const category = await insertCategory("Roupas");
    await expect(
      createProductAction(undefined, productForm({ categoryId: category.id })),
    ).rejects.toMatchObject({ url: "/admin/produtos?status=created" });

    const [product] = (await listProducts()).items;
    expect(product).toMatchObject({
      reference: "CAM-01",
      description: "Camiseta básica",
      priceCents: 4990,
      categoryId: category.id,
      categoryName: "Roupas",
      active: true,
    });
    expect(revalidatedPaths).toEqual(["/admin/produtos"]);
  });

  it("criar sem marcar 'ativo' grava o produto como inativo", async () => {
    await expect(createProductAction(undefined, productForm({ active: "" }))).rejects.toBeInstanceOf(RedirectError);
    expect((await listProducts()).items[0].active).toBe(false);
  });

  it("criar sem categoria é permitido", async () => {
    await expect(createProductAction(undefined, productForm())).rejects.toBeInstanceOf(RedirectError);
    expect((await listProducts()).items[0].categoryId).toBeNull();
  });

  it.each([
    ["referência vazia", { reference: "" }, "reference", "Referência é obrigatório"],
    ["referência inválida", { reference: "a b" }, "reference", "Referência deve conter apenas"],
    ["descrição curta", { description: "ab" }, "description", "ao menos 3 caracteres"],
    ["preço vazio", { price: "" }, "price", "Preço é obrigatório"],
    ["preço em texto", { price: "doze" }, "price", "Preço inválido"],
    ["preço zero", { price: "0,00" }, "price", "maior que zero"],
    ["preço negativo", { price: "-5,00" }, "price", "Preço inválido"],
    ["preço gigante", { price: "99999999999,00" }, "price", "Preço"],
    ["categoria que não é UUID", { categoryId: "123" }, "categoryId", "inválido"],
  ])("criar com %s: devolve erro em '%s' e não grava", async (_label, overrides, field, fragment) => {
    const state = await createProductAction(undefined, productForm(overrides));
    expect(state?.fieldErrors?.[field]?.[0]).toContain(fragment);
    expect(state?.values).toMatchObject(overrides);
    expect((await listProducts()).total).toBe(0);
    expect(revalidatedPaths).toEqual([]);
  });

  it("criar com vários campos inválidos devolve todos os erros de uma vez", async () => {
    const state = await createProductAction(undefined, productForm({ reference: "", description: "", price: "x" }));
    expect(Object.keys(state?.fieldErrors ?? {}).sort()).toEqual(["description", "price", "reference"]);
  });

  it("criar com referência duplicada (outra caixa) devolve erro no campo", async () => {
    await insertProduct({ reference: "CAM-01" });
    const state = await createProductAction(undefined, productForm({ reference: "cam-01" }));
    expect(state?.fieldErrors?.reference?.[0]).toContain("Já existe um produto com a referência CAM-01");
    expect((await listProducts()).total).toBe(1);
  });

  it("criar com categoria inexistente (UUID válido) devolve erro no campo categoria", async () => {
    const state = await createProductAction(undefined, productForm({ categoryId: MISSING_ID }));
    expect(state?.fieldErrors?.categoryId?.[0]).toContain("não existe");
    expect((await listProducts()).total).toBe(0);
  });

  it("editar: altera os campos, inclusive desativando", async () => {
    const product = await insertProduct({ reference: "A1", priceCents: 1000 });
    await expect(
      updateProductAction(product.id, undefined, productForm({ reference: "a1", price: "1.234,56", active: "" })),
    ).rejects.toMatchObject({ url: "/admin/produtos?status=updated" });

    expect(await getProduct(product.id)).toMatchObject({ reference: "A1", priceCents: 123456, active: false });
  });

  it("editar: rejeita referência de outro produto e produto inexistente", async () => {
    await insertProduct({ reference: "OUTRO" });
    const product = await insertProduct({ reference: "MEU" });

    const dup = await updateProductAction(product.id, undefined, productForm({ reference: "outro" }));
    expect(dup?.fieldErrors?.reference?.[0]).toContain("Já existe");
    expect((await getProduct(product.id))?.reference).toBe("MEU");

    const missing = await updateProductAction(MISSING_ID, undefined, productForm());
    expect(missing?.error).toBe("Produto não encontrado");
  });

  describe("imagem do produto (URL do Google Drive)", () => {
    const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    const DIRECT = `https://lh3.googleusercontent.com/d/${FILE_ID}`;
    const SHARE_LINK = `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`;

    it("criar: converte o link de compartilhamento do Drive no endereço direto da imagem", async () => {
      await expect(
        createProductAction(undefined, productForm({ imageUrl: SHARE_LINK })),
      ).rejects.toMatchObject({ url: "/admin/produtos?status=created" });
      expect((await listProducts()).items[0].imageUrl).toBe(DIRECT);
    });

    it("criar sem imagem (campo vazio ou ausente) é permitido e grava nulo", async () => {
      await expect(createProductAction(undefined, productForm({ imageUrl: "" }))).rejects.toBeInstanceOf(RedirectError);
      await expect(createProductAction(undefined, productForm({ reference: "SEM-CAMPO" }))).rejects.toBeInstanceOf(RedirectError);
      expect((await listProducts()).items.map((p) => p.imageUrl)).toEqual([null, null]);
    });

    it.each([
      ["http (conteúdo misto)", "http://exemplo.com/a.jpg", "https://"],
      ["script", "javascript:alert(1)", "https://"],
      ["texto que não é endereço", "foto da camiseta", "inválido"],
      ["pasta do Drive", "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz", "pasta"],
      ["documento do Google", `https://docs.google.com/document/d/${FILE_ID}/edit`, "Drive"],
    ])("criar com %s: erro no campo da imagem, mantém o digitado e não grava", async (_label, imageUrl, fragment) => {
      const state = await createProductAction(undefined, productForm({ imageUrl }));
      expect(state?.fieldErrors?.imageUrl?.[0]).toContain(fragment);
      expect(Object.keys(state?.fieldErrors ?? {})).toEqual(["imageUrl"]); // só a imagem está errada
      expect(state?.values?.imageUrl).toBe(imageUrl);
      expect((await listProducts()).total).toBe(0);
      expect(revalidatedPaths).toEqual([]);
    });

    it("editar: troca a imagem e, com o campo vazio, remove", async () => {
      const product = await insertProduct({ reference: "A1", imageUrl: DIRECT });

      await expect(
        updateProductAction(product.id, undefined, productForm({ reference: "a1", imageUrl: `https://drive.google.com/open?id=2ZyXwVuTsRqPoNmLkJiHgFeDcBa987654` })),
      ).rejects.toMatchObject({ url: "/admin/produtos?status=updated" });
      expect((await getProduct(product.id))?.imageUrl).toBe("https://lh3.googleusercontent.com/d/2ZyXwVuTsRqPoNmLkJiHgFeDcBa987654");

      await expect(
        updateProductAction(product.id, undefined, productForm({ reference: "a1", imageUrl: "" })),
      ).rejects.toBeInstanceOf(RedirectError);
      expect((await getProduct(product.id))?.imageUrl).toBeNull();
    });

    it("editar com imagem inválida não altera o produto", async () => {
      const product = await insertProduct({ reference: "A1", imageUrl: DIRECT });
      const state = await updateProductAction(product.id, undefined, productForm({ reference: "a1", imageUrl: "http://x.com/a.jpg" }));
      expect(state?.fieldErrors?.imageUrl?.[0]).toContain("https://");
      expect((await getProduct(product.id))?.imageUrl).toBe(DIRECT);
    });

    it("a imagem só pode ser cadastrada por ADMIN (a permissão é conferida antes de qualquer validação)", async () => {
      cookieJar.clear();
      await loginAs("CONSULTOR");
      await expect(createProductAction(undefined, productForm({ imageUrl: SHARE_LINK }))).rejects.toBeInstanceOf(ForbiddenError);
      expect((await listProducts()).total).toBe(0);
    });
  });

  it("excluir: remove o produto e revalida a lista", async () => {
    const product = await insertProduct({ reference: "DEL" });
    expect(await deleteProductAction(product.id, undefined)).toBeUndefined();
    expect(await getProduct(product.id)).toBeNull();
    expect(revalidatedPaths).toEqual(["/admin/produtos"]);
  });

  it("excluir: id inexistente ou malformado devolve erro (sem lançar)", async () => {
    expect((await deleteProductAction(MISSING_ID, undefined))?.error).toBe("Produto não encontrado");
    expect((await deleteProductAction("xyz", undefined))?.error).toBe("Produto não encontrado");
  });

  it("segurança: tentativa de injeção SQL na referência/descrição é tratada como texto", async () => {
    const evil = "x'); DROP TABLE products;--";
    await expect(
      createProductAction(undefined, productForm({ reference: "INJ-1", description: evil })),
    ).rejects.toBeInstanceOf(RedirectError);
    expect((await listProducts()).items[0].description).toBe(evil);
    expect((await listProducts({ search: "DROP TABLE" })).total).toBe(1);
  });
});
