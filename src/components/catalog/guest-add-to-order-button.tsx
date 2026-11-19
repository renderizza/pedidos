"use client";

import { addToGuestCart } from "@/lib/orders/guest-cart";
import { AddToOrderButton } from "./add-to-order-button";

/**
 * "Adicionar ao pedido" para quem não está logado: soma 1 unidade ao pedido guardado neste
 * navegador (sem ir ao servidor). Reaproveita o botão do usuário logado, só troca a ação.
 */
export function GuestAddToOrderButton({ productId, reference }: { productId: string; reference: string }) {
  return (
    <AddToOrderButton
      productId={productId}
      reference={reference}
      addAction={async (id) => addToGuestCart(id)}
    />
  );
}
