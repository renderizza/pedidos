import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { orders, products } from "@/db/schema";
import { canAccessOrder } from "@/lib/auth/rbac";
import type { UserRole } from "@/lib/auth/roles";
import { countAllOrders, getOrderFor, listOrdersFor, type Actor } from "@/lib/orders/history";
import { buildWhatsAppUrl, formatOrderMessage } from "@/lib/whatsapp";
import { insertProduct, placeOrder } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Who = { actor: Actor; name: string };
let admin: Who;
let consultorA: Who;
let consultorB: Who;
let cliente: Who;
let semPedidos: Who;
let camiseta: { id: string };
let suco: { id: string };

async function newUser(role: UserRole): Promise<Who> {
  const { user } = await createUserWithSession(role);
  return { actor: { id: user.id, role }, name: user.name };
}

const line = (product: { id: string }, priceCents: number, quantity: number) => ({ productId: product.id, priceCents, quantity });
const numbersOf = async (who: Who, params = {}) =>
  (await listOrdersFor(who.actor, { pageSize: 100, ...params })).items.map((o) => o.customerName);

beforeEach(async () => {
  await resetDatabase();
  [admin, consultorA, consultorB, cliente, semPedidos] = await Promise.all([
    newUser("ADMIN"),
    newUser("CONSULTOR"),
    newUser("CONSULTOR"),
    newUser("CLIENTE"),
    newUser("CONSULTOR"),
  ]);
  camiseta = await insertProduct({ reference: "CAM-01", description: "Camiseta azul", priceCents: 1990 });
  suco = await insertProduct({ reference: "SUC-01", description: "Suco de uva", priceCents: 735 });

  // sequência de criação = ordem cronológica
  await placeOrder(consultorA.actor.id, [line(camiseta, 1990, 1)], { customerName: "A1 Padaria" });
  await placeOrder(consultorA.actor.id, [line(camiseta, 1990, 3), line(suco, 735, 12)], { customerName: "A2 Mercado" });
  await placeOrder(consultorB.actor.id, [line(suco, 735, 2)], { customerName: "B1 Bar" });
  await placeOrder(cliente.actor.id, [line(camiseta, 1990, 2)], { customerName: "C1 Cliente" });
});

afterAll(async () => {
  await closeDb();
});

describe("visibilidade da lista por perfil", () => {
  it("ADMIN vê TODOS os pedidos do sistema (mais recentes primeiro)", async () => {
    expect(await numbersOf(admin)).toEqual(["C1 Cliente", "B1 Bar", "A2 Mercado", "A1 Padaria"]);
  });

  it("CONSULTOR vê apenas os SEUS pedidos", async () => {
    expect(await numbersOf(consultorA)).toEqual(["A2 Mercado", "A1 Padaria"]);
    expect(await numbersOf(consultorB)).toEqual(["B1 Bar"]);
  });

  it("CLIENTE vê apenas os próprios; quem não tem pedidos vê lista vazia", async () => {
    expect(await numbersOf(cliente)).toEqual(["C1 Cliente"]);
    expect(await numbersOf(semPedidos)).toEqual([]);
    expect((await listOrdersFor(semPedidos.actor)).total).toBe(0);
  });

  it("o total e a paginação também respeitam a visibilidade", async () => {
    expect((await listOrdersFor(admin.actor)).total).toBe(4);
    expect((await listOrdersFor(consultorA.actor)).total).toBe(2);
    expect((await listOrdersFor(consultorB.actor)).total).toBe(1);
    expect((await listOrdersFor(consultorA.actor, { pageSize: 1 })).totalPages).toBe(2);
  });

  it("a busca NÃO fura a visibilidade: consultor não encontra pedidos de outros por nome nem por número", async () => {
    expect(await numbersOf(consultorA, { search: "Bar" })).toEqual([]);
    expect(await numbersOf(consultorA, { search: "Cliente" })).toEqual([]);
    const [bar] = (await listOrdersFor(admin.actor, { search: "Bar" })).items;
    expect(await numbersOf(consultorA, { search: String(bar.orderNumber) })).toEqual([]);
    expect(await numbersOf(admin, { search: "Bar" })).toEqual(["B1 Bar"]);
  });

  it("a regra de SQL da lista é idêntica a canAccessOrder (fonte única da regra de posse)", async () => {
    const everything = await getDb().select().from(orders);
    for (const who of [admin, consultorA, consultorB, cliente, semPedidos]) {
      const viaSql = (await listOrdersFor(who.actor, { pageSize: 100 })).items.map((o) => o.id).sort();
      const viaRule = everything.filter((o) => canAccessOrder(who.actor, o)).map((o) => o.id).sort();
      expect(viaSql).toEqual(viaRule);
    }
  });

  it("papel sem nenhuma permissão de leitura não vê nada", async () => {
    const result = await listOrdersFor({ id: consultorA.actor.id, role: "NINGUEM" as unknown as UserRole });
    expect(result.items).toEqual([]);
  });
});

