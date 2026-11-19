import Link from "next/link";
import { formatCents } from "@/lib/money";
import type { OrderSummary } from "@/lib/orders/history";
import { requesterLabel } from "@/lib/orders/requester";
import { formatOrderDate } from "@/lib/whatsapp";
import { OrderStatusBadge } from "./status-badge";

/** Lista de pedidos. `showRequester` (ADMIN) acrescenta quem lançou o pedido. */
export function OrdersTable({ orders, showRequester }: { orders: OrderSummary[]; showRequester: boolean }) {
  return (
    <table role="table" aria-label="Pedidos" className="stack-table w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-sm">
      <thead role="rowgroup" className="bg-slate-100 text-slate-600">
        <tr role="row">
          <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Nº</th>
          <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Data</th>
          <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Cliente</th>
          {showRequester ? <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Lançado por</th> : null}
          <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Itens</th>
          <th role="columnheader" scope="col" className="px-4 py-2 text-right font-medium">Total</th>
          <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Situação</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {orders.map((order) => (
          <tr role="row" key={order.id} className="border-t border-slate-100">
            <td role="cell" data-label="Nº" className="px-4 py-2 font-mono">
              <Link href={`/pedidos/${order.id}`} className="inline-block py-1 text-emerald-700 hover:underline sm:py-0">
                #{order.orderNumber}
              </Link>
            </td>
            <td role="cell" data-label="Data" className="px-4 py-2 whitespace-nowrap">{formatOrderDate(order.createdAt)}</td>
            <td role="cell" data-label="Cliente" className="px-4 py-2">{order.customerName ?? "—"}</td>
            {showRequester ? <td role="cell" data-label="Lançado por" className="px-4 py-2">{requesterLabel(order.requesterName)}</td> : null}
            <td role="cell" data-label="Itens" className="px-4 py-2">
              {order.lineCount} produto(s) · {order.unitCount} un.
            </td>
            <td role="cell" data-label="Total" className="px-4 py-2 text-right tabular-nums">{formatCents(order.totalCents)}</td>
            <td role="cell" data-label="Situação" className="px-4 py-2">
              <OrderStatusBadge status={order.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
