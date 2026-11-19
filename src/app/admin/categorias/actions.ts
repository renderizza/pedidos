"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import {
  CategoryInUseError,
  CategoryNotFoundError,
  createCategory,
  deleteCategory,
  DuplicateCategoryError,
  updateCategory,
} from "@/lib/categories/service";
import { getString, type FormState } from "@/lib/forms";
import { fieldErrors, uuidSchema } from "@/lib/validation/common";
import { categoryInputSchema } from "@/lib/validation/category";

const LIST_PATH = "/admin/categorias";

function parseCategoryForm(formData: FormData) {
  const values = { name: getString(formData, "name") };
  return { values, parsed: categoryInputSchema.safeParse(values) };
}

// Server Actions são endpoints públicos: TODA ação confere a permissão antes de qualquer outra coisa.

export async function createCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  await requirePermission("category:manage");

  const { values, parsed } = parseCategoryForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  try {
    await createCategory(parsed.data);
  } catch (error) {
    if (error instanceof DuplicateCategoryError) return { fieldErrors: { name: [error.message] }, values };
    throw error;
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?status=created`);
}

export async function updateCategoryAction(
  id: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePermission("category:manage");

  const { values, parsed } = parseCategoryForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  try {
    await updateCategory(id, parsed.data);
  } catch (error) {
    if (error instanceof DuplicateCategoryError) return { fieldErrors: { name: [error.message] }, values };
    if (error instanceof CategoryNotFoundError) return { error: error.message, values };
    throw error;
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?status=updated`);
}

export async function deleteCategoryAction(id: string, _previous: FormState): Promise<FormState> {
  await requirePermission("category:manage");

  if (!uuidSchema.safeParse(id).success) return { error: "Categoria não encontrada" };
  try {
    await deleteCategory(id);
  } catch (error) {
    if (error instanceof CategoryInUseError || error instanceof CategoryNotFoundError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(LIST_PATH);
  return undefined;
}