describe("listOrdersFor — conteúdo, busca, filtros e paginação", () => {
  it("traz resumo com solicitante, contagem de produtos e de unidades", async () => {
    const [order] = (await listOrdersFor(admin.actor, { search: "A2" })).items;
    expect(order).toMatchObject({
      customerName: "A2 Mercado",
      status: "PENDENTE",
      totalCents: 14790,
      requesterName: consultorA.name,
      lineCount: 2,
      unitCount: 15,
    });
    expect(order.createdAt).toBeInstanceOf(Date);
  });

  it("busca por trecho do nome, sem diferenciar maiúsculas", async () => {
    expect(await numbersOf(admin, { search: "mercado" })).toEqual(["A2 Mercado"]);
    expect(await numbersOf(admin, { search: "  PADARIA " })).toEqual(["A1 Padaria"]);
  });

  it("busca por número do pedido (com ou sem #), e número enorme não causa erro", async () => {
    const all = (await listOrdersFor(admin.actor)).items;
    const target = all.find((o) => o.customerName === "B1 Bar")!;
    expect(await numbersOf(admin, { search: String(target.orderNumber) })).toContain("B1 Bar");
    expect(await numbersOf(admin, { search: `#${target.orderNumber}` })).toContain("B1 Bar");
    await expect(listOrdersFor(admin.actor, { search: "99999999999999" })).resolves.toMatchObject({ total: 0 });
  });

  it("trata % e _ da busca como texto literal", async () => {
    expect(await numbersOf(admin, { search: "%" })).toEqual([]);
    expect(await numbersOf(admin, { search: "_" })).toEqual([]);
  });

  it("filtra por situação", async () => {
    const [first] = (await listOrdersFor(admin.actor, { search: "A1" })).items;
    await getDb().update(orders).set({ status: "CONFIRMADO" }).where(eq(orders.id, first.id));
    expect(await numbersOf(admin, { status: "CONFIRMADO" })).toEqual(["A1 Padaria"]);
    expect((await numbersOf(admin, { status: "PENDENTE" })).length).toBe(3);
    expect(await numbersOf(admin, { status: "CANCELADO" })).toEqual([]);
  });

  it("pagina e ajusta páginas fora do intervalo", async () => {
    const page1 = await listOrdersFor(admin.actor, { pageSize: 3, page: 1 });
    expect(page1).toMatchObject({ total: 4, totalPages: 2, page: 1 });
    expect(page1.items.map((o) => o.customerName)).toEqual(["C1 Cliente", "B1 Bar", "A2 Mercado"]);
    const page2 = await listOrdersFor(admin.actor, { pageSize: 3, page: 2 });
    expect(page2.items.map((o) => o.customerName)).toEqual(["A1 Padaria"]);
    expect((await listOrdersFor(admin.actor, { pageSize: 3, page: 99 })).page).toBe(2);
  });

  it("countAllOrders conta todos os pedidos do sistema", async () => {
    expect(await countAllOrders()).toBe(4);
  });
});

describe("getOrderFor — detalhe e controle de acesso", () => {
  async function orderIdOf(customerName: string) {
    return (await listOrdersFor(admin.actor, { search: customerName })).items[0].id;
  }

  it("o dono vê o pedido completo: dados do cliente, solicitante e itens na ordem de montagem", async () => {
    const id = await orderIdOf("A2 Mercado");
    const order = await getOrderFor(consultorA.actor, id);
    expect(order).toMatchObject({
      id,
      customerName: "A2 Mercado",
      customerPhone: null,
      notes: null,
      totalCents: 14790,
      requesterName: consultorA.name,
      userId: consultorA.actor.id,
      lineCount: 2,
      unitCount: 15,
    });
    expect(order!.items.map((i) => [i.reference, i.description, i.unitPriceCents, i.quantity, i.lineTotalCents])).toEqual([
      ["CAM-01", "Camiseta azul", 1990, 3, 5970],
      ["SUC-01", "Suco de uva", 735, 12, 8820],
    ]);
  });

  it("ADMIN vê o pedido de qualquer pessoa", async () => {
    for (const name of ["A1 Padaria", "B1 Bar", "C1 Cliente"]) {
      expect(await getOrderFor(admin.actor, await orderIdOf(name))).not.toBeNull();
    }
  });

  it("CONSULTOR e CLIENTE NÃO acessam pedido de outra pessoa (null, igual a inexistente)", async () => {
    const aId = await orderIdOf("A1 Padaria");
    const bId = await orderIdOf("B1 Bar");
    expect(await getOrderFor(consultorB.actor, aId)).toBeNull();
    expect(await getOrderFor(consultorA.actor, bId)).toBeNull();
    expect(await getOrderFor(cliente.actor, aId)).toBeNull();
    expect(await getOrderFor(semPedidos.actor, aId)).toBeNull();
  });

  it("id inexistente ou malformado devolve null (sem erro de cast)", async () => {
    expect(await getOrderFor(admin.actor, MISSING_ID)).toBeNull();
    expect(await getOrderFor(admin.actor, "xyz")).toBeNull();
    expect(await getOrderFor(admin.actor, "")).toBeNull();
  });

  it("guarda telefone e observações do pedido", async () => {
    await placeOrder(consultorA.actor.id, [line(camiseta, 1990, 1)], {
      customerName: "Com Telefone",
      customerPhone: "(11) 98888-7777",
      notes: "Linha 1\nLinha 2",
    });
    const order = await getOrderFor(consultorA.actor, await orderIdOf("Com Telefone"));
    expect(order).toMatchObject({ customerPhone: "11988887777", notes: "Linha 1\nLinha 2" });
  });

  it("o histórico não muda quando o catálogo muda (preço, descrição e produto excluído)", async () => {
    const id = await orderIdOf("A2 Mercado");
    await getDb().update(products).set({ priceCents: 5, description: "Mudou" }).where(eq(products.id, camiseta.id));
    await getDb().delete(products).where(eq(products.id, suco.id));

    const order = await getOrderFor(consultorA.actor, id);
    expect(order!.totalCents).toBe(14790);
    expect(order!.items.map((i) => [i.reference, i.description, i.unitPriceCents])).toEqual([
      ["CAM-01", "Camiseta azul", 1990],
      ["SUC-01", "Suco de uva", 735],
    ]);
  });
});

