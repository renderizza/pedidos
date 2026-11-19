import { parsePage } from "@/lib/pagination";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/status";

type RawParams = Record<string, string | string[] | undefined>;

export type OrderListQuery = { search: string; status: OrderStatus | undefined; page: number };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Lê os filtros da URL com tolerância: valores inválidos viram o padrão em vez de erro. */
export function parseOrderListParams(raw: RawParams): OrderListQuery {
  const status = first(raw.status)?.toUpperCase();
  return {
    search: (first(raw.q) ?? "").trim().slice(0, 100),
    status: ORDER_STATUSES.find((candidate) => candidate === status),
    page: parsePage(raw.pagina),
  };
}

/** URL da lista preservando os filtros ativos (valores padrão são omitidos). */
export function buildOrderListHref(query: Omit<OrderListQuery, "page">, page = 1): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.status) params.set("status", query.status.toLowerCase());
  if (page > 1) params.set("pagina", String(page));
  const qs = params.toString();
  return qs ? `/pedidos?${qs}` : "/pedidos";
}
