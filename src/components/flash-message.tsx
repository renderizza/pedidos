const MESSAGES: Record<string, string> = {
  created: "Cadastro realizado com sucesso.",
  updated: "Alterações salvas com sucesso.",
};

/** Mensagem de sucesso vinda de `?status=` (apenas valores conhecidos são exibidos). */
export function FlashMessage({ status }: { status?: string | string[] }) {
  const message = typeof status === "string" ? MESSAGES[status] : undefined;
  if (!message) return null;
  return (
    <p role="status" data-testid="flash-message" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {message}
    </p>
  );
}
