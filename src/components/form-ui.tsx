"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-emerald-600 focus:outline-none aria-[invalid=true]:border-red-500";

export function FieldErrors({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <div id={id} className="mt-1 space-y-0.5">
      {messages.map((message) => (
        <p key={message} role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ))}
    </div>
  );
}

type FieldProps = {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
  children: (props: { id: string; className: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
};

/** Rótulo + controle + mensagens de erro, ligados por ids para acessibilidade. */
export function Field({ label, name, errors, hint, children }: FieldProps) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        className: INPUT_CLASS,
        "aria-invalid": errors?.length ? true : undefined,
        "aria-describedby": errors?.length ? errorId : undefined,
      })}
      {hint && !errors?.length ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      <FieldErrors id={errorId} messages={errors} />
    </div>
  );
}

export function SubmitButton({ children, pendingLabel = "Salvando..." }: { children: ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" data-testid="form-error" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}
