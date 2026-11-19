/**
 * Acesso direto ao banco E2E para PREPARAR dados de teste (ex.: criar 12 produtos de uma vez).
 * Os workers do Playwright herdam DATABASE_URL do banco de integração; aqui apontamos para o E2E.
 */
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import type { UserRole } from "@/lib/auth/roles";
import { createCategory } from "@/lib/categories/service";
import { saveDraft } from "@/lib/orders/draft";
import { finalizeDraft } from "@/lib/orders/finalize";
import { createProduct } from "@/lib/products/service";
import { createUser } from "@/lib/users/service";

export async function seedProducts(prefix: string, count: number) {
  for (let i = 1; i <= count; i++) {
    await createProduct({
      reference: `${prefix}-${String(i).padStart(2, "0")}`,
      description: `Produto de paginação ${prefix} número ${i}`,
      priceCents: 1000 + i,
    });
  }
}

/**
 * Usuário exclusivo do teste. O rascunho de pedido é único por usuário, então testes
 * que rodam em paralelo não podem compartilhar a mesma conta.
 */
export async function createE2eUser(role: UserRole, uniqueSuffix: string) {
  const credentials = {
    name: `Usuário ${role} ${uniqueSuffix}`,
    email: `e2e-${role.toLowerCase()}-${uniqueSuffix.toLowerCase()}@teste.com`,
    password: "Senha@12345",
    role,
  };
  const user = await createUser(credentials);
  return { ...credentials, id: user.id };
}

/** Catálogo de 3 produtos ativos + 1 inativo, com preços escolhidos para exercitar centavos. */
export async function createOrderCatalog(prefix: string) {
  const category = await createCategory({ name: `Bebidas ${prefix}` });
  const camiseta = await createProduct({
    reference: `${prefix}-CAM`,
    description: `Camiseta azul ${prefix}`,
    priceCents: 1990,
  });
  const suco = await createProduct({
    reference: `${prefix}-SUC`,
    description: `Suco de uva ${prefix}`,
    priceCents: 735,
    categoryId: category.id,
  });
  const cafe = await createProduct({
    reference: `${prefix}-CAF`,
    description: `Café especial ${prefix}`,
    priceCents: 2500,
  });
  const inativo = await createProduct({
    reference: `${prefix}-OFF`,
    description: `Produto desativado ${prefix}`,
    priceCents: 999,
    active: false,
  });
  return { category, camiseta, suco, cafe, inativo };
}

/** Pedidos gravados para um cliente (nome exato), com os itens: para conferir o que a tela gravou. */
export async function ordersByCustomer(customerName: string) {
  const db = getDb();
  const found = await db.select().from(orders).where(eq(orders.customerName, customerName));
  return Promise.all(
    found.map(async (order) => ({
      ...order,
      items: await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    })),
  );
}

/** Pedidos lançados por um usuário, com os itens (para conferir o que a tela gravou). */
export async function ordersOfUser(userId: string) {
  const db = getDb();
  const found = await db.select().from(orders).where(eq(orders.userId, userId));
  return Promise.all(
    found.map(async (order) => ({
      ...order,
      items: await db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    })),
  );
}

export async function setProductActive(id: string, active: boolean) {
  await getDb().update(products).set({ active }).where(eq(products.id, id));
}

export async function setProductPrice(id: string, priceCents: number) {
  await getDb().update(products).set({ priceCents }).where(eq(products.id, id));
}

/** Lança um pedido já finalizado (pelo mesmo caminho do sistema: rascunho → finalização). */
export async function placeOrderFor(
  userId: string,
  lines: { productId: string; priceCents: number; quantity: number }[],
  customer: { customerName: string; customerPhone?: string; notes?: string },
) {
  await saveDraft(
    userId,
    lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  );
  return finalizeDraft(userId, {
    customerName: customer.customerName,
    customerPhone: customer.customerPhone ?? "",
    notes: customer.notes ?? "",
    expectedTotalCents: lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0),
  });
}
