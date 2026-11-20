"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ORDER_STATUS_LABEL, ORDER_STATUSES, type OrderStatus } from "@/lib/orders/status";

export type UpdateStatusResult = { ok: true; status: OrderStatus } | { ok: false; error: string };
export type UpdateStatus = (orderId: string, status: OrderStatus) => Promise<UpdateStatusResult>;

/**
 * Seletor para alterar a situação de um pedido. Mostra a escolha na hora (`useOptimistic`) e, se o
 * servidor recusar, volta sozinho à situação real e explica o motivo. Enquanto grava, fica desabilitado:
 * nunca há duas alterações do mesmo pedido em paralelo.
 *
 * Cancelar pede confirmação: tira o pedido do faturamento e é fácil de acertar sem querer numa lista.
 * Reabrir um cancelado ou desfazer uma confirmação não pedem, pois nada se perde.
 */
export function OrderStatusControl({
  orderId,
  orderNumber,
  status,
  action,
}: {
  orderId: string;
  orderNumber: number;
  /** Situação atual, vinda do servidor. */
  status: OrderStatus;
  action: UpdateStatus;
}) {
  const [shown, setShown] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>();

  function change(next: OrderStatus) {
    if (next === status) return;
    if (next === "CANCELADO" && !window.confirm(`Cancelar o pedido #${orderNumber}? Ele deixa de contar no faturamento.`)) {
      return; // o seletor é controlado: sem mudar o estado, ele volta à situação atual
    }
    setFeedback(undefined);
    startTransition(async () => {
      setShown(next);
      let result: UpdateStatusResult;
      try {
        result = await action(orderId, next);
      } catch {
        result = { ok: false, error: "Não foi possível alterar a situação. Tente novamente." };
      }
      setFeedback(
        result.ok
          ? { ok: true, text: `Situação alterada para ${ORDER_STATUS_LABEL[result.status]}.` }
          : { ok: false, text: result.error },
      );
    });
  }

  return (
    <div>
      <select
        data-testid="order-status-select"
        aria-label={`Situação do pedido #${orderNumber}`}
        value={shown}
        disabled={pending}
        onChange={(event) => change(event.target.value as OrderStatus)}
        className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-base focus:border-emerald-600 focus:outline-none disabled:opacity-60 sm:min-h-0 sm:w-auto sm:text-sm"
      >
        {ORDER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {ORDER_STATUS_LABEL[value]}
          </option>
        ))}
      </select>
      {pending ? (
        <p role="status" className="mt-1 text-xs text-slate-500">
          Salvando…
        </p>
      ) : feedback?.ok ? (
        <p role="status" data-testid="order-status-feedback" className="mt-1 text-xs text-emerald-700">
          {feedback.text}
        </p>
      ) : feedback ? (
        <p role="alert" data-testid="order-status-feedback" className="mt-1 text-xs text-red-600">
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
