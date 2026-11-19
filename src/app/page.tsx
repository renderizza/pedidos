import Link from "next/link";
import { AddToOrderButton } from "@/components/catalog/add-to-order-button";
import { GuestAddToOrderButton } from "@/components/catalog/guest-add-to-order-button";
import { GuestViewOrderButton } from "@/components/catalog/guest-view-order-button";
import { ProductCard } from "@/components/catalog/product-card";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { listCategories } from "@/lib/categories/service";
import { buildProductListHref, parseProductListParams } from "@/lib/products/list-params";
import { listProducts } from "@/lib/products/service";
import { addToDraftAction } from "./pedidos/novo/actions";

const PAGE_SIZE = 12;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseProductListParams(await searchParams);
  const user = await getCurrentUser();
  // Visitante (sem login) também faz pedido: o rascunho dele fica no navegador. Quem está logado
  // usa o rascunho do banco e precisa da permissão de criar pedido.
  const orderMode: "guest" | "user" | "none" = !user ? "guest" : hasPermission(user.role, "order:create") ? "user" : "none";

  const [result, categories] = await Promise.all([
    // A vitrine mostra somente produtos ATIVOS.
    listProducts({ search: query.search, categoryId: query.categoryId, status: "active", page: query.page, pageSize: PAGE_SIZE }),
    listCategories(),
  ]);
  const filtered = Boolean(query.search || query.categoryId);
  const hrefFor = (page: number) => buildProductListHref({ ...query, status: "all" }, page, "/");

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <header data-testid="home-header" className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Vitrine de produtos</h1>
        {orderMode === "user" ? (
          <Link href="/pedidos/novo" className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700">
            Montar pedido
          </Link>
        ) : orderMode === "guest" ? (
          // Visitante: o botão só aparece quando já há produto no pedido (guardado no navegador).
          <GuestViewOrderButton />
        ) : null}
      </header>

      <form method="get" role="search" aria-label="Filtrar vitrine" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">
            Buscar
          </label>
          <input id="q" name="q" type="search" defaultValue={query.search} placeholder="Referência ou descrição" className="mt-1 rounded-md border border-slate-300 px-3 py-2" />
        </div>
        <div>
          <label htmlFor="categoria" className="block text-sm font-medium">
            Categoria
          </label>
          <select id="categoria" name="categoria" defaultValue={query.categoryId ?? ""} className="mt-1 rounded-md border border-slate-300 px-3 py-2">
            <option value="">Todas</option>
            {categories
              .filter((category) => category.productCount > 0)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-900">
          Filtrar
        </button>
        {filtered ? (
          <Link href="/" className="py-2 text-sm text-slate-600 hover:underline">
            Limpar filtros
          </Link>
        ) : null}
      </form>

      <div className="mt-6">
        {result.items.length === 0 ? (
          <p data-testid="empty-state" className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            {filtered ? "Nenhum produto encontrado para esses filtros." : "Nenhum produto disponível no momento."}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                action={
                  orderMode === "user" ? (
                    <AddToOrderButton productId={product.id} reference={product.reference} addAction={addToDraftAction} />
                  ) : orderMode === "guest" ? (
                    <GuestAddToOrderButton productId={product.id} reference={product.reference} />
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500" data-testid="result-count">
          {result.total} produto(s)
        </p>
        <Pagination page={result.page} totalPages={result.totalPages} hrefFor={hrefFor} />
      </div>
    </main>
  );
}
