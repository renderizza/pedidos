import { eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { orderDraftItems, orderDrafts, orders, products, users } from "@/db/schema";
import {
  addToDraft,
  clearDraft,
  DraftLimitError,
  DraftProductUnavailableError,
  getDraft,
  saveDraft,
} from "@/lib/orders/draft";
import { listOrderableProducts } from "@/lib/products/service";
import { insertCategory, insertProduct } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

let userId: string;
let otherUserId: string;

async function simplified(id: string) {
  const { lines } = await getDraft(id);
  return lines.map((line) => [line.reference, line.quantity]);
}

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUserWithSession("CONSULTOR")).user.id;
  otherUserId = (await createUserWithSession("CLIENTE")).user.id;
});

afterAll(async () => {
  await closeDb();
});

describe("saveDraft / getDraft (persistência do rascunho)", () => {
  it("sem rascunho, getDraft devolve vazio", async () => {
    expect(await getDraft(userId)).toEqual({ lines: [], unavailableCount: 0 });
  });

  it("grava as linhas e devolve na mesma ordem, com dados e preço do cadastro", async () => {
    const roupas = await insertCategory("Roupas");
    const a = await insertProduct({ reference: "A", description: "Produto A", priceCents: 1990, categoryId: roupas.id });
    const b = await insertProduct({ reference: "B", description: "Produto B", priceCents: 735 });
    const c = await insertProduct({ reference: "C", priceCents: 100 });

    // ordem de montagem ≠ ordem alfabética
    await saveDraft(userId, [
      { productId: c.id, quantity: 4 },
      { productId: a.id, quantity: 3 },
      { productId: b.id, quantity: 12 },
    ]);

    const { lines } = await getDraft(userId);
    expect(lines.map((l) => [l.reference, l.quantity])).toEqual([["C", 4], ["A", 3], ["B", 12]]);
    expect(lines[1]).toMatchObject({
      productId: a.id,
      description: "Produto A",
      priceCents: 1990,
      categoryName: "Roupas",
    });
    expect(lines[0].categoryName).toBeNull();
  });

  it("salvar de novo SUBSTITUI o rascunho inteiro (remove, altera e reordena)", async () => {
    const a = await insertProduct({ reference: "A" });
    const b = await insertProduct({ reference: "B" });
    const c = await insertProduct({ reference: "C" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 2 }]);

    await saveDraft(userId, [{ productId: c.id, quantity: 5 }, { productId: b.id, quantity: 9 }]);

    expect(await simplified(userId)).toEqual([["C", 5], ["B", 9]]);
    expect(await getDb().select().from(orderDrafts)).toHaveLength(1);
  });

  it("os dados sobrevivem a uma nova conexão (estão no banco, não em memória)", async () => {
    const a = await insertProduct({ reference: "PERSIST" });
    await saveDraft(userId, [{ productId: a.id, quantity: 7 }]);

    await closeDb(); // descarta o pool; a próxima consulta abre outro
    expect(await simplified(userId)).toEqual([["PERSIST", 7]]);
  });

  it("lista vazia apaga o rascunho (linhas e cabeçalho)", async () => {
    const a = await insertProduct({ reference: "A" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }]);
    await saveDraft(userId, []);
    expect(await getDraft(userId)).toEqual({ lines: [], unavailableCount: 0 });
    expect(await getDb().select().from(orderDrafts)).toHaveLength(0);
    expect(await getDb().select().from(orderDraftItems)).toHaveLength(0);
  });

  it("cada usuário tem o seu rascunho, isolado dos demais", async () => {
    const a = await insertProduct({ reference: "A" });
    const b = await insertProduct({ reference: "B" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }]);
    await saveDraft(otherUserId, [{ productId: b.id, quantity: 2 }]);

    expect(await simplified(userId)).toEqual([["A", 1]]);
    expect(await simplified(otherUserId)).toEqual([["B", 2]]);

    await saveDraft(userId, []);
    expect(await simplified(otherUserId)).toEqual([["B", 2]]); // o outro continua intacto
  });

  it("não guarda preço: mudar o preço do produto muda o valor mostrado no rascunho", async () => {
    const a = await insertProduct({ reference: "A", priceCents: 1000 });
    await saveDraft(userId, [{ productId: a.id, quantity: 2 }]);
    expect((await getDraft(userId)).lines[0].priceCents).toBe(1000);

    await getDb().update(products).set({ priceCents: 2500 }).where(eq(products.id, a.id));
    expect((await getDraft(userId)).lines[0].priceCents).toBe(2500);
  });

  it("não cria pedido: rascunho não é histórico", async () => {
    const a = await insertProduct({ reference: "A" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }]);
    expect(await getDb().select().from(orders)).toHaveLength(0);
  });

  describe("validação (nada é alterado quando a gravação é recusada)", () => {
    let a: { id: string };
    beforeEach(async () => {
      a = await insertProduct({ reference: "A" });
      await saveDraft(userId, [{ productId: a.id, quantity: 3 }]);
    });

    it.each([
      ["quantidade zero", (id: string) => [{ productId: id, quantity: 0 }]],
      ["quantidade 10000", (id: string) => [{ productId: id, quantity: 10_000 }]],
      ["quantidade decimal", (id: string) => [{ productId: id, quantity: 1.5 }]],
      ["produto repetido", (id: string) => [{ productId: id, quantity: 1 }, { productId: id, quantity: 2 }]],
      ["productId inválido", () => [{ productId: "xyz", quantity: 1 }]],
    ])("%s → ZodError", async (_label, build) => {
      await expect(saveDraft(userId, build(a.id))).rejects.toBeInstanceOf(ZodError);
      expect(await simplified(userId)).toEqual([["A", 3]]);
    });

    it("não aceita algo que não seja lista", async () => {
      await expect(saveDraft(userId, "x")).rejects.toBeInstanceOf(ZodError);
      await expect(saveDraft(userId, { productId: a.id })).rejects.toBeInstanceOf(ZodError);
    });

    it("produto inexistente → DraftProductUnavailableError com o id", async () => {
      const error = await saveDraft(userId, [{ productId: a.id, quantity: 1 }, { productId: MISSING_ID, quantity: 1 }]).catch((e) => e);
      expect(error).toBeInstanceOf(DraftProductUnavailableError);
      expect(error.productIds).toEqual([MISSING_ID]);
      expect(await simplified(userId)).toEqual([["A", 3]]);
    });

    it("produto desativado → DraftProductUnavailableError", async () => {
      const off = await insertProduct({ reference: "OFF", active: false });
      await expect(saveDraft(userId, [{ productId: off.id, quantity: 1 }])).rejects.toBeInstanceOf(
        DraftProductUnavailableError,
      );
      expect(await simplified(userId)).toEqual([["A", 3]]);
    });

    it("mais de 200 linhas → ZodError", async () => {
      const many = Array.from({ length: 201 }, (_, i) => ({
        productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        quantity: 1,
      }));
      await expect(saveDraft(userId, many)).rejects.toBeInstanceOf(ZodError);
    });
  });

  it("aceita exatamente 200 linhas", async () => {
    const created = [];
    for (let i = 0; i < 200; i++) created.push(await insertProduct({ reference: `L${String(i).padStart(3, "0")}` }));
    await saveDraft(userId, created.map((p) => ({ productId: p.id, quantity: 1 })));
    expect((await getDraft(userId)).lines).toHaveLength(200);
  });
});

