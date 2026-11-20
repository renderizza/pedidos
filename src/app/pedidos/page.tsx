import type { Metadata } from "next";
import Link from "next/link";
import { OrdersTable } from "@/components/orders/orders-table";
import { Pagination } from "@/components/pagination";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { buildOrderListHref, parseOrderListParams } from "@/lib/orders/list-params";
import { listOrdersFor } from "@/lib/orders/history";
import { ORDER_STATUS_LABEL, ORDER_STATUSES } from "@/lib/orders/status";
import { updateOrderStatusAction } from "./actions";

export const metadata: Metadata = { title: "Pedidos — Sistema de Pedidos" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("order:read:own");
  const query = parseOrderListParams(await searchParams);
  // A visibilidade é decidida DENTRO de listOrdersFor: ADMIN vê todos; os demais, só os próprios.
  const result = await listOrdersFor(user, { search: query.search, status: query.status, page: query.page });
  const seesAll = hasPermission(user.role, "order:read:all");
  // Quem gerencia pedidos (ADMIN: todos; CONSULTOR: os seus) altera a situação aqui. A lista só traz pedidos que o
  // usuário enxerga, então ele pode alterar todos os que vê; mesmo assim a Server Action confere a posse a cada chamada.
  const canManage = hasPermission(user.role, "order:manage:own") || hasPermission(user.role, "order:manage:all");
  const filtered = Boolean(query.search || query.status);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-3xl font-bold">{seesAll ? "Todos os pedidos" : "Meus pedidos"}</h1>
        {hasPermission(user.role, "order:create") ? (
          <Link href="/pedidos/novo" className="rounded-md bg-emerald-600 px-4 py-2 font-medium whitespace-nowrap text-white hover:bg-emerald-700">
            Novo pedido
          </Link>
        ) : null}
      </div>

      <form method="get" role="search" aria-label="Filtrar pedidos" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">
            Buscar
          </label>
          <input id="q" name="q" type="search" defaultValue={query.search} placeholder="Cliente ou nº do pedido" className="mt-1 rounded-md border border-slate-300 px-3 py-2" />
        </div>
        <div>
          <label htmlFor="status" className="block text-sm font-medium">
            Situação
          </label>
          <select id="status" name="status" defaultValue={query.status?.toLowerCase() ?? ""} className="mt-1 rounded-md border border-slate-300 px-3 py-2">
            <option value="">Todas</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status.toLowerCase()}>
                {ORDER_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-900">
          Filtrar
        </button>
        {filtered ? (
          <Link href="/pedidos" className="py-2 text-sm text-slate-600 hover:underline">
            Limpar filtros
          </Link>
        ) : null}
      </form>

      <div className="mt-6">
        {result.items.length === 0 ? (
          <p data-testid="empty-state" className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            {filtered ? "Nenhum pedido encontrado para esses filtros." : "Nenhum pedido registrado ainda."}
          </p>
        ) : (
          <OrdersTable orders={result.items} showRequester={seesAll} updateStatus={canManage ? updateOrderStatusAction : undefined} />
        )}
        <p className="mt-2 text-xs text-slate-500" data-testid="result-count">
          {result.total} pedido(s)
        </p>
        <Pagination page={result.page} totalPages={result.totalPages} hrefFor={(page) => buildOrderListHref(query, page)} />
      </div>
    </main>
  );
}
