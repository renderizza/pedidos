import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders/status";

const STYLE: Record<OrderStatus, string> = {
  PENDENTE: "bg-amber-100 text-amber-800",
  CONFIRMADO: "bg-emerald-100 text-emerald-800",
  CANCELADO: "bg-slate-200 text-slate-600",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span data-testid="order-status" className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[status]}`}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}
