"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/components/form-ui";
import type { FormState } from "@/lib/forms";

export type ProductFormInitial = {
  reference: string;
  description: string;
  /** Já no formato do campo, ex.: "12,50". */
  price: string;
  categoryId: string;
  active: boolean;
};

const EMPTY: ProductFormInitial = { reference: "", description: "", price: "", categoryId: "", active: true };

export function ProductForm({
  action,
  categories,
  initial = EMPTY,
  submitLabel,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  categories: { id: string; name: string }[];
  initial?: ProductFormInitial;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const errors = state?.fieldErrors;
  // Após um erro de validação, o que o usuário digitou prevalece sobre os valores iniciais.
  const submitted = state?.values;
  const values: ProductFormInitial = submitted
    ? {
        reference: submitted.reference ?? "",
        description: submitted.description ?? "",
        price: submitted.price ?? "",
        categoryId: submitted.categoryId ?? "",
        active: submitted.active === "on",
      }
    : initial;

  return (
    <form action={formAction} className="max-w-xl space-y-4" noValidate>
      <FormError message={state?.error} />

      <Field label="Referência" name="reference" errors={errors?.reference} hint="Código único do produto (será gravado em maiúsculas).">
        {(props) => <input {...props} name="reference" type="text" required maxLength={40} defaultValue={values.reference} />}
      </Field>

      <Field label="Descrição" name="description" errors={errors?.description}>
        {(props) => <textarea {...props} name="description" required rows={3} maxLength={500} defaultValue={values.description} />}
      </Field>

      <Field label="Preço (R$)" name="price" errors={errors?.price} hint="Ex.: 12,50">
        {(props) => <input {...props} name="price" type="text" inputMode="decimal" required defaultValue={values.price} />}
      </Field>

      <Field label="Categoria" name="categoryId" errors={errors?.categoryId}>
        {(props) => (
          // `key`: o React não atualiza a opção selecionada de um <select> já montado quando o
          // defaultValue muda; remontar garante que a escolha do usuário sobreviva a um erro.
          <select key={`categoria-${values.categoryId}`} {...props} name="categoryId" defaultValue={values.categoryId}>
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="active" defaultChecked={values.active} className="h-4 w-4" />
        Produto ativo (visível na vitrine)
      </label>

      <div className="flex items-center gap-4">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/produtos" className="text-sm text-slate-600 hover:underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
