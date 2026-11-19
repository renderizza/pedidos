import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/guards";
import { collectsCustomerData, hasPermission } from "@/lib/auth/rbac";
import { getDraft } from "@/lib/orders/draft";
import { listOrderableProducts } from "@/lib/products/service";
import { finalizeGuestOrderAction, finalizeOrderAction, saveDraftAction } from "./actions";
import { GuestOrderBuilder } from "./guest-order-builder";
import { OrderBuilder } from "./order-builder";

export const metadata: Metadata = { title: "Montar pedido — Sistema de Pedidos" };

export default async function NewOrderPage() {
  // Não exige login: visitante (sem cadastro) também monta e finaliza pedido. Quem está logado
  // mantém o rascunho no banco; o visitante guarda o dele no próprio navegador.
  const user = await getCurrentUser();
  if (user && !hasPermission(user.role, "order:create")) forbidden();

  const [orderable, draft] = await Promise.all([
    listOrderableProducts(),
    user ? getDraft(user.id) : Promise.resolve(null),
  ]);

  if (!user) {
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-8">
        <h1 className="text-3xl font-bold">Montar pedido</h1>
        <p className="mt-2 mb-6 text-slate-600">
          Busque os produtos, informe as quantidades e acompanhe o total. Ao finalizar, o pedido é registrado e você recebe a mensagem pronta para enviar pelo WhatsApp.
        </p>
        <GuestOrderBuilder catalog={orderable} finalize={finalizeGuestOrderAction} />
      </main>
    );
  }

  // Garante que toda linha do rascunho esteja no catálogo, mesmo se passar do limite de listagem.
  const lines = draft?.lines ?? [];
  const known = new Set(orderable.map((product) => product.id));
  const catalog = [
    ...orderable,
    ...lines
      .filter((line) => !known.has(line.productId))
      .map((line) => ({
        id: line.productId,
        reference: line.reference,
        description: line.description,
        priceCents: line.priceCents,
        categoryName: line.categoryName,
      })),
  ];

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-3xl font-bold">Montar pedido</h1>
      <p className="mt-2 mb-6 text-slate-600">
        {collectsCustomerData(user.role)
          ? "Busque os produtos, informe as quantidades e acompanhe o total. O rascunho é salvo automaticamente; ao terminar, informe o cliente e finalize."
          : "Busque os produtos, informe as quantidades e acompanhe o total. O rascunho é salvo automaticamente; ao terminar, finalize o pedido."}
      </p>
      <OrderBuilder
        catalog={catalog}
        collectCustomer={collectsCustomerData(user.role)}
        initialRows={lines.map((line) => ({ productId: line.productId, quantity: line.quantity }))}
        unavailableCount={draft?.unavailableCount ?? 0}
        saveDraft={saveDraftAction}
        finalize={finalizeOrderAction}
      />
    </main>
  );
}
