"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/forms";

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-red-600 hover:underline disabled:opacity-60">
      {pending ? "Excluindo..." : label}
    </button>
  );
}

/**
 * Botão de exclusão com confirmação nativa. `action` já vem com o id embutido (bind);
 * se o servidor recusar (ex.: categoria com produtos), a mensagem aparece abaixo do botão.
 */
export function DeleteButton({
  action,
  confirmMessage,
  label = "Excluir",
}: {
  action: (previous: FormState) => Promise<FormState>;
  confirmMessage: string;
  label?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
      className="inline-block"
    >
      <Button label={label} />
      {state?.error ? (
        <p role="alert" className="mt-1 max-w-xs text-xs text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