describe("produtos que mudam depois de entrar no rascunho", () => {
  it("produto desativado sai das linhas e é contado como indisponível (sem apagar nada)", async () => {
    const a = await insertProduct({ reference: "A" });
    const b = await insertProduct({ reference: "B" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 2 }]);

    await getDb().update(products).set({ active: false }).where(eq(products.id, a.id));

    const view = await getDraft(userId);
    expect(view.lines.map((l) => l.reference)).toEqual(["B"]);
    expect(view.unavailableCount).toBe(1);
    expect(await getDb().select().from(orderDraftItems)).toHaveLength(2); // leitura não altera o banco
  });

  it("produto reativado volta ao rascunho", async () => {
    const a = await insertProduct({ reference: "A" });
    await saveDraft(userId, [{ productId: a.id, quantity: 4 }]);
    await getDb().update(products).set({ active: false }).where(eq(products.id, a.id));
    await getDb().update(products).set({ active: true }).where(eq(products.id, a.id));
    expect(await simplified(userId)).toEqual([["A", 4]]);
  });

  it("excluir o produto remove a linha do rascunho (cascade)", async () => {
    const a = await insertProduct({ reference: "A" });
    const b = await insertProduct({ reference: "B" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }]);
    await getDb().delete(products).where(eq(products.id, a.id));
    expect(await simplified(userId)).toEqual([["B", 1]]);
  });

  it("excluir o usuário remove o rascunho dele (cascade)", async () => {
    const a = await insertProduct({ reference: "A" });
    await saveDraft(otherUserId, [{ productId: a.id, quantity: 1 }]);
    await getDb().delete(users).where(eq(users.id, otherUserId));
    expect(await getDb().select().from(orderDrafts)).toHaveLength(0);
    expect(await getDb().select().from(orderDraftItems)).toHaveLength(0);
  });
});

