"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/components/form-ui";
import type { FormState } from "@/lib/forms";

export function CategoryForm({
  action,
  initialName = "",
  submitLabel,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  initialName?: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="max-w-md space-y-4" noValidate>
      <FormError message={state?.error} />

      <Field label="Nome da categoria" name="name" errors={state?.fieldErrors?.name}>
        {(props) => (
          <input {...props} name="name" type="text" required maxLength={60} defaultValue={state?.values?.name ?? initialName} />
        )}
      </Field>

      <div className="flex items-center gap-4">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href="/admin/categorias" className="text-sm text-slate-600 hover:underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
