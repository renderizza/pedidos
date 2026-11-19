import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { listCategories } from "@/lib/categories/service";
import { centsToInputValue } from "@/lib/money";
import { getProduct } from "@/lib/products/service";
import { updateProductAction } from "../../actions";
import { ProductForm } from "../../product-form";

export const metadata: Metadata = { title: "Editar produto — Sistema de Pedidos" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("product:manage");
  const { id } = await params;
  const [product, categories] = await Promise.all([getProduct(id), listCategories()]);
  if (!product) notFound();

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="mb-6 text-3xl font-bold">Editar produto</h1>
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        categories={categories}
        initial={{
          reference: product.reference,
          description: product.description,
          price: centsToInputValue(product.priceCents),
          categoryId: product.categoryId ?? "",
          active: product.active,
        }}
        submitLabel="Salvar alterações"
      />
    </main>
  );
}