describe("addToDraft (botão 'Adicionar ao pedido' da vitrine)", () => {
  it("cria a linha com quantidade 1 e soma 1 a cada chamada", async () => {
    const a = await insertProduct({ reference: "A" });
    expect(await addToDraft(userId, a.id)).toEqual({ quantity: 1 });
    expect(await addToDraft(userId, a.id)).toEqual({ quantity: 2 });
    expect(await addToDraft(userId, a.id)).toEqual({ quantity: 3 });
    expect(await simplified(userId)).toEqual([["A", 3]]);
  });

  it("novos produtos entram no fim da tabela", async () => {
    const a = await insertProduct({ reference: "A" });
    const b = await insertProduct({ reference: "B" });
    const c = await insertProduct({ reference: "C" });
    await saveDraft(userId, [{ productId: c.id, quantity: 2 }]);
    await addToDraft(userId, a.id);
    await addToDraft(userId, b.id);
    await addToDraft(userId, c.id);
    expect(await simplified(userId)).toEqual([["C", 3], ["A", 1], ["B", 1]]);
  });

  it("não mexe no rascunho de outro usuário", async () => {
    const a = await insertProduct({ reference: "A" });
    await addToDraft(userId, a.id);
    expect(await simplified(otherUserId)).toEqual([]);
  });

  it("para na quantidade máxima (9999)", async () => {
    const a = await insertProduct({ reference: "A" });
    await saveDraft(userId, [{ productId: a.id, quantity: 9999 }]);
    await expect(addToDraft(userId, a.id)).rejects.toBeInstanceOf(DraftLimitError);
    expect(await simplified(userId)).toEqual([["A", 9999]]);
  });

  it("para no máximo de 200 produtos distintos", async () => {
    const created = [];
    for (let i = 0; i < 200; i++) created.push(await insertProduct({ reference: `M${String(i).padStart(3, "0")}` }));
    await saveDraft(userId, created.map((p) => ({ productId: p.id, quantity: 1 })));
    const extra = await insertProduct({ reference: "EXTRA" });
    await expect(addToDraft(userId, extra.id)).rejects.toBeInstanceOf(DraftLimitError);
    // mas somar a um produto que já está no pedido continua permitido
    await expect(addToDraft(userId, created[0].id)).resolves.toEqual({ quantity: 2 });
  });

  it("recusa produto inexistente, desativado ou id malformado", async () => {
    const off = await insertProduct({ reference: "OFF", active: false });
    for (const id of [MISSING_ID, off.id, "xyz", ""]) {
      await expect(addToDraft(userId, id)).rejects.toBeInstanceOf(DraftProductUnavailableError);
    }
    expect(await getDb().select().from(orderDrafts)).toHaveLength(0);
  });

  it("cliques simultâneos não perdem contagem (15 chamadas paralelas = 15 unidades)", async () => {
    const a = await insertProduct({ reference: "A" });
    await Promise.all(Array.from({ length: 15 }, () => addToDraft(userId, a.id)));
    expect(await simplified(userId)).toEqual([["A", 15]]);
  });
});

