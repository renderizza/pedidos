"use client";

import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/** Copia a mensagem do pedido para a área de transferência (alternativa ao link do WhatsApp). */
export function CopyMessageButton({ message }: { message: string }) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={copy} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100">
        Copiar mensagem
      </button>
      <span role="status" aria-live="polite" data-testid="copy-status" className="text-xs">
        {state === "copied" ? <span className="text-emerald-700">Mensagem copiada!</span> : null}
        {state === "failed" ? <span className="text-red-600">Não foi possível copiar. Selecione o texto e copie manualmente.</span> : null}
      </span>
    </span>
  );
}
