import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guards";
import { listCategories } from "@/lib/categories/service";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Novo produto — Sistema de Pedidos" };

export default async function NewProductPage() {
  await requirePermission("product:manage");
  const categories = await listCategories();

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="mb-6 text-3xl font-bold">Novo produto</h1>
      <ProductForm action={createProductAction} categories={categories} submitLabel="Criar produto" />
    </main>
  );
}