describe("concorrência no salvamento", () => {
  it("dois salvamentos simultâneos nunca se misturam: sobra uma das listas inteira", async () => {
    const [a, b, c] = await Promise.all(["A", "B", "C"].map((reference) => insertProduct({ reference })));
    const listOne = [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 2 }];
    const listTwo = [{ productId: c.id, quantity: 3 }];

    const results = await Promise.allSettled([saveDraft(userId, listOne), saveDraft(userId, listTwo)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const final = JSON.stringify(await simplified(userId));
    expect([JSON.stringify([["A", 1], ["B", 2]]), JSON.stringify([["C", 3]])]).toContain(final);
  });

  it("muitos salvamentos paralelos do mesmo usuário terminam sem erro e sem linhas duplicadas", async () => {
    const [a, b] = await Promise.all(["A", "B"].map((reference) => insertProduct({ reference })));
    const attempts = Array.from({ length: 12 }, (_, i) =>
      saveDraft(userId, [{ productId: a.id, quantity: i + 1 }, { productId: b.id, quantity: 1 }]),
    );
    await expect(Promise.all(attempts)).resolves.toBeDefined();
    const items = await getDb().select().from(orderDraftItems).where(eq(orderDraftItems.userId, userId));
    expect(items).toHaveLength(2);
    expect(await getDb().select().from(orderDrafts)).toHaveLength(1);
  });
});

describe("regras no próprio banco (última linha de defesa)", () => {
  async function rawInsert(quantity: number, productId: string, position = 0) {
    await getDb().execute(
      sql`insert into order_drafts (user_id) values (${userId}) on conflict do nothing`,
    );
    return getDb().insert(orderDraftItems).values({ userId, productId, quantity, position });
  }

  it("quantidade fora de 1–9999 é recusada pelo CHECK", async () => {
    const a = await insertProduct({ reference: "A" });
    await expect(rawInsert(0, a.id)).rejects.toThrow();
    await expect(rawInsert(10_000, a.id)).rejects.toThrow();
    await expect(rawInsert(9999, a.id)).resolves.toBeDefined();
  });

  it("o mesmo produto não pode aparecer duas vezes no rascunho do usuário", async () => {
    const a = await insertProduct({ reference: "A" });
    await rawInsert(1, a.id, 0);
    await expect(rawInsert(2, a.id, 1)).rejects.toThrow();
  });
});

describe("clearDraft", () => {
  it("apaga o rascunho do usuário e só o dele", async () => {
    const a = await insertProduct({ reference: "A" });
    await saveDraft(userId, [{ productId: a.id, quantity: 1 }]);
    await saveDraft(otherUserId, [{ productId: a.id, quantity: 1 }]);
    await clearDraft(userId);
    expect(await simplified(userId)).toEqual([]);
    expect(await simplified(otherUserId)).toEqual([["A", 1]]);
  });

  it("é idempotente quando não há rascunho", async () => {
    await expect(clearDraft(userId)).resolves.toBeUndefined();
  });
});

describe("listOrderableProducts", () => {
  it("lista só produtos ativos, por referência, com a categoria", async () => {
    const bebidas = await insertCategory("Bebidas");
    await insertProduct({ reference: "B-02", description: "Suco", priceCents: 735, categoryId: bebidas.id });
    await insertProduct({ reference: "A-01", description: "Camiseta", priceCents: 1990 });
    await insertProduct({ reference: "Z-99", active: false });

    const list = await listOrderableProducts();
    expect(list.map((p) => p.reference)).toEqual(["A-01", "B-02"]);
    expect(list[1]).toMatchObject({ description: "Suco", priceCents: 735, categoryName: "Bebidas" });
    expect(list[0].categoryName).toBeNull();
  });
});
