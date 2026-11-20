import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-image";
import { DeleteButton } from "@/components/delete-button";
import { FlashMessage } from "@/components/flash-message";
import { Pagination } from "@/components/pagination";
import { requirePermission } from "@/lib/auth/guards";
import { listCategories } from "@/lib/categories/service";
import { formatCents } from "@/lib/money";
import { buildProductListHref, parseProductListParams } from "@/lib/products/list-params";
import { listProducts } from "@/lib/products/service";
import { deleteProductAction } from "./actions";

export const metadata: Metadata = { title: "Produtos — Sistema de Pedidos" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("product:manage");
  const raw = await searchParams;
  const query = parseProductListParams(raw);
  const [result, categories] = await Promise.all([
    listProducts({ search: query.search, categoryId: query.categoryId, status: query.status, page: query.page }),
    listCategories(),
  ]);
  const filtered = Boolean(query.search || query.categoryId || query.status !== "all");

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-3xl font-bold">Produtos</h1>
        <Link href="/admin/produtos/novo" className="rounded-md bg-emerald-600 px-4 py-2 font-medium whitespace-nowrap text-white hover:bg-emerald-700">
          Novo produto
        </Link>
      </div>

      <form method="get" role="search" aria-label="Filtrar produtos" className="mt-6 flex flex-wrap items-end gap-3">
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
            <option value="none">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="block text-sm font-medium">
            Situação
          </label>
          <select
            id="status"
            name="status"
            defaultValue={{ all: "todos", active: "ativos", inactive: "inativos" }[query.status]}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="todos">Todos</option>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
          </select>
        </div>
        <button type="submit" className="rounded-md bg-slate-800 px-4 py-2 text-white hover:bg-slate-900">
          Filtrar
        </button>
        {filtered ? (
          <Link href="/admin/produtos" className="py-2 text-sm text-slate-600 hover:underline">
            Limpar filtros
          </Link>
        ) : null}
      </form>

      <div className="mt-6">
        <FlashMessage status={raw.status === "created" || raw.status === "updated" ? raw.status : undefined} />
        {result.items.length === 0 ? (
          <p data-testid="empty-state" className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            {filtered ? "Nenhum produto encontrado para esses filtros." : "Nenhum produto cadastrado ainda."}
          </p>
        ) : (
          <table role="table" className="stack-table w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead role="rowgroup" className="bg-slate-100 text-slate-600">
              <tr role="row">
                <th role="columnheader" className="px-4 py-2 font-medium">Referência</th>
                <th role="columnheader" className="px-4 py-2 font-medium">Descrição</th>
                <th role="columnheader" className="px-4 py-2 font-medium">Categoria</th>
                <th role="columnheader" className="px-4 py-2 text-right font-medium">Preço</th>
                <th role="columnheader" className="px-4 py-2 font-medium">Situação</th>
                <th role="columnheader" className="px-4 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {result.items.map((product) => (
                <tr role="row" key={product.id} className="border-t border-slate-100 align-top">
                  <td role="cell" data-label="Referência" className="stack-wide px-4 py-2 font-mono">{product.reference}</td>
                  <td role="cell" data-label="Descrição" className="stack-wide px-4 py-2">
                    <div className="flex items-start gap-3">
                      {/* Aqui o fallback fica visível: se o link do Drive não carregar, quem cadastra percebe. */}
                      <ProductImage url={product.imageUrl} width={48} className="h-12 w-12 shrink-0 rounded" />
                      <span>{product.description}</span>
                    </div>
                  </td>
                  <td role="cell" data-label="Categoria" className="px-4 py-2">{product.categoryName ?? "—"}</td>
                  <td role="cell" data-label="Preço" className="px-4 py-2 text-right tabular-nums">{formatCents(product.priceCents)}</td>
                  <td role="cell" data-label="Situação" className="px-4 py-2">{product.active ? "Ativo" : "Inativo"}</td>
                  <td role="cell" className="stack-actions flex gap-4 px-4 py-2">
                    <Link href={`/admin/produtos/${product.id}/editar`} className="py-1 text-emerald-700 hover:underline sm:py-0">
                      Editar
                    </Link>
                    <DeleteButton
                      action={deleteProductAction.bind(null, product.id)}
                      confirmMessage={`Excluir o produto "${product.reference}"?`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-slate-500" data-testid="result-count">
          {result.total} produto(s)
        </p>
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hrefFor={(page) => buildProductListHref(query, page)}
        />
      </div>
    </main>
  );
}
