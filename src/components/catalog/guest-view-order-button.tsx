"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { guestCartHasItems, subscribeToGuestCart } from "@/lib/orders/guest-cart";

/**
 * "Ver pedido" do visitante: só aparece quando há produto no pedido guardado neste navegador,
 * e reage na hora a "Adicionar ao pedido" (mesma aba) e a mudanças feitas em outras abas.
 * No servidor (e na primeira renderização) não há como saber, então começa escondido.
 */
export function GuestViewOrderButton() {
  const hasItems = useSyncExternalStore(subscribeToGuestCart, guestCartHasItems, () => false);
  if (!hasItems) return null;
  return (
    <Link href="/pedidos/novo" className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700">
      Ver pedido
    </Link>
  );
}