describe("mensagem do WhatsApp gerada a partir do pedido gravado", () => {
  it("contém cliente, itens, valores e total do pedido salvo — e permanece igual se o catálogo mudar", async () => {
    await placeOrder(consultorA.actor.id, [line(camiseta, 1990, 3), line(suco, 735, 12)], {
      customerName: "João da Loja",
      customerPhone: "(11) 98888-7777",
      notes: "Entregar cedo",
    });
    const id = (await listOrdersFor(admin.actor, { search: "João da Loja" })).items[0].id;

    const build = async () => {
      const order = (await getOrderFor(consultorA.actor, id))!;
      return {
        order,
        message: formatOrderMessage({
          orderNumber: order.orderNumber,
          createdAt: order.createdAt,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          notes: order.notes,
          requesterName: order.requesterName,
          totalCents: order.totalCents,
          items: order.items,
        }),
      };
    };

    const { order, message } = await build();
    expect(message).toContain(`*PEDIDO #${order.orderNumber}*`);
    expect(message).toContain(`Lançado por: ${consultorA.name}`);
    expect(message).toContain("Cliente: João da Loja");
    expect(message).toContain("Telefone: (11) 98888-7777");
    expect(message).toContain("1) CAM-01 - Camiseta azul\n    3 x R$ 19,90 = R$ 59,70");
    expect(message).toContain("2) SUC-01 - Suco de uva\n    12 x R$ 7,35 = R$ 88,20");
    expect(message).toContain("*TOTAL: R$ 147,90*");
    expect(message).toContain("Observações:\nEntregar cedo");

    // o link carrega exatamente essa mensagem
    const url = new URL(buildWhatsAppUrl(message, order.customerPhone));
    expect(url.pathname).toBe("/5511988887777");
    expect(url.searchParams.get("text")).toBe(message);

    // mudar o catálogo não muda a mensagem
    await getDb().update(products).set({ priceCents: 1, description: "Outra" }).where(eq(products.id, camiseta.id));
    expect((await build()).message).toBe(message);
  });
});

describe("pedido interno (CONSULTOR, sem cliente) no histórico", () => {
  let internalId: string;

  beforeEach(async () => {
    const { finalizeDraft } = await import("@/lib/orders/finalize");
    const { saveDraft } = await import("@/lib/orders/draft");
    await saveDraft(consultorA.actor.id, [{ productId: camiseta.id, quantity: 2 }]);
    internalId = (await finalizeDraft(consultorA.actor.id, { expectedTotalCents: 3980 }, { withCustomer: false })).orderId;
  });

  it("aparece na lista do dono e do ADMIN, com cliente nulo", async () => {
    for (const who of [consultorA, admin]) {
      const found = (await listOrdersFor(who.actor, { pageSize: 100 })).items.find((o) => o.id === internalId);
      expect(found).toMatchObject({ customerName: null, requesterName: consultorA.name, lineCount: 1, unitCount: 2, totalCents: 3980 });
    }
    expect((await listOrdersFor(consultorB.actor, { pageSize: 100 })).items.some((o) => o.id === internalId)).toBe(false);
  });

  it("é encontrado pelo número do pedido, e a busca por nome de cliente não o confunde", async () => {
    const [{ orderNumber }] = (await listOrdersFor(consultorA.actor, { pageSize: 100 })).items.filter((o) => o.id === internalId);
    expect((await listOrdersFor(consultorA.actor, { search: String(orderNumber) })).items.map((o) => o.id)).toContain(internalId);
    expect((await listOrdersFor(admin.actor, { search: "Mercado" })).items.map((o) => o.id)).not.toContain(internalId);
  });

  it("o detalhe vem sem cliente, telefone e observações", async () => {
    expect(await getOrderFor(consultorA.actor, internalId)).toMatchObject({ customerName: null, customerPhone: null, notes: null });
  });
});
