import type { Metadata } from "next";
import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { FlashMessage } from "@/components/flash-message";
import { requirePermission } from "@/lib/auth/guards";
import { listCategories } from "@/lib/categories/service";
import { deleteCategoryAction } from "./actions";

export const metadata: Metadata = { title: "Categorias — Sistema de Pedidos" };

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  await requirePermission("category:manage");
  const { status } = await searchParams;
  const categories = await listCategories();

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-3xl font-bold">Categorias</h1>
        <Link href="/admin/categorias/nova" className="rounded-md bg-emerald-600 px-4 py-2 font-medium whitespace-nowrap text-white hover:bg-emerald-700">
          Nova categoria
        </Link>
      </div>

      <div className="mt-6">
        <FlashMessage status={status} />
        {categories.length === 0 ? (
          <p data-testid="empty-state" className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            Nenhuma categoria cadastrada ainda.
          </p>
        ) : (
          <table role="table" className="stack-table w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead role="rowgroup" className="bg-slate-100 text-slate-600">
              <tr role="row">
                <th role="columnheader" className="px-4 py-2 font-medium">Nome</th>
                <th role="columnheader" className="px-4 py-2 font-medium">Produtos</th>
                <th role="columnheader" className="px-4 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {categories.map((category) => (
                <tr role="row" key={category.id} className="border-t border-slate-100 align-top">
                  <td role="cell" data-label="Nome" className="px-4 py-2">{category.name}</td>
                  <td role="cell" data-label="Produtos" className="px-4 py-2">{category.productCount}</td>
                  <td role="cell" className="stack-actions flex gap-4 px-4 py-2">
                    <Link href={`/admin/categorias/${category.id}/editar`} className="py-1 text-emerald-700 hover:underline sm:py-0">
                      Editar
                    </Link>
                    <DeleteButton
                      action={deleteCategoryAction.bind(null, category.id)}
                      confirmMessage={`Excluir a categoria "${category.name}"?`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
