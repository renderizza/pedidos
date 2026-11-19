"use client";

import { useEffect, useRef, useState } from "react";
import { clearGuestCart, readGuestCart, writeGuestCart, type GuestCartItem } from "@/lib/orders/guest-cart";
import type { OrderableProduct } from "@/lib/products/service";
import type { DraftSaveResult, FinalizeResult } from "./actions";
import { OrderBuilder, type FinalizeInput } from "./order-builder";

type Loaded = { rows: GuestCartItem[]; unavailableCount: number };

/**
 * Tabela de pedido para quem NÃO tem cadastro. É o mesmo `OrderBuilder` de quem está logado;
 * só mudam as duas pontas: o "rascunho" fica no navegador (localStorage) e, ao finalizar, os itens
 * seguem junto com os dados do cliente, porque o servidor não tem rascunho desse visitante.
 */
export function GuestOrderBuilder({
  catalog,
  finalize,
}: {
  catalog: OrderableProduct[];
  finalize: (input: FinalizeInput & { items: GuestCartItem[] }) => Promise<FinalizeResult>;
}) {
  // localStorage só existe no navegador: lê depois da montagem (e não durante a renderização no servidor).
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Itens que o OrderBuilder gravou por último = o que está na tela. O builder grava antes de finalizar,
  // então este é sempre o pedido que o visitante está vendo (e não o que outra aba possa ter gravado).
  const latestItems = useRef<GuestCartItem[]>([]);

  useEffect(() => {
    const known = new Set(catalog.map((product) => product.id));
    const stored = readGuestCart();
    const rows = stored.filter((item) => known.has(item.productId));
    latestItems.current = rows;
    setLoaded({ rows, unavailableCount: stored.length - rows.length });
    // Só na montagem: depois disso, o OrderBuilder é a fonte da verdade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) {
    return (
      <p role="status" className="text-slate-500">
        Carregando seu pedido…
      </p>
    );
  }

  async function saveDraft(items: GuestCartItem[]): Promise<DraftSaveResult> {
    latestItems.current = items;
    return writeGuestCart(items)
      ? { ok: true }
      : { ok: false, error: "Não foi possível guardar o pedido neste navegador" };
  }

  async function finalizeOrder(input: FinalizeInput): Promise<FinalizeResult> {
    const result = await finalize({ ...input, items: latestItems.current });
    if (result.ok) clearGuestCart(); // o pedido já está no banco
    return result;
  }

  return (
    <OrderBuilder
      catalog={catalog}
      initialRows={loaded.rows}
      unavailableCount={loaded.unavailableCount}
      saveDraft={saveDraft}
      finalize={finalizeOrder}
    />
  );
}
