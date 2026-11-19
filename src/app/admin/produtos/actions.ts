"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getString, type FormState } from "@/lib/forms";
import {
  createProduct,
  deleteProduct,
  DuplicateReferenceError,
  ProductCategoryNotFoundError,
  ProductNotFoundError,
  updateProduct,
} from "@/lib/products/service";
import { fieldErrors, uuidSchema } from "@/lib/validation/common";
import { productFormSchema } from "@/lib/validation/product";

const LIST_PATH = "/admin/produtos";

function parseProductForm(formData: FormData) {
  const values: Record<string, string> = {
    reference: getString(formData, "reference"),
    description: getString(formData, "description"),
    price: getString(formData, "price"),
    categoryId: getString(formData, "categoryId"),
    active: getString(formData, "active"),
  };
  return { values, parsed: productFormSchema.safeParse(values) };
}

/** Converte erros de domínio conhecidos em mensagens de formulário; os demais são relançados. */
function toFormState(error: unknown, values: Record<string, string>): FormState {
  if (error instanceof DuplicateReferenceError) return { fieldErrors: { reference: [error.message] }, values };
  if (error instanceof ProductCategoryNotFoundError) return { fieldErrors: { categoryId: [error.message] }, values };
  if (error instanceof ProductNotFoundError) return { error: error.message, values };
  throw error;
}

// Server Actions são endpoints públicos: TODA ação confere a permissão antes de qualquer outra coisa.

export async function createProductAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("product:manage");

  const { values, parsed } = parseProductForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  try {
    await createProduct(parsed.data);
  } catch (error) {
    return toFormState(error, values);
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?status=created`);
}

export async function updateProductAction(
  id: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePermission("product:manage");

  const { values, parsed } = parseProductForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  try {
    await updateProduct(id, parsed.data);
  } catch (error) {
    return toFormState(error, values);
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?status=updated`);
}

export async function deleteProductAction(id: string, _previous: FormState): Promise<FormState> {
  await requirePermission("product:manage");

  if (!uuidSchema.safeParse(id).success) return { error: "Produto não encontrado" };
  try {
    await deleteProduct(id);
  } catch (error) {
    if (error instanceof ProductNotFoundError) return { error: error.message };
    throw error;
  }

  revalidatePath(LIST_PATH);
  return undefined;
}
