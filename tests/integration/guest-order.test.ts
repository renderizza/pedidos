/**
 * Pedido de VISITANTE (sem cadastro): feito direto da vitrine, gravado sem dono (`user_id` nulo)
 * e visível só para o ADMIN. Preço, disponibilidade e total vêm sempre do servidor.
 */
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeGuestOrderAction, finalizeOrderAction } from "@/app/pedidos/novo/actions";
import { closeDb, getDb } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { canAccessOrder } from "@/lib/auth/rbac";
import type { UserRole } from "@/lib/auth/roles";
import {
  createGuestOrder,
  OrderPriceChangedError,
  OrderProductUnavailableError,
  OrderTotalTooLargeError,
} from "@/lib/orders/finalize";
import { countAllOrders, getOrderFor, listOrdersFor, type Actor } from "@/lib/orders/history";
import { insertProduct, placeOrder } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";
import { resetNextMocks, revalidatedPaths } from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("../setup/next-mocks")).nextCacheMock);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const customer = { customerName: "Maria Visitante", customerPhone: "(11) 98888-7777", notes: "Entregar cedo" };
const allOrders = () => getDb().select().from(orders);
const allItems = () => getDb().select().from(orderItems);

async function fixtures() {
  const camiseta = await insertProduct({ reference: "CAM-01", description: "Camiseta azul", priceCents: 1990 });
  const suco = await insertProduct({ reference: "SUC-01", description: "Suco de uva", priceCents: 735 });
  return { camiseta, suco };
}

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("createGuestOrder — gravação do pedido do visitante", () => {
  it("grava o pedido SEM dono, com cliente, total e itens (snapshot) na ordem montada", async () => {
    const { camiseta, suco } = await fixtures();

    const result = await createGuestOrder({
      ...customer,
      expectedTotalCents: 14790,
      items: [
        { productId: suco.id, quantity: 12 },
        { productId: camiseta.id, quantity: 3 },
      ],
    });

    expect(result).toMatchObject({ totalCents: 14790, orderNumber: 1, customerName: "Maria Visitante" });
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.items.map((item) => [item.reference, item.quantity, item.lineTotalCents])).toEqual([
      ["SUC-01", 12, 8820],
      ["CAM-01", 3, 5970],
    ]);

    const [order] = await allOrders();
    expect(order).toMatchObject({
      id: result.orderId,
      userId: null,
      customerName: "Maria Visitante",
      customerPhone: "11988887777",
      notes: "Entregar cedo",
      status: "PENDENTE",
      totalCents: 14790,
    });
    const items = await allItems();
    expect(
      items
        .sort((a, b) => a.position - b.position)
        .map((i) => [i.reference, i.description, i.unitPriceCents, i.quantity, i.lineTotalCents, i.position]),
    ).toEqual([
      ["SUC-01", "Suco de uva", 735, 12, 8820, 0],
      ["CAM-01", "Camiseta azul", 1990, 3, 5970, 1],
    ]);
  });

  it("telefone e observações são opcionais", async () => {
    const { camiseta } = await fixtures();
    await createGuestOrder({
      customerName: "Sem Telefone",
      customerPhone: "",
      notes: "",
      expectedTotalCents: 1990,
      items: [{ productId: camiseta.id, quantity: 1 }],
    });
    expect((await allOrders())[0]).toMatchObject({ customerPhone: null, notes: null });
  });

  it("o histórico não muda se o catálogo mudar depois (snapshot)", async () => {
    const { camiseta } = await fixtures();
    await createGuestOrder({ ...customer, expectedTotalCents: 3980, items: [{ productId: camiseta.id, quantity: 2 }] });

    await getDb().update(products).set({ priceCents: 9999, description: "Outra coisa" }).where(eq(products.id, camiseta.id));
    await getDb().delete(products).where(eq(products.id, camiseta.id));

    expect((await allItems())[0]).toMatchObject({
      productId: null,
      reference: "CAM-01",
      description: "Camiseta azul",
      unitPriceCents: 1990,
      lineTotalCents: 3980,
    });
  });

  it("a numeração é a mesma dos pedidos de usuários (sequência única)", async () => {
    const { camiseta } = await fixtures();
    const { user } = await createUserWithSession("CONSULTOR");
    const first = await placeOrder(user.id, [{ productId: camiseta.id, priceCents: 1990, quantity: 1 }]);
    const guest = await createGuestOrder({ ...customer, expectedTotalCents: 1990, items: [{ productId: camiseta.id, quantity: 1 }] });
    expect(guest.orderNumber).toBe(first.orderNumber + 1);
  });

  describe("o servidor não confia no que vem do cliente", () => {
    it("preço, descrição e dono enviados pelo cliente são ignorados: vale o cadastro", async () => {
      const { camiseta } = await fixtures();
      const { user } = await createUserWithSession("CLIENTE");

      await createGuestOrder({
        ...customer,
        userId: user.id, // tentativa de atribuir o pedido a outra pessoa
        expectedTotalCents: 1990,
        items: [{ productId: camiseta.id, quantity: 1, unitPriceCents: 1, description: "Grátis", priceCents: 1 }],
      });

      const [order] = await allOrders();
      expect(order.userId).toBeNull();
      expect(order.totalCents).toBe(1990);
      expect((await allItems())[0]).toMatchObject({ unitPriceCents: 1990, description: "Camiseta azul" });
    });

    it("total divergente do cadastro (preço mudou, ou total forjado): recusa e não grava nada", async () => {
      const { camiseta } = await fixtures();
      const attempt = { ...customer, items: [{ productId: camiseta.id, quantity: 2 }] };

      await expect(createGuestOrder({ ...attempt, expectedTotalCents: 100 })).rejects.toMatchObject({
        name: "OrderPriceChangedError",
        actualTotalCents: 3980,
      });
      await expect(createGuestOrder({ ...attempt, expectedTotalCents: 3980 })).resolves.toMatchObject({ totalCents: 3980 });

      await getDb().update(products).set({ priceCents: 2500 }).where(eq(products.id, camiseta.id));
      await expect(createGuestOrder({ ...attempt, expectedTotalCents: 3980 })).rejects.toBeInstanceOf(OrderPriceChangedError);
      expect(await allOrders()).toHaveLength(1); // só o que passou
    });

    it("produto desativado ou inexistente: recusa o pedido inteiro e não grava nada", async () => {
      const { camiseta, suco } = await fixtures();
      await getDb().update(products).set({ active: false }).where(eq(products.id, suco.id));

      const inactive = createGuestOrder({
        ...customer,
        expectedTotalCents: 3980 + 735,
        items: [
          { productId: camiseta.id, quantity: 2 },
          { productId: suco.id, quantity: 1 },
        ],
      });
      await expect(inactive).rejects.toBeInstanceOf(OrderProductUnavailableError);
      await expect(inactive).rejects.toMatchObject({ productIds: [suco.id] });

      await expect(
        createGuestOrder({ ...customer, expectedTotalCents: 1990, items: [{ productId: MISSING_ID, quantity: 1 }] }),
      ).rejects.toMatchObject({ name: "OrderProductUnavailableError", productIds: [MISSING_ID] });

      expect(await allOrders()).toHaveLength(0);
      expect(await allItems()).toHaveLength(0);
    });

    it("total acima do limite do banco é recusado", async () => {
      const caro = await insertProduct({ reference: "CARO", priceCents: 1_000_000_000 });
      await expect(
        createGuestOrder({ ...customer, expectedTotalCents: 0, items: [{ productId: caro.id, quantity: 9999 }] }),
      ).rejects.toBeInstanceOf(OrderTotalTooLargeError);
      expect(await allOrders()).toHaveLength(0);
    });
  });

  describe("validação de entrada", () => {
    const invalid: [string, (productId: string) => Record<string, unknown>][] = [
      ["pedido sem itens", () => ({ items: [] })],
      ["quantidade zero", (id) => ({ items: [{ productId: id, quantity: 0 }] })],
      ["quantidade acima de 9999", (id) => ({ items: [{ productId: id, quantity: 10000 }] })],
      ["quantidade decimal", (id) => ({ items: [{ productId: id, quantity: 1.5 }] })],
      ["produto repetido", (id) => ({ items: [{ productId: id, quantity: 1 }, { productId: id, quantity: 2 }] })],
      ["id de produto malformado", () => ({ items: [{ productId: "nao-e-uuid", quantity: 1 }] })],
      ["nome curto demais", () => ({ customerName: "A" })],
      ["nome em branco", () => ({ customerName: "   " })],
      ["telefone inválido", () => ({ customerPhone: "123" })],
      ["observações longas demais", () => ({ notes: "x".repeat(501) })],
      ["total esperado ausente", () => ({ expectedTotalCents: undefined })],
    ];

    it.each(invalid)("recusa %s e não grava nada", async (_label, build) => {
      const { camiseta } = await fixtures();
      const input = {
        ...customer,
        expectedTotalCents: 1990,
        items: [{ productId: camiseta.id, quantity: 1 }],
        ...build(camiseta.id),
      };

      await expect(createGuestOrder(input)).rejects.toBeInstanceOf(ZodError);
      expect(await allOrders()).toHaveLength(0);
    });

    it("mais de 200 itens é recusado", async () => {
      const { camiseta } = await fixtures();
      const items = Array.from({ length: 201 }, () => ({ productId: camiseta.id, quantity: 1 }));
      await expect(createGuestOrder({ ...customer, expectedTotalCents: 0, items })).rejects.toBeInstanceOf(ZodError);
    });
  });
});

