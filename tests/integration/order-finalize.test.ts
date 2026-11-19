import { eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getPool } from "@/db";
import { orderDraftItems, orderDrafts, orderItems, orders, products } from "@/db/schema";
import { getDraft, saveDraft } from "@/lib/orders/draft";
import {
  EmptyDraftError,
  finalizeDraft,
  OrderPriceChangedError,
  OrderProductUnavailableError,
  OrderTotalTooLargeError,
} from "@/lib/orders/finalize";
import { insertProduct, placeOrder } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";

let userId: string;
let otherUserId: string;

const customer = { customerName: "João da Loja", customerPhone: "(11) 98888-7777", notes: "Entregar cedo" };
const allOrders = () => getDb().select().from(orders);
const allItems = () => getDb().select().from(orderItems);
const draftCount = async () => (await getDb().select().from(orderDrafts)).length;

async function fixtures() {
  const camiseta = await insertProduct({ reference: "CAM-01", description: "Camiseta azul", priceCents: 1990 });
  const suco = await insertProduct({ reference: "SUC-01", description: "Suco de uva", priceCents: 735 });
  return { camiseta, suco };
}

beforeEach(async () => {
  await resetDatabase();
  userId = (await createUserWithSession("CONSULTOR")).user.id;
  otherUserId = (await createUserWithSession("CLIENTE")).user.id;
});

afterAll(async () => {
  await closeDb();
});

