import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guards";
import { createCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";

export const metadata: Metadata = { title: "Nova categoria — Sistema de Pedidos" };

export default async function NewCategoryPage() {
  await requirePermission("category:manage");

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="mb-6 text-3xl font-bold">Nova categoria</h1>
      <CategoryForm action={createCategoryAction} submitLabel="Criar categoria" />
    </main>
  );
}