describe("visibilidade do pedido do visitante: só o ADMIN", () => {
  let admin: Actor;
  let consultor: Actor;
  let cliente: Actor;
  let guestOrderId: string;

  beforeEach(async () => {
    const [a, c, k] = await Promise.all(
      (["ADMIN", "CONSULTOR", "CLIENTE"] as UserRole[]).map(async (role) => {
        const { user } = await createUserWithSession(role);
        return { id: user.id, role } as Actor;
      }),
    );
    [admin, consultor, cliente] = [a, c, k];
    const { camiseta } = await fixtures();
    // um pedido de usuário também, para garantir que a regra não "vaza" para os outros
    await placeOrder(consultor.id, [{ productId: camiseta.id, priceCents: 1990, quantity: 1 }], { customerName: "Do Consultor" });
    guestOrderId = (
      await createGuestOrder({ ...customer, expectedTotalCents: 1990, items: [{ productId: camiseta.id, quantity: 1 }] })
    ).orderId;
  });

  const names = async (actor: Actor) => (await listOrdersFor(actor, { pageSize: 100 })).items.map((o) => o.customerName);

  it("ADMIN vê o pedido na lista, sem 'lançado por', e abre o detalhe", async () => {
    expect(await names(admin)).toEqual(["Maria Visitante", "Do Consultor"]);
    const [summary] = (await listOrdersFor(admin, { search: "Visitante" })).items;
    expect(summary).toMatchObject({ requesterName: null, lineCount: 1, unitCount: 1 });

    expect(await getOrderFor(admin, guestOrderId)).toMatchObject({
      userId: null,
      requesterName: null,
      customerName: "Maria Visitante",
      customerPhone: "11988887777",
      items: [expect.objectContaining({ reference: "CAM-01", quantity: 1 })],
    });
  });

  it("CONSULTOR e CLIENTE não o veem na lista, nem na busca, e o detalhe responde 'não encontrado'", async () => {
    expect(await names(consultor)).toEqual(["Do Consultor"]);
    expect(await names(cliente)).toEqual([]);
    for (const actor of [consultor, cliente]) {
      expect((await listOrdersFor(actor, { search: "Visitante" })).total).toBe(0);
      expect(await getOrderFor(actor, guestOrderId)).toBeNull();
    }
  });

  it("a regra de SQL da lista continua idêntica a canAccessOrder, inclusive para pedido sem dono", async () => {
    const everything = await allOrders();
    expect(everything.some((o) => o.userId === null)).toBe(true);
    for (const actor of [admin, consultor, cliente]) {
      const viaSql = (await listOrdersFor(actor, { pageSize: 100 })).items.map((o) => o.id).sort();
      const viaRule = everything.filter((o) => canAccessOrder(actor, o)).map((o) => o.id).sort();
      expect(viaSql).toEqual(viaRule);
    }
  });

  it("entra na contagem total do sistema", async () => {
    expect(await countAllOrders()).toBe(2);
  });
});

