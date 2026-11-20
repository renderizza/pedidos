import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { updateOrderStatusAction } from "@/app/pedidos/actions";
import { closeDb, getDb } from "@/db";
import { orders } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth/session";
import type { UserRole } from "@/lib/auth/roles";
import { createGuestOrder } from "@/lib/orders/finalize";
import { getOrderFor, listOrdersFor, type Actor } from "@/lib/orders/history";
import { getRevenueMetrics } from "@/lib/orders/revenue";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/status";
import { OrderNotFoundError, OrderStatusForbiddenError, updateOrderStatus } from "@/lib/orders/update-status";
import { insertProduct, placeOrder } from "../setup/catalog-fixtures";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";
import { cookieJar, ForbiddenError, RedirectError, resetNextMocks, revalidatedPaths } from "../setup/next-mocks";

vi.mock("next/headers", async () => (await import("../setup/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("../setup/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("../setup/next-mocks")).nextCacheMock);

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Who = { actor: Actor; token: string };
let admin: Who;
let consultorA: Who;
let consultorB: Who;
let cliente: Who;
/** Um pedido de cada dono, todos PENDENTE, R$ 19,90 cada. */
let orderA: string;
let orderB: string;
let orderCliente: string;
let orderVisitante: string;

async function newUser(role: UserRole): Promise<Who> {
  const { user, token } = await createUserWithSession(role);
  return { actor: { id: user.id, role }, token };
}

const statusOf = async (orderId: string) =>
  (await getDb().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]?.status;

const loginAs = (who: Who) => cookieJar.set(SESSION_COOKIE, who.token);

beforeEach(async () => {
  resetNextMocks();
  await resetDatabase();
  [admin, consultorA, consultorB, cliente] = await Promise.all([
    newUser("ADMIN"),
    newUser("CONSULTOR"),
    newUser("CONSULTOR"),
    newUser("CLIENTE"),
  ]);
  const camiseta = await insertProduct({ reference: "CAM-01", description: "Camiseta azul", priceCents: 1990 });
  const line = [{ productId: camiseta.id, priceCents: 1990, quantity: 1 }];

  orderA = (await placeOrder(consultorA.actor.id, line, { customerName: "Cliente do A" })).orderId;
  orderB = (await placeOrder(consultorB.actor.id, line, { customerName: "Cliente do B" })).orderId;
  orderCliente = (await placeOrder(cliente.actor.id, line, { customerName: "Cliente Final" })).orderId;
  orderVisitante = (
    await createGuestOrder({
      customerName: "Visitante",
      customerPhone: "",
      notes: "",
      expectedTotalCents: 1990,
      items: [{ productId: camiseta.id, quantity: 1 }],
    })
  ).orderId;
});

afterAll(async () => {
  await closeDb();
});

describe("updateOrderStatus — quem pode alterar", () => {
  it("todo pedido nasce PENDENTE", async () => {
    for (const id of [orderA, orderB, orderCliente, orderVisitante]) expect(await statusOf(id)).toBe("PENDENTE");
  });

  it("ADMIN altera o pedido de qualquer pessoa — inclusive de visitante sem cadastro", async () => {
    for (const id of [orderA, orderB, orderCliente, orderVisitante]) {
      const change = await updateOrderStatus(admin.actor, id, "CONFIRMADO");
      expect(change).toMatchObject({ orderId: id, from: "PENDENTE", to: "CONFIRMADO", changed: true });
      expect(await statusOf(id)).toBe("CONFIRMADO");
    }
  });

  it("CONSULTOR altera os SEUS pedidos", async () => {
    await updateOrderStatus(consultorA.actor, orderA, "CONFIRMADO");
    expect(await statusOf(orderA)).toBe("CONFIRMADO");
  });

  it.each([
    ["de outro consultor", () => orderB],
    ["do cliente", () => orderCliente],
    ["de visitante", () => orderVisitante],
  ])("CONSULTOR NÃO altera pedido %s: responde como inexistente e nada muda", async (_label, pick) => {
    const id = pick();
    await expect(updateOrderStatus(consultorA.actor, id, "CANCELADO")).rejects.toBeInstanceOf(OrderNotFoundError);
    expect(await statusOf(id)).toBe("PENDENTE");
  });

  it("CLIENTE enxerga o próprio pedido mas NÃO pode alterar a situação (erro claro, nada muda)", async () => {
    await expect(updateOrderStatus(cliente.actor, orderCliente, "CONFIRMADO")).rejects.toBeInstanceOf(OrderStatusForbiddenError);
    expect(await statusOf(orderCliente)).toBe("PENDENTE");
  });

  it("CLIENTE não descobre pedidos alheios: para ele, pedido de outra pessoa 'não existe'", async () => {
    await expect(updateOrderStatus(cliente.actor, orderA, "CONFIRMADO")).rejects.toBeInstanceOf(OrderNotFoundError);
    await expect(updateOrderStatus(cliente.actor, orderVisitante, "CONFIRMADO")).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it("papel desconhecido não altera nada (falha fechado)", async () => {
    const ghost = { id: consultorA.actor.id, role: "ROOT" as unknown as UserRole };
    await expect(updateOrderStatus(ghost, orderA, "CONFIRMADO")).rejects.toBeInstanceOf(OrderNotFoundError);
    expect(await statusOf(orderA)).toBe("PENDENTE");
  });
});

describe("updateOrderStatus — transições e dados", () => {
  const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const));

  it.each(pairs)("%s → %s é permitido (quem gerencia pode corrigir um engano)", async (from, to) => {
    await getDb().update(orders).set({ status: from }).where(eq(orders.id, orderA));
    const change = await updateOrderStatus(admin.actor, orderA, to);
    expect(change).toMatchObject({ from, to, changed: true });
    expect(await statusOf(orderA)).toBe(to);
  });

  it("a mesma situação não grava nada (updated_at não muda)", async () => {
    const [before] = await getDb().select().from(orders).where(eq(orders.id, orderA));
    const change = await updateOrderStatus(admin.actor, orderA, "PENDENTE");
    const [after] = await getDb().select().from(orders).where(eq(orders.id, orderA));
    expect(change).toMatchObject({ from: "PENDENTE", to: "PENDENTE", changed: false });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("alterar atualiza updated_at e muda SÓ a situação: cliente, total e itens ficam intactos", async () => {
    const [before] = await getDb().select().from(orders).where(eq(orders.id, orderA));
    const detailBefore = await getOrderFor(admin.actor, orderA);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await updateOrderStatus(admin.actor, orderA, "CONFIRMADO");

    const [after] = await getDb().select().from(orders).where(eq(orders.id, orderA));
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect({ ...after, status: before.status, updatedAt: before.updatedAt }).toEqual(before);
    const detailAfter = await getOrderFor(admin.actor, orderA);
    expect({ ...detailAfter, status: detailBefore!.status }).toEqual(detailBefore);
  });

  it("não mexe nos outros pedidos", async () => {
    await updateOrderStatus(admin.actor, orderA, "CANCELADO");
    for (const id of [orderB, orderCliente, orderVisitante]) expect(await statusOf(id)).toBe("PENDENTE");
  });

  it.each(["ENTREGUE", "pendente", "Confirmado", "", " ", null, undefined, 1, { status: "CONFIRMADO" }])(
    "situação inválida (%j) é recusada com ZodError e nada muda",
    async (status) => {
      await expect(updateOrderStatus(admin.actor, orderA, status)).rejects.toBeInstanceOf(ZodError);
      expect(await statusOf(orderA)).toBe("PENDENTE");
    },
  );

  it.each([MISSING_ID, "xyz", "", "'; drop table orders;--"])("id inexistente ou malformado (%j): pedido não encontrado", async (id) => {
    await expect(updateOrderStatus(admin.actor, id, "CONFIRMADO")).rejects.toBeInstanceOf(OrderNotFoundError);
    expect((await listOrdersFor(admin.actor, { pageSize: 100 })).total).toBe(4); // a tabela segue intacta
  });
});

describe("a situação aparece nas telas que a leem", () => {
  it("a lista, o filtro por situação e o detalhe refletem a alteração", async () => {
    await updateOrderStatus(consultorA.actor, orderA, "CONFIRMADO");
    await updateOrderStatus(admin.actor, orderB, "CANCELADO");

    const byStatus = async (status: OrderStatus) =>
      (await listOrdersFor(admin.actor, { status, pageSize: 100 })).items.map((o) => o.customerName).sort();
    expect(await byStatus("CONFIRMADO")).toEqual(["Cliente do A"]);
    expect(await byStatus("CANCELADO")).toEqual(["Cliente do B"]);
    expect(await byStatus("PENDENTE")).toEqual(["Cliente Final", "Visitante"]);

    expect((await getOrderFor(consultorA.actor, orderA))?.status).toBe("CONFIRMADO");
    // quem não é dono continua sem ver o pedido
    expect(await getOrderFor(consultorA.actor, orderB)).toBeNull();
  });

  it("faturamento: cancelar tira o pedido da soma e reabrir o devolve (pendente e confirmado contam)", async () => {
    const total = async () => (await getRevenueMetrics()).total;
    expect(await total()).toEqual({ revenueCents: 4 * 1990, orderCount: 4 });

    await updateOrderStatus(admin.actor, orderA, "CANCELADO");
    expect(await total()).toEqual({ revenueCents: 3 * 1990, orderCount: 3 });

    await updateOrderStatus(admin.actor, orderB, "CONFIRMADO");
    expect(await total()).toEqual({ revenueCents: 3 * 1990, orderCount: 3 }); // confirmar não muda: já contava

    await updateOrderStatus(admin.actor, orderA, "PENDENTE");
    expect(await total()).toEqual({ revenueCents: 4 * 1990, orderCount: 4 });

    const rows = (await getRevenueMetrics()).byStatus;
    expect(rows.map((r) => [r.status, r.orderCount])).toEqual([
      ["PENDENTE", 3],
      ["CONFIRMADO", 1],
      ["CANCELADO", 0],
    ]);
  });
});

describe("updateOrderStatusAction (Server Action)", () => {
  it("visitante é enviado ao login e nada muda", async () => {
    await expect(updateOrderStatusAction(orderA, "CONFIRMADO")).rejects.toMatchObject({ url: "/login" });
    await expect(updateOrderStatusAction(orderA, "CONFIRMADO")).rejects.toBeInstanceOf(RedirectError);
    expect(await statusOf(orderA)).toBe("PENDENTE");
    expect(revalidatedPaths).toEqual([]);
  });

  it("CLIENTE recebe 403 antes de qualquer coisa — mesmo no próprio pedido", async () => {
    loginAs(cliente);
    await expect(updateOrderStatusAction(orderCliente, "CONFIRMADO")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(orderCliente)).toBe("PENDENTE");
    expect(revalidatedPaths).toEqual([]);
  });

  it("ADMIN altera e a lista, o detalhe e o painel (faturamento) são revalidados", async () => {
    loginAs(admin);
    await expect(updateOrderStatusAction(orderVisitante, "CANCELADO")).resolves.toEqual({ ok: true, status: "CANCELADO" });
    expect(await statusOf(orderVisitante)).toBe("CANCELADO");
    expect(revalidatedPaths).toEqual(["/pedidos", `/pedidos/${orderVisitante}`, "/admin"]);
  });

  it("CONSULTOR altera o próprio pedido; no de outra pessoa recebe 'não encontrado' e nada é revalidado", async () => {
    loginAs(consultorA);
    await expect(updateOrderStatusAction(orderA, "CONFIRMADO")).resolves.toEqual({ ok: true, status: "CONFIRMADO" });

    revalidatedPaths.length = 0;
    await expect(updateOrderStatusAction(orderB, "CONFIRMADO")).resolves.toEqual({ ok: false, error: "Pedido não encontrado" });
    expect(await statusOf(orderB)).toBe("PENDENTE");
    expect(revalidatedPaths).toEqual([]);
  });

  it("a mesma situação responde ok, mas sem revalidar nada (nada mudou)", async () => {
    loginAs(admin);
    await expect(updateOrderStatusAction(orderA, "PENDENTE")).resolves.toEqual({ ok: true, status: "PENDENTE" });
    expect(revalidatedPaths).toEqual([]);
  });

  it.each(["ENTREGUE", "", null, 42])("situação inválida (%j): devolve erro, não lança e não grava", async (status) => {
    loginAs(admin);
    await expect(updateOrderStatusAction(orderA, status)).resolves.toEqual({ ok: false, error: "Situação inválida" });
    expect(await statusOf(orderA)).toBe("PENDENTE");
    expect(revalidatedPaths).toEqual([]);
  });

  it("id malformado: 'Pedido não encontrado', sem lançar", async () => {
    loginAs(admin);
    await expect(updateOrderStatusAction("xyz", "CONFIRMADO")).resolves.toEqual({ ok: false, error: "Pedido não encontrado" });
  });

  it("usuário desativado perde o acesso na hora (a sessão deixa de valer)", async () => {
    const { user, token } = await createUserWithSession("CONSULTOR", { active: false });
    cookieJar.set(SESSION_COOKIE, token);
    await expect(updateOrderStatusAction(orderA, "CONFIRMADO")).rejects.toMatchObject({ url: "/login" });
    expect(user.id).toBeTruthy();
    expect(await statusOf(orderA)).toBe("PENDENTE");
  });
});