describe("finalizeDraft — persistência final do pedido", () => {
  it("grava o pedido com cliente, total e itens (snapshot) e apaga o rascunho", async () => {
    const { camiseta, suco } = await fixtures();
    await saveDraft(userId, [
      { productId: suco.id, quantity: 12 },
      { productId: camiseta.id, quantity: 3 },
    ]);

    const result = await finalizeDraft(userId, { ...customer, expectedTotalCents: 14790 });

    expect(result).toMatchObject({ totalCents: 14790, orderNumber: 1 });
    const [order] = await allOrders();
    expect(order).toMatchObject({
      id: result.orderId,
      userId,
      customerName: "João da Loja",
      customerPhone: "11988887777", // só dígitos
      notes: "Entregar cedo",
      status: "PENDENTE",
      totalCents: 14790,
    });

    const items = await getDb().select().from(orderItems).orderBy(orderItems.position);
    expect(items.map((i) => [i.reference, i.description, i.unitPriceCents, i.quantity, i.lineTotalCents, i.position])).toEqual([
      ["SUC-01", "Suco de uva", 735, 12, 8820, 0], // ordem de montagem preservada
      ["CAM-01", "Camiseta azul", 1990, 3, 5970, 1],
    ]);
    expect(items.every((i) => i.orderId === order.id)).toBe(true);

    // o rascunho foi consumido
    expect(await getDraft(userId)).toEqual({ lines: [], unavailableCount: 0 });
    expect(await draftCount()).toBe(0);
    expect(await getDb().select().from(orderDraftItems)).toHaveLength(0);
  });

  it("telefone e observações opcionais ficam nulos", async () => {
    const { camiseta } = await fixtures();
    await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }]);
    await finalizeDraft(userId, { customerName: "Maria", customerPhone: "", notes: "", expectedTotalCents: 1990 });
    const [order] = await allOrders();
    expect(order.customerPhone).toBeNull();
    expect(order.notes).toBeNull();
  });

  it("o pedido pertence a quem finalizou (posse), e cada pedido recebe um número sequencial", async () => {
    const { camiseta } = await fixtures();
    const first = await placeOrder(userId, [{ productId: camiseta.id, priceCents: 1990, quantity: 1 }]);
    const second = await placeOrder(otherUserId, [{ productId: camiseta.id, priceCents: 1990, quantity: 2 }]);
    expect(second.orderNumber).toBe(first.orderNumber + 1);

    const rows = await getDb().select().from(orders).orderBy(orders.orderNumber);
    expect(rows.map((o) => o.userId)).toEqual([userId, otherUserId]);
  });

  it("cada usuário finaliza o seu rascunho sem tocar no dos outros", async () => {
    const { camiseta, suco } = await fixtures();
    await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }]);
    await saveDraft(otherUserId, [{ productId: suco.id, quantity: 4 }]);

    await finalizeDraft(userId, { customerName: "Maria", customerPhone: "", notes: "", expectedTotalCents: 1990 });

    expect((await getDraft(otherUserId)).lines.map((l) => [l.reference, l.quantity])).toEqual([["SUC-01", 4]]);
    expect(await allOrders()).toHaveLength(1);
  });

  it("depois de finalizar, dá para começar um novo rascunho", async () => {
    const { camiseta } = await fixtures();
    await placeOrder(userId, [{ productId: camiseta.id, priceCents: 1990, quantity: 1 }]);
    await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);
    expect((await getDraft(userId)).lines).toHaveLength(1);
    expect(await allOrders()).toHaveLength(1); // o novo rascunho não virou pedido
  });

  describe("o pedido é uma FOTO imutável do momento da finalização", () => {
    it("mudar preço/descrição do produto depois não altera o pedido", async () => {
      const { camiseta } = await fixtures();
      await placeOrder(userId, [{ productId: camiseta.id, priceCents: 1990, quantity: 3 }]);

      await getDb().update(products).set({ priceCents: 9999, description: "Descrição nova", reference: "NOVA-REF" }).where(eq(products.id, camiseta.id));

      const [item] = await allItems();
      expect(item).toMatchObject({ reference: "CAM-01", description: "Camiseta azul", unitPriceCents: 1990, lineTotalCents: 5970 });
      expect((await allOrders())[0].totalCents).toBe(5970);
    });

    it("excluir o produto depois mantém o item (só perde o vínculo)", async () => {
      const { camiseta } = await fixtures();
      await placeOrder(userId, [{ productId: camiseta.id, priceCents: 1990, quantity: 2 }]);
      await getDb().delete(products).where(eq(products.id, camiseta.id));

      const [item] = await allItems();
      expect(item).toMatchObject({ productId: null, reference: "CAM-01", unitPriceCents: 1990, quantity: 2 });
    });
  });

  describe("preço vem SEMPRE do servidor", () => {
    it("usa o preço vigente do cadastro no momento de finalizar", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);
      await getDb().update(products).set({ priceCents: 2000 }).where(eq(products.id, camiseta.id));

      // o cliente viu 2 × 19,90 = 39,80, mas o preço mudou para 20,00: recusa em vez de gravar valor diferente
      const error = await finalizeDraft(userId, { ...customer, expectedTotalCents: 3980 }).catch((e) => e);
      expect(error).toBeInstanceOf(OrderPriceChangedError);
      expect(error.actualTotalCents).toBe(4000);
      expect(await allOrders()).toHaveLength(0);
      expect(await draftCount()).toBe(1); // rascunho intacto: o usuário pode revisar e tentar de novo

      // com o total atualizado, grava com o novo preço
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 4000 })).resolves.toMatchObject({ totalCents: 4000 });
      expect((await allItems())[0].unitPriceCents).toBe(2000);
    });

    it("um total 'esperado' forjado não faz o pedido ser gravado com outro valor", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 1 })).rejects.toBeInstanceOf(OrderPriceChangedError);
      expect(await allOrders()).toHaveLength(0);
    });
  });

  describe("recusas (nada é gravado e o rascunho permanece)", () => {
    it.each([
      ["nome do cliente vazio", { customerName: "" }],
      ["nome do cliente só com espaços", { customerName: "   " }],
      ["telefone inválido", { customerPhone: "123" }],
      ["observações longas demais", { notes: "x".repeat(501) }],
      ["total esperado ausente", { expectedTotalCents: undefined }],
      ["total esperado negativo", { expectedTotalCents: -1 }],
    ])("%s → ZodError", async (_label, override) => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }]);
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 1990, ...override })).rejects.toBeInstanceOf(ZodError);
      expect(await allOrders()).toHaveLength(0);
      expect(await draftCount()).toBe(1);
    });

    it("sem rascunho → EmptyDraftError", async () => {
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 0 })).rejects.toBeInstanceOf(EmptyDraftError);
      expect(await allOrders()).toHaveLength(0);
    });

    it("rascunho que ficou sem itens (produtos excluídos) → EmptyDraftError", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }]);
      await getDb().delete(products).where(eq(products.id, camiseta.id));
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 0 })).rejects.toBeInstanceOf(EmptyDraftError);
    });

    it("produto desativado depois de entrar no rascunho → OrderProductUnavailableError", async () => {
      const { camiseta, suco } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }, { productId: suco.id, quantity: 1 }]);
      await getDb().update(products).set({ active: false }).where(eq(products.id, suco.id));

      const error = await finalizeDraft(userId, { ...customer, expectedTotalCents: 2725 }).catch((e) => e);
      expect(error).toBeInstanceOf(OrderProductUnavailableError);
      expect(error.productIds).toEqual([suco.id]);
      expect(await allOrders()).toHaveLength(0);
      expect(await draftCount()).toBe(1);
    });

    it("total acima do limite do banco → OrderTotalTooLargeError", async () => {
      const caro = await insertProduct({ reference: "CARO", priceCents: 100_000_000 });
      await saveDraft(userId, [{ productId: caro.id, quantity: 30 }]); // R$ 30.000.000,00
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 3_000_000_000 })).rejects.toBeInstanceOf(
        OrderTotalTooLargeError,
      );
      expect(await allOrders()).toHaveLength(0);
    });
  });

  describe("atomicidade e concorrência", () => {
    it("se a gravação falhar no meio, NADA é gravado e o rascunho continua lá (rollback)", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);

      // Força um erro DEPOIS de o pedido ter sido inserido: trigger que recusa itens de pedido.
      const db = getDb();
      await db.execute(sql`create or replace function fail_item_insert() returns trigger as $$ begin raise exception 'falha simulada'; end; $$ language plpgsql`);
      await db.execute(sql`create trigger fail_item_insert before insert on order_items for each row execute function fail_item_insert()`);
      try {
        await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 3980 })).rejects.toThrow();
      } finally {
        await db.execute(sql`drop trigger if exists fail_item_insert on order_items`);
        await db.execute(sql`drop function if exists fail_item_insert()`);
      }

      expect(await allOrders()).toHaveLength(0); // o INSERT em `orders` foi desfeito
      expect(await allItems()).toHaveLength(0);
      expect((await getDraft(userId)).lines.map((l) => [l.reference, l.quantity])).toEqual([["CAM-01", 2]]);

      // e o mesmo rascunho ainda pode ser finalizado normalmente depois
      await expect(finalizeDraft(userId, { ...customer, expectedTotalCents: 3980 })).resolves.toMatchObject({ totalCents: 3980 });
    });

    it("a finalização ESPERA quem já está com o rascunho travado (FOR UPDATE) — prova determinística da trava", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);

      const holder = await getPool().connect();
      try {
        // "Outra aba" segura o rascunho no meio de uma finalização dela.
        await holder.query("begin");
        await holder.query("select 1 from order_drafts where user_id = $1 for update", [userId]);

        let settled = false;
        const pending = finalizeDraft(userId, { ...customer, expectedTotalCents: 3980 }).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false); // sem a trava, ela teria terminado (e gravado um pedido duplicado)

        // A outra aba consome o rascunho e confirma: a nossa passa a ver o rascunho já vazio.
        await holder.query("delete from order_drafts where user_id = $1", [userId]);
        await holder.query("commit");
        await expect(pending).rejects.toBeInstanceOf(EmptyDraftError);
        expect(await allOrders()).toHaveLength(0);
      } finally {
        holder.release();
      }
    });

    it("se quem segurava a trava desiste (rollback), a finalização espera e então conclui normalmente", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);

      const holder = await getPool().connect();
      try {
        await holder.query("begin");
        await holder.query("select 1 from order_drafts where user_id = $1 for update", [userId]);
        let settled = false;
        const pending = finalizeDraft(userId, { ...customer, expectedTotalCents: 3980 }).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false);

        await holder.query("rollback");
        await expect(pending).resolves.toMatchObject({ totalCents: 3980 });
        expect(await allOrders()).toHaveLength(1);
      } finally {
        holder.release();
      }
    });

    it("finalizações simultâneas do mesmo rascunho geram UM pedido só (clique duplo / duas abas)", async () => {
      const { camiseta, suco } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 3 }, { productId: suco.id, quantity: 12 }]);
      // Abre várias conexões ANTES: sem isso, a 1ª transação termina antes de as outras
      // conseguirem conexão e a "concorrência" do teste não existe de verdade.
      await Promise.all(Array.from({ length: 8 }, () => getPool().query("select pg_sleep(0.1)")));

      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () => finalizeDraft(userId, { ...customer, expectedTotalCents: 14790 })),
      );

      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === "rejected");
      expect(rejected).toHaveLength(5);
      expect(rejected.every((r) => r.reason instanceof EmptyDraftError)).toBe(true);

      expect(await allOrders()).toHaveLength(1);
      expect(await allItems()).toHaveLength(2); // itens não duplicados
    });

    it("usuários diferentes finalizam ao mesmo tempo sem interferência", async () => {
      const { camiseta } = await fixtures();
      await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }]);
      await saveDraft(otherUserId, [{ productId: camiseta.id, quantity: 2 }]);

      const [a, b] = await Promise.all([
        finalizeDraft(userId, { ...customer, expectedTotalCents: 1990 }),
        finalizeDraft(otherUserId, { ...customer, expectedTotalCents: 3980 }),
      ]);

      expect(a.orderNumber).not.toBe(b.orderNumber);
      const rows = await getDb().select().from(orders);
      expect(rows.map((o) => [o.userId, o.totalCents]).sort()).toEqual(
        [[userId, 1990], [otherUserId, 3980]].sort(),
      );
    });
  });
});