describe("finalizeGuestOrderAction — Server Action pública", () => {
  const input = (productId: string, overrides: Record<string, unknown> = {}) => ({
    ...customer,
    expectedTotalCents: 3980,
    items: [{ productId, quantity: 2 }],
    ...overrides,
  });

  it("funciona SEM sessão (visitante) e devolve a mensagem do WhatsApp pronta", async () => {
    const { camiseta } = await fixtures();

    const result = await finalizeGuestOrderAction(input(camiseta.id));

    expect(result).toMatchObject({ ok: true, orderNumber: 1 });
    if (!result.ok || !result.receipt) throw new Error("esperava ok com receipt");
    const { message, storeUrl, customerUrl } = result.receipt;

    expect(message).toContain("*PEDIDO #1*");
    expect(message).toContain("Cliente: Maria Visitante");
    expect(message).toContain("Telefone: (11) 98888-7777");
    expect(message).toContain("1) CAM-01 - Camiseta azul");
    expect(message).toContain("2 x R$ 19,90 = R$ 39,80");
    expect(message).toContain("*TOTAL: R$ 39,80*");
    expect(message).toContain("Observações:\nEntregar cedo");
    expect(message).not.toContain("Lançado por"); // visitante não tem quem "lançou"

    expect(storeUrl.startsWith("https://wa.me/")).toBe(true);
    expect(decodeURIComponent(storeUrl.split("?text=")[1])).toBe(message);
    expect(customerUrl!.startsWith("https://wa.me/5511988887777?text=")).toBe(true);

    expect(await allOrders()).toHaveLength(1);
    expect(revalidatedPaths).toEqual(["/pedidos"]);
  });

  it("sem telefone não há atalho para o cliente", async () => {
    const { camiseta } = await fixtures();
    const result = await finalizeGuestOrderAction(input(camiseta.id, { customerPhone: "" }));
    expect(result.ok && result.receipt?.customerUrl).toBeNull();
    expect(result.ok && result.receipt?.message).not.toContain("Telefone:");
  });

  it("não usa o userId enviado: o pedido continua sem dono", async () => {
    const { camiseta } = await fixtures();
    const { user } = await createUserWithSession("CLIENTE");
    const result = await finalizeGuestOrderAction(input(camiseta.id, { userId: user.id }));
    expect(result.ok).toBe(true);
    expect((await allOrders())[0].userId).toBeNull();
  });

  it("campo inválido volta com a mensagem do campo e não grava", async () => {
    const { camiseta } = await fixtures();
    const result = await finalizeGuestOrderAction(input(camiseta.id, { customerName: " " }));
    expect(result).toMatchObject({ ok: false, error: "Revise os campos destacados" });
    expect(!result.ok && result.fieldErrors?.customerName?.[0]).toMatch(/obrigatório/i);
    expect(await allOrders()).toHaveLength(0);
    expect(revalidatedPaths).toEqual([]);
  });

  it("preço alterado ou produto indisponível pedem para recarregar a tela e não gravam", async () => {
    const { camiseta, suco } = await fixtures();
    await getDb().update(products).set({ priceCents: 2500 }).where(eq(products.id, camiseta.id));
    expect(await finalizeGuestOrderAction(input(camiseta.id))).toMatchObject({ ok: false, refresh: true });

    await getDb().update(products).set({ active: false }).where(eq(products.id, suco.id));
    expect(await finalizeGuestOrderAction(input(suco.id, { expectedTotalCents: 1470 }))).toMatchObject({ ok: false, refresh: true });

    expect(await allOrders()).toHaveLength(0);
  });

  it("não abriu mão da proteção das ações de quem está logado: finalizeOrderAction ainda exige login", async () => {
    await expect(finalizeOrderAction({ ...customer, expectedTotalCents: 0 })).rejects.toMatchObject({ url: "/login" });
  });
});
