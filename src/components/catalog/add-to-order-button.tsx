"use client";

import { useState, useTransition } from "react";

type AddResult = { ok: true; quantity: number } | { ok: false; error: string };

/** Soma 1 unidade do produto ao rascunho do pedido e mostra a quantidade já no pedido. */
export function AddToOrderButton({
  productId,
  reference,
  addAction,
}: {
  productId: string;
  reference: string;
  addAction: (productId: string) => Promise<AddResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AddResult>();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-label={`Adicionar ${reference} ao pedido`}
        onClick={() =>
          startTransition(async () => {
            try {
              setResult(await addAction(productId));
            } catch {
              setResult({ ok: false, error: "Não foi possível adicionar. Tente novamente." });
            }
          })
        }
        className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 sm:px-3 sm:py-1.5"
      >
        {pending ? "Adicionando..." : "Adicionar ao pedido"}
      </button>
      <p role="status" aria-live="polite" className="mt-1 text-xs">
        {result?.ok ? (
          <span className="text-emerald-700">No pedido: {result.quantity} un.</span>
        ) : result ? (
          <span className="text-red-600">{result.error}</span>
        ) : null}
      </p>
    </div>
  );
}
