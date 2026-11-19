import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getCategory } from "@/lib/categories/service";
import { updateCategoryAction } from "../../actions";
import { CategoryForm } from "../../category-form";

export const metadata: Metadata = { title: "Editar categoria — Sistema de Pedidos" };

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("category:manage");
  const { id } = await params;
  const category = await getCategory(id);
  if (!category) notFound();

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="mb-6 text-3xl font-bold">Editar categoria</h1>
      <CategoryForm
        action={updateCategoryAction.bind(null, category.id)}
        initialName={category.name}
        submitLabel="Salvar alterações"
      />
    </main>
  );
}
