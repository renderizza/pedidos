"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { Field, FormError, SubmitButton } from "@/components/form-ui";
import type { FormState } from "@/lib/forms";
import { normalizeImageUrl } from "@/lib/images/image-url";

export type ProductFormInitial = {
  reference: string;
  description: string;
  /** Já no formato do campo, ex.: "12,50". */
  price: string;
  /** Endereço da imagem; vazio = produto sem imagem. */
  imageUrl: string;
  categoryId: string;
  active: boolean;
};

const EMPTY: ProductFormInitial = { reference: "", description: "", price: "", imageUrl: "", categoryId: "", active: true };

/**
 * Prévia da imagem como ela aparecerá na vitrine. Mostra na hora, sem esperar o envio do formulário,
 * se o link do Drive é reconhecido e se a imagem realmente carrega (arquivo não compartilhado = quadro cinza).
 *
 * A ALTURA É FIXA, mesmo sem imagem. A prévia atualiza ao SAIR do campo, que é o mesmo instante em que o clique
 * em "Criar produto" começa: se ela empurrasse o botão para baixo entre o mousedown e o mouseup, o clique se
 * perderia e o usuário teria de clicar duas vezes.
 */
function ImagePreview({ url, suppressWarning = false }: { url: string; suppressWarning?: boolean }) {
  const text = url.trim();
  const result = text ? normalizeImageUrl(text) : null;
  return (
    <div data-testid="image-preview-slot" className="mt-2 flex h-20 items-center gap-3">
      {result?.ok ? (
        <div data-testid="image-preview" className="shrink-0">
          <ProductImage url={result.url} width={80} className="h-20 w-20 rounded-md border border-slate-200" />
        </div>
      ) : (
        <div aria-hidden="true" className="h-20 w-20 shrink-0 rounded-md border border-dashed border-slate-300" />
      )}
      {result?.ok ? (
        <p className="text-xs text-slate-500">
          Pré-visualização. Se aparecer só um quadro cinza, o arquivo não está compartilhado como “Qualquer pessoa com o link”.
        </p>
      ) : result && !suppressWarning ? (
        <p data-testid="image-preview-warning" className="text-sm text-amber-700">
          {result.error}
        </p>
      ) : (
        <p className="text-xs text-slate-400">A pré-visualização da imagem aparece aqui.</p>
      )}
    </div>
  );
}

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
        imageUrl: submitted.imageUrl ?? "",
        categoryId: submitted.categoryId ?? "",
        active: submitted.active === "on",
      }
    : initial;
  // A prévia acompanha o campo ao SAIR dele (não a cada tecla): um link pela metade não deve disparar requisições.
  const [previewUrl, setPreviewUrl] = useState(values.imageUrl);

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

      <div>
        <Field
          label="URL da imagem (opcional)"
          name="imageUrl"
          errors={errors?.imageUrl}
          hint="Cole o link do Google Drive: com o botão direito na imagem → Compartilhar → “Qualquer pessoa com o link” → Copiar link."
        >
          {(props) => (
            <input
              {...props}
              name="imageUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={2048}
              placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
              defaultValue={values.imageUrl}
              onBlur={(event) => setPreviewUrl(event.target.value)}
            />
          )}
        </Field>
        {/* Com erro de validação do servidor, a mensagem do campo já diz o problema: a prévia não repete o aviso. */}
        <ImagePreview url={previewUrl} suppressWarning={Boolean(errors?.imageUrl?.length)} />
      </div>

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
