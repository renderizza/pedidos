"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import type { OrderStatus } from "@/lib/orders/status";
import { OrderNotFoundError, OrderStatusForbiddenError, updateOrderStatus } from "@/lib/orders/update-status";

export type UpdateOrderStatusResult = { ok: true; status: OrderStatus } | { ok: false; error: string };

/**
 * Altera a situação de um pedido (lista de `/pedidos`).
 *
 * Server Actions são endpoints públicos: a permissão é conferida ANTES de qualquer outra coisa
 * (CLIENTE, que só acompanha os pedidos, recebe 403 e visitante vai ao login) e, dentro de
 * `updateOrderStatus`, a posse do pedido (CONSULTOR só altera os próprios; ADMIN, qualquer um).
 */
export async function updateOrderStatusAction(orderId: string, status: unknown): Promise<UpdateOrderStatusResult> {
  const user = await requirePermission("order:manage:own");

  try {
    const change = await updateOrderStatus(user, orderId, status);
    if (change.changed) {
      revalidatePath("/pedidos");
      revalidatePath(`/pedidos/${change.orderId}`);
      revalidatePath("/admin"); // o faturamento do painel não conta os cancelados
    }
    return { ok: true, status: change.to };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, error: "Situação inválida" };
    if (error instanceof OrderNotFoundError || error instanceof OrderStatusForbiddenError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
