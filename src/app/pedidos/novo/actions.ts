"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { collectsCustomerData } from "@/lib/auth/rbac";
import { addToDraft, DraftLimitError, DraftProductUnavailableError, saveDraft } from "@/lib/orders/draft";
import { getEnv } from "@/lib/env";
import {
  createGuestOrder,
  EmptyDraftError,
  finalizeDraft,
  OrderPriceChangedError,
  OrderProductUnavailableError,
  OrderTotalTooLargeError,
  type PlacedOrder,
} from "@/lib/orders/finalize";
import { fieldErrors } from "@/lib/validation/common";
import { buildWhatsAppUrl, formatOrderMessage, normalizeBrazilPhone } from "@/lib/whatsapp";

export type DraftSaveResult = { ok: true } | { ok: false; error: string };
export type AddToDraftResult = { ok: true; quantity: number } | { ok: false; error: string };

// O dono do rascunho é SEMPRE o usuário da sessão — nunca um id vindo do cliente.

/** Salva (substitui) o rascunho do usuário logado. Lista vazia apaga o rascunho. */
export async function saveDraftAction(items: unknown): Promise<DraftSaveResult> {
  const user = await requirePermission("order:create");
  try {
    await saveDraft(user.id, items);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
    if (error instanceof DraftProductUnavailableError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Soma 1 unidade do produto ao rascunho (botão "Adicionar ao pedido" da vitrine). */
export async function addToDraftAction(productId: string): Promise<AddToDraftResult> {
  const user = await requirePermission("order:create");
  try {
    const { quantity } = await addToDraft(user.id, productId);
    revalidatePath("/pedidos/novo");
    return { ok: true, quantity };
  } catch (error) {
    if (error instanceof DraftProductUnavailableError || error instanceof DraftLimitError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Mensagem do WhatsApp de um pedido de visitante, já pronta (o número da loja só existe no servidor). */
export type GuestReceipt = {
  message: string;
  /** Abre o WhatsApp da loja com a mensagem preenchida. */
  storeUrl: string;
  /** Abre a conversa com o próprio cliente; `null` sem telefone válido. */
  customerUrl: string | null;
};

export type FinalizeResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      /** Só nos pedidos de visitante: eles não têm página de detalhe, então a confirmação vem junto. */
      receipt?: GuestReceipt;
    }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** `refresh`: a tela precisa ser recarregada para mostrar os dados atuais. */
      refresh?: boolean;
    };

/**
 * Finaliza o pedido: converte o rascunho do usuário da sessão em pedido final.
 * Itens e preços vêm do servidor; do cliente só chegam os dados do cliente do pedido
 * e o total que o usuário viu (para detectar preço alterado no meio do caminho).
 */
export async function finalizeOrderAction(input: unknown): Promise<FinalizeResult> {
  const user = await requirePermission("order:create");
  try {
    // O perfil decide se o pedido leva dados de cliente (CONSULTOR: não), nunca o que o cliente da requisição enviar.
    const { orderId, orderNumber } = await finalizeDraft(user.id, input, { withCustomer: collectsCustomerData(user.role) });
    revalidatePath("/pedidos");
    revalidatePath("/pedidos/novo");
    return { ok: true, orderId, orderNumber };
  } catch (error) {
    return finalizeFailure(error);
  }
}

/** Erros esperados da finalização viram resultado para a tela; qualquer outro é relançado. */
function finalizeFailure(error: unknown): FinalizeResult {
  if (error instanceof ZodError) {
    return { ok: false, error: "Revise os campos destacados", fieldErrors: fieldErrors(error) };
  }
  if (error instanceof EmptyDraftError || error instanceof OrderTotalTooLargeError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof OrderPriceChangedError || error instanceof OrderProductUnavailableError) {
    return { ok: false, error: error.message, refresh: true };
  }
  throw error;
}

function buildGuestReceipt(order: PlacedOrder): GuestReceipt {
  const message = formatOrderMessage({
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    notes: order.notes,
    requesterName: null, // visitante: a linha "Lançado por" não aparece
    totalCents: order.totalCents,
    items: order.items,
  });
  const customerUrl =
    order.customerPhone && normalizeBrazilPhone(order.customerPhone)
      ? buildWhatsAppUrl(message, order.customerPhone)
      : null;
  return { message, storeUrl: buildWhatsAppUrl(message, getEnv().WHATSAPP_ORDERS_NUMBER), customerUrl };
}

/**
 * Finaliza o pedido de um VISITANTE (sem cadastro). É PÚBLICA de propósito — não exige login —,
 * então nada que vem do cliente é confiável: os itens são só produto + quantidade (validados pelo
 * Zod) e preços, disponibilidade e total são recalculados no servidor a partir do cadastro.
 * O pedido é gravado sem dono (só o ADMIN o enxerga) e a mensagem do WhatsApp volta pronta.
 */
export async function finalizeGuestOrderAction(input: unknown): Promise<FinalizeResult> {
  try {
    const order = await createGuestOrder(input);
    revalidatePath("/pedidos"); // a lista do ADMIN passa a incluir o pedido novo
    return { ok: true, orderId: order.orderId, orderNumber: order.orderNumber, receipt: buildGuestReceipt(order) };
  } catch (error) {
    return finalizeFailure(error);
  }
}
