import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import { WhatsAppSharePanel } from "@/components/orders/whatsapp-share-panel";
import { requirePermission } from "@/lib/auth/guards";
import { getEnv } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { getOrderFor, type OrderDetail } from "@/lib/orders/history";
import { requesterLabel } from "@/lib/orders/requester";
import { buildWhatsAppUrl, formatBrazilPhone, formatOrderDate, formatOrderMessage, normalizeBrazilPhone } from "@/lib/whatsapp";

export const metadata: Metadata = { title: "Pedido — Sistema de Pedidos" };

/**
 * Mensagem e links do WhatsApp do pedido. Pedido interno (CONSULTOR) não tem cliente e não segue
 * por WhatsApp: devolve `null`, e a página não mostra mensagem nem links.
 */
function buildWhatsApp(order: OrderDetail) {
  if (order.customerName === null) return null;
  const message = formatOrderMessage({
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    notes: order.notes,
    requesterName: order.requesterName,
    totalCents: order.totalCents,
    items: order.items,
  });
  return {
    message,
    storeUrl: buildWhatsAppUrl(message, getEnv().WHATSAPP_ORDERS_NUMBER),
    customerUrl: order.customerPhone && normalizeBrazilPhone(order.customerPhone) ? buildWhatsAppUrl(message, order.customerPhone) : null,
  };
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ novo?: string | string[] }>;
}) {
  const user = await requirePermission("order:read:own");
  const [{ id }, { novo }] = await Promise.all([params, searchParams]);

  // Pedido inexistente e pedido de outra pessoa são indistinguíveis: ambos respondem 404.
  const order = await getOrderFor(user, id);
  if (!order) notFound();

  const whatsapp = buildWhatsApp(order);
  const customerName = order.customerName;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      {novo === "1" ? (
        <p role="status" data-testid="order-created-banner" className="rounded-md bg-emerald-50 px-4 py-3 font-medium text-emerald-800">
          Pedido #{order.orderNumber} registrado com sucesso!{whatsapp ? " Envie o resumo pelo WhatsApp abaixo." : ""}
        </p>
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Pedido #{order.orderNumber}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <Link href="/pedidos" className="text-sm text-emerald-700 hover:underline">
          ← Voltar para os pedidos
        </Link>
      </header>

      <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Data</dt>
          <dd data-testid="order-date">{formatOrderDate(order.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Lançado por</dt>
          <dd data-testid="order-requester">{requesterLabel(order.requesterName)}</dd>
        </div>
        {customerName !== null ? (
          <>
            <div>
              <dt className="text-slate-500">Cliente</dt>
              <dd data-testid="order-customer">{customerName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Telefone</dt>
              <dd data-testid="order-phone">{order.customerPhone ? formatBrazilPhone(order.customerPhone) : "—"}</dd>
            </div>
          </>
        ) : null}
        {order.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Observações</dt>
            <dd className="whitespace-pre-line" data-testid="order-notes">{order.notes}</dd>
          </div>
        ) : null}
      </dl>

      <table role="table" aria-label="Itens do pedido" className="stack-table w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead role="rowgroup" className="bg-slate-100 text-slate-600">
          <tr role="row">
            <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Referência</th>
            <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Descrição do Produto</th>
            <th role="columnheader" scope="col" className="px-4 py-2 text-right font-medium">Valor Unitário</th>
            <th role="columnheader" scope="col" className="px-4 py-2 text-right font-medium">Quantidade</th>
            <th role="columnheader" scope="col" className="px-4 py-2 text-right font-medium">Valor Total</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {order.items.map((item) => (
            <tr role="row" key={item.id} className="border-t border-slate-100">
              <td role="cell" data-label="Referência" className="stack-wide px-4 py-2 font-mono">{item.reference}</td>
              <td role="cell" data-label="Descrição do Produto" className="stack-wide px-4 py-2">{item.description}</td>
              <td role="cell" data-label="Valor Unitário" className="px-4 py-2 text-right tabular-nums">{formatCents(item.unitPriceCents)}</td>
              <td role="cell" data-label="Quantidade" className="px-4 py-2 text-right tabular-nums">{item.quantity}</td>
              <td role="cell" data-label="Valor Total" data-testid="line-total" className="stack-wide px-4 py-2 text-right tabular-nums">{formatCents(item.lineTotalCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot role="rowgroup" className="border-t-2 border-slate-200 bg-slate-50">
          <tr role="row">
            <th role="rowheader" scope="row" colSpan={4} className="px-4 py-3 text-right font-semibold">
              Total do pedido
            </th>
            <td role="cell" data-testid="order-total" className="px-4 py-3 text-right text-base font-bold tabular-nums">
              {formatCents(order.totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>

      {whatsapp ? <WhatsAppSharePanel message={whatsapp.message} storeUrl={whatsapp.storeUrl} customerUrl={whatsapp.customerUrl} /> : null}
    </main>
  );
}
