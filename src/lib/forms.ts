/** Estado devolvido pelas Server Actions de formulário (useActionState). */
export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[]>;
      /** Valores digitados, para repopular o formulário após um erro de validação. */
      values?: Record<string, string>;
    }
  | undefined;

/** Lê um campo de texto do FormData (ausente ou arquivo → string vazia). */
export function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
