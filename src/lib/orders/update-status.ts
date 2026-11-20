import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { canAccessOrder, canManageOrder } from "@/lib/auth/rbac";
import { uuidSchema } from "@/lib/validation/common";
import { orderStatusSchema } from "@/lib/validation/order";
import type { Actor } from "./history";
import type { OrderStatus } from "./status";

/** Pedido inexistente OU de outra pessoa: indistinguíveis de propósito (não revelamos que ele existe). */
export class OrderNotFoundError extends Error {
  constructor() {
    super("Pedido não encontrado");
    this.name = "OrderNotFoundError";
  }
}

/** O usuário enxerga o pedido (é o dono), mas o perfil dele não pode alterar a situação (ex.: CLIENTE). */
export class OrderStatusForbiddenError extends Error {
  constructor() {
    super("Você não tem permissão para alterar a situação deste pedido");
    this.name = "OrderStatusForbiddenError";
  }
}

export type OrderStatusChange = {
  orderId: string;
  orderNumber: number;
  from: OrderStatus;
  to: OrderStatus;
  /** `false` quando o pedido já estava nessa situação (nada foi gravado). */
  changed: boolean;
};

/**
 * Altera a situação do pedido (PENDENTE, CONFIRMADO ou CANCELADO).
 *
 * Qualquer mudança entre as três é permitida: quem gerencia o pedido pode corrigir um engano
 * (reabrir um cancelado, desfazer uma confirmação). A situação conta no faturamento — cancelados ficam
 * de fora —, então a próxima leitura do painel já reflete a mudança.
 *
 * Quem pode: `canManageOrder` (ADMIN em qualquer pedido; CONSULTOR nos seus; CLIENTE em nenhum).
 * Pedido de outra pessoa responde como inexistente; o dono sem permissão de gerenciar recebe um erro claro.
 */
export async function updateOrderStatus(actor: Actor, orderId: string, status: unknown): Promise<OrderStatusChange> {
  const to = orderStatusSchema.parse(status);
  if (!uuidSchema.safeParse(orderId).success) throw new OrderNotFoundError();

  const db = getDb();
  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || !canAccessOrder(actor, order)) throw new OrderNotFoundError();
  if (!canManageOrder(actor, order)) throw new OrderStatusForbiddenError();

  const change = { orderId: order.id, orderNumber: order.orderNumber, from: order.status, to };
  if (order.status === to) return { ...change, changed: false };

  await db.update(orders).set({ status: to }).where(eq(orders.id, order.id));
  return { ...change, changed: true };
}
