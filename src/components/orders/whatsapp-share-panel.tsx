import { CopyMessageButton } from "./copy-message-button";

/**
 * Mensagem do pedido pronta para o WhatsApp: texto, link para a loja, atalho opcional para o
 * cliente e botão de copiar. Usado no detalhe do pedido (logado) e na confirmação do visitante.
 */
export function WhatsAppSharePanel({
  message,
  storeUrl,
  customerUrl,
}: {
  message: string;
  /** Link que abre o WhatsApp da loja (ou o seletor de contato, se o número não estiver configurado). */
  storeUrl: string;
  /** Link para a conversa com o cliente; `null` quando o pedido não tem telefone válido. */
  customerUrl: string | null;
}) {
  return (
    <section aria-labelledby="whatsapp-title" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 id="whatsapp-title" className="text-lg font-semibold">
        Enviar pelo WhatsApp
      </h2>
      <pre data-testid="whatsapp-message" className="max-h-96 overflow-auto rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">{message}</pre>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="whatsapp-link"
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          Enviar pelo WhatsApp
        </a>
        {customerUrl ? (
          <a
            href={customerUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="whatsapp-customer-link"
            className="rounded-md border border-green-600 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
          >
            Enviar ao cliente
          </a>
        ) : null}
        <CopyMessageButton message={message} />
      </div>
    </section>
  );
}
