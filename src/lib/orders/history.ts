import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders, users } from "@/db/schema";
import { canAccessOrder, hasPermission } from "@/lib/auth/rbac";
import type { UserRole } from "@/lib/auth/roles";
import { clampPage, DEFAULT_PAGE_SIZE, totalPagesFor } from "@/lib/pagination";
import { escapeLike } from "@/lib/sql";
import { uuidSchema } from "@/lib/validation/common";
import type { OrderStatus } from "@/lib/orders/status";

export type Actor = { id: string; role: UserRole };

export type OrderSummary = {
  id: string;
  orderNumber: number;
  /** `null` = pedido interno de CONSULTOR, sem cliente. */
  customerName: string | null;
  status: OrderStatus;
  totalCents: number;
  createdAt: Date;
  /** Quem lançou o pedido; `null` = visitante sem cadastro (veja `requesterLabel`). */
  requesterName: string | null;
  lineCount: number;
  unitCount: number;
};

export type OrderListParams = {
  /** Nome do cliente (trecho) ou número do pedido ("12" ou "#12"). */
  search?: string;
  status?: OrderStatus;
  page?: number;
  pageSize?: number;
};

export type OrderListResult = {
  items: OrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type OrderDetailItem = {
  id: string;
  reference: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type OrderDetail = OrderSummary & {
  /** `null` = pedido de visitante sem cadastro. */
  userId: string | null;
  customerPhone: string | null;
  notes: string | null;
  items: OrderDetailItem[];
};

/**
 * Regra de visibilidade da LISTA: quem pode ler todos os pedidos (ADMIN) não tem filtro;
 * os demais só enxergam os que eles mesmos lançaram. Equivale a `canAccessOrder` aplicado a cada linha
 * (um teste de integração garante que as duas regras nunca divergem).
 */
function visibilityFilter(actor: Actor): SQL | undefined {
  if (hasPermission(actor.role, "order:read:all")) return undefined;
  if (hasPermission(actor.role, "order:read:own")) return eq(orders.userId, actor.id);
  return sql`false`; // sem nenhuma permissão de leitura: não vê nada
}

const summaryColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  customerName: orders.customerName,
  status: orders.status,
  totalCents: orders.totalCents,
  createdAt: orders.createdAt,
  requesterName: users.name,
  lineCount: sql<number>`(select count(*) from ${orderItems} where ${orderItems.orderId} = ${orders.id})`.mapWith(Number),
  unitCount: sql<number>`coalesce((select sum(${orderItems.quantity}) from ${orderItems} where ${orderItems.orderId} = ${orders.id}), 0)`.mapWith(Number),
};

export async function listOrdersFor(actor: Actor, params: OrderListParams = {}): Promise<OrderListResult> {
  const db = getDb();
  const pageSize = Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE);

  const filters: SQL[] = [];
  const visibility = visibilityFilter(actor);
  if (visibility) filters.push(visibility);

  const search = params.search?.trim();
  if (search) {
    const numeric = search.replace(/^#/, "");
    const byName = ilike(orders.customerName, `%${escapeLike(search)}%`);
    // Só tenta casar o número quando o texto cabe num `integer` do PostgreSQL.
    filters.push(/^\d{1,9}$/.test(numeric) ? or(byName, eq(orders.orderNumber, Number(numeric)))! : byName);
  }
  if (params.status) filters.push(eq(orders.status, params.status));
  const where = filters.length ? and(...filters) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(orders)
    .where(where);
  const totalPages = totalPagesFor(total, pageSize);
  const page = clampPage(params.page ?? 1, totalPages);

  const items = await db
    .select(summaryColumns)
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(where)
    .orderBy(desc(orders.createdAt), desc(orders.orderNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total, page, pageSize, totalPages };
}

/**
 * Pedido completo, ou `null` se não existir OU se o usuário não puder acessá-lo
 * (as duas situações são indistinguíveis de propósito: não revelamos que o pedido existe).
 */
export async function getOrderFor(actor: Actor, orderId: string): Promise<OrderDetail | null> {
  if (!uuidSchema.safeParse(orderId).success) return null;
  const db = getDb();

  const [order] = await db
    .select({ ...summaryColumns, userId: orders.userId, customerPhone: orders.customerPhone, notes: orders.notes })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || !canAccessOrder(actor, order)) return null;

  const items = await db
    .select({
      id: orderItems.id,
      reference: orderItems.reference,
      description: orderItems.description,
      unitPriceCents: orderItems.unitPriceCents,
      quantity: orderItems.quantity,
      lineTotalCents: orderItems.lineTotalCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.position), asc(orderItems.id));

  return { ...order, items };
}

/** Total de pedidos no sistema (painel administrativo). */
export async function countAllOrders(): Promise<number> {
  const [{ total }] = await getDb().select({ total: sql<number>`count(*)`.mapWith(Number) }).from(orders);
  return total;
}