describe("finalizeDraft — pedido interno (sem dados de cliente)", () => {
  it("withCustomer: false grava o pedido sem cliente e descarta qualquer dado de cliente recebido", async () => {
    const { camiseta } = await fixtures();
    await saveDraft(userId, [{ productId: camiseta.id, quantity: 2 }]);

    const result = await finalizeDraft(userId, { ...customer, expectedTotalCents: 3980 }, { withCustomer: false });

    expect(result).toMatchObject({ totalCents: 3980, orderNumber: 1 });
    expect((await allOrders())[0]).toMatchObject({
      userId,
      customerName: null,
      customerPhone: null,
      notes: null,
      totalCents: 3980,
    });
    expect((await allItems())[0]).toMatchObject({ reference: "CAM-01", unitPriceCents: 1990, quantity: 2, lineTotalCents: 3980 });
    expect(await draftCount()).toBe(0);
  });

  it("por padrão (withCustomer omitido) o nome do cliente continua obrigatório", async () => {
    const { camiseta } = await fixtures();
    await saveDraft(userId, [{ productId: camiseta.id, quantity: 1 }]);
    await expect(finalizeDraft(userId, { customerName: "", expectedTotalCents: 1990 })).rejects.toBeInstanceOf(ZodError);
    expect(await allOrders()).toHaveLength(0);
  });
});
