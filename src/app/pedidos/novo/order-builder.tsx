"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WhatsAppSharePanel } from "@/components/orders/whatsapp-share-panel";
import { formatCents } from "@/lib/money";
import { calculateOrder, parseQuantity } from "@/lib/orders/calculation";
import { searchCatalog } from "@/lib/orders/search";
import type { OrderableProduct } from "@/lib/products/service";
import type { DraftSaveResult, FinalizeResult, GuestReceipt } from "./actions";

type DraftItem = { productId: string; quantity: number };
type Row = { productId: string; quantityText: string };
type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "invalid" | "limit";
export type FinalizeInput = {
  customerName: string;
  customerPhone: string;
  notes: string;
  expectedTotalCents: number;
};

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  pending: "Alterações não salvas…",
  saving: "Salvando…",
  saved: "Rascunho salvo",
  error: "Não foi possível salvar o rascunho",
  invalid: "Corrija as quantidades para salvar o rascunho",
  limit: "O total excede o limite permitido; reduza as quantidades",
};

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-none aria-[invalid=true]:border-red-500 disabled:bg-slate-100";

export function OrderBuilder({
  catalog,
  initialRows,
  unavailableCount = 0,
  saveDraft,
  finalize,
  collectCustomer = true,
  debounceMs = 600,
}: {
  catalog: OrderableProduct[];
  initialRows: DraftItem[];
  /** Quantas linhas do rascunho foram descartadas por o produto ter sido desativado. */
  unavailableCount?: number;
  saveDraft: (items: DraftItem[]) => Promise<DraftSaveResult>;
  finalize: (input: FinalizeInput) => Promise<FinalizeResult>;
  /**
   * Mostra os dados do cliente (nome, telefone e observações) antes de finalizar. Com `false`
   * (pedido interno do CONSULTOR) fica só o botão "Finalizar pedido".
   */
  collectCustomer?: boolean;
  debounceMs?: number;
}) {
  const uid = useId();
  const router = useRouter();
  const listboxId = `${uid}-suggestions`;
  const catalogById = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);

  const [rows, setRows] = useState<Row[]>(() =>
    initialRows
      .filter((item) => catalogById.has(item.productId))
      .map((item) => ({ productId: item.productId, quantityText: String(item.quantity) })),
  );
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string>();
  // `version` sobe a cada edição do usuário e dispara o salvamento automático.
  // Começa em 1 se o servidor descartou linhas, para gravar o rascunho já limpo.
  const [version, setVersion] = useState(unavailableCount > 0 ? 1 : 0);
  const [focusProductId, setFocusProductId] = useState<string>();

  // Dados do cliente do pedido e estado da finalização.
  const [customer, setCustomer] = useState({ name: "", phone: "", notes: "" });
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string>();
  const [customerErrors, setCustomerErrors] = useState<Record<string, string[]>>();
  // Pedido de visitante: não há página de detalhe, então a confirmação com a mensagem do WhatsApp aparece aqui.
  const [receipt, setReceipt] = useState<GuestReceipt & { orderNumber: number }>();

  // ── Cálculo (a lógica pura vive em lib/orders/calculation) ─────────────────
  const parsed = rows.flatMap((row) => {
    const product = catalogById.get(row.productId);
    return product ? [{ row, product, quantity: parseQuantity(row.quantityText) }] : [];
  });
  const hasInvalid = parsed.some((entry) => entry.quantity === null);
  const totals = calculateOrder(
    parsed.flatMap(({ product, quantity }) =>
      quantity === null
        ? []
        : [
            {
              productId: product.id,
              reference: product.reference,
              description: product.description,
              unitPriceCents: product.priceCents,
              quantity,
            },
          ],
    ),
  );
  const lineTotalById = new Map(totals.lines.map((line) => [line.productId, line.lineTotalCents]));
  const itemsToSave: DraftItem[] = totals.lines.map((line) => ({ productId: line.productId, quantity: line.quantity }));

  // ── Seletor de produtos ────────────────────────────────────────────────────
  const inOrder = useMemo(() => new Set(rows.map((row) => row.productId)), [rows]);
  const suggestions = useMemo(
    () => searchCatalog(catalog, query, { exclude: inOrder }),
    [catalog, query, inOrder],
  );

  // ── Salvamento automático (com fila: nunca há duas requisições em paralelo) ─
  const latest = useRef({ itemsToSave, saveDraft });
  latest.current = { itemsToSave, saveDraft };
  const savePromise = useRef<Promise<boolean> | null>(null);
  const lastSaveOk = useRef(true);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  // Depois que o pedido é gravado, o rascunho foi apagado: nenhum salvamento tardio pode recriá-lo.
  const finalized = useRef(false);
  // Guard SÍNCRONO contra envio duplo: o estado `finalizing` só muda no próximo render,
  // e dois envios no mesmo instante (duplo clique, Enter repetido) leriam `false` nos dois.
  const submitting = useRef(false);

  function runSave(): Promise<boolean> {
    if (savePromise.current) {
      queued.current = true; // a edição durante o envio entra na fila
      return savePromise.current;
    }
    const promise = (async () => {
      let ok = true;
      let error: string | undefined;
      do {
        queued.current = false;
        if (finalized.current) return true;
        if (mounted.current) setStatus("saving");
        try {
          const result = await latest.current.saveDraft(latest.current.itemsToSave);
          ok = result.ok;
          error = result.ok ? undefined : result.error;
        } catch {
          ok = false;
          error = STATUS_TEXT.error;
        }
      } while (queued.current);
      lastSaveOk.current = ok;
      if (mounted.current && !finalized.current) {
        setSaveError(error);
        setStatus(ok ? "saved" : "error");
      }
      return ok;
    })().finally(() => {
      savePromise.current = null;
    });
    savePromise.current = promise;
    return promise;
  }

  /** Espera o rascunho estar gravado no servidor (grava já, se houver edição no debounce). */
  async function flush(): Promise<boolean> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      return runSave();
    }
    if (savePromise.current) return savePromise.current;
    if (!lastSaveOk.current) return runSave(); // a última gravação falhou: tenta de novo
    return true;
  }

  useEffect(() => {
    // Uma nova edição substitui o timer anterior. O cancelamento fica aqui (e não num
    // cleanup do efeito) para que, ao DESMONTAR, o timer ainda esteja pendente e o
    // efeito de saída abaixo consiga gravar a última alteração.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (version === 0) return;
    if (hasInvalid) {
      setStatus("invalid");
      return;
    }
    if (totals.exceedsLimit) {
      setStatus("limit");
      return;
    }
    setStatus("pending");
    timer.current = setTimeout(() => {
      timer.current = null;
      void runSave();
    }, debounceMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Ao sair da tela com uma alteração ainda no debounce, grava na hora (melhor esforço).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        if (!finalized.current) void latest.current.saveDraft(latest.current.itemsToSave);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusProductId) return;
    const input = document.getElementById(`${uid}-qty-${focusProductId}`) as HTMLInputElement | null;
    input?.focus();
    input?.select();
    setFocusProductId(undefined);
  }, [focusProductId, uid]);

  // Depois de um router.refresh(), o catálogo novo pode não ter mais algum produto da tabela
  // (desativado no meio do caminho): a linha sai e o rascunho é regravado sem ela.
  useEffect(() => {
    if (rows.some((row) => !catalogById.has(row.productId))) {
      edited(rows.filter((row) => catalogById.has(row.productId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogById]);

  // ── Ações do usuário ───────────────────────────────────────────────────────
  function edited(next: Row[]) {
    setRows(next);
    setVersion((v) => v + 1);
    setStatus("pending"); // imediato: evita mostrar "salvo" de uma edição anterior
  }

  function addProduct(product: OrderableProduct) {
    edited([...rows, { productId: product.id, quantityText: "1" }]);
    setQuery("");
    setActiveIndex(0);
    setFocusProductId(product.id);
  }

  function changeQuantity(productId: string, quantityText: string) {
    edited(rows.map((row) => (row.productId === productId ? { ...row, quantityText } : row)));
  }

  function removeRow(productId: string) {
    edited(rows.filter((row) => row.productId !== productId));
  }

  function clearOrder() {
    if (window.confirm("Remover todos os itens do pedido?")) edited([]);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = suggestions[activeIndex];
      if (choice) addProduct(choice);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  }

  async function onFinalize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || rows.length === 0) return;
    setFinalizeError(undefined);
    setCustomerErrors(undefined);

    if (hasInvalid) return setFinalizeError("Corrija as quantidades antes de finalizar o pedido.");
    if (totals.exceedsLimit) return setFinalizeError("O valor total do pedido excede o limite permitido.");

    submitting.current = true;
    setFinalizing(true);
    // O servidor finaliza a partir do RASCUNHO: garante que a última edição já foi gravada.
    if (!(await flush())) {
      submitting.current = false;
      setFinalizing(false);
      return setFinalizeError("Não foi possível salvar o rascunho antes de finalizar. Tente novamente.");
    }

    let result: FinalizeResult;
    try {
      result = await finalize({
        customerName: customer.name,
        customerPhone: customer.phone,
        notes: customer.notes,
        expectedTotalCents: totals.totalCents,
      });
    } catch {
      result = { ok: false, error: "Não foi possível finalizar o pedido. Tente novamente." };
    }

    if (result.ok) {
      finalized.current = true; // o rascunho já foi apagado no servidor
      if (result.receipt) {
        setReceipt({ orderNumber: result.orderNumber, ...result.receipt });
        return;
      }
      router.push(`/pedidos/${result.orderId}?novo=1`);
      return; // o botão continua desabilitado enquanto a navegação acontece
    }
    setFinalizeError(result.error);
    setCustomerErrors(result.fieldErrors);
    submitting.current = false;
    setFinalizing(false);
    if (result.refresh) router.refresh(); // preços/disponibilidade mudaram: mostra os dados atuais
  }

  const customerField = (field: "customerName" | "customerPhone" | "notes") => customerErrors?.[field];

  if (receipt) {
    return (
      <section aria-label="Pedido registrado" className="space-y-6">
        <p role="status" data-testid="order-created-banner" className="rounded-md bg-emerald-50 px-4 py-3 font-medium text-emerald-800">
          Pedido #{receipt.orderNumber} registrado com sucesso! Envie o resumo pelo WhatsApp abaixo.
        </p>
        <WhatsAppSharePanel message={receipt.message} storeUrl={receipt.storeUrl} customerUrl={receipt.customerUrl} />
        <Link href="/" className="inline-block text-sm text-emerald-700 hover:underline">
          ← Voltar à vitrine
        </Link>
      </section>
    );
  }

  return (
    <section aria-label="Montagem do pedido" className="space-y-4">
      {unavailableCount > 0 ? (
        <p role="status" data-testid="unavailable-notice" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {unavailableCount === 1
            ? "1 item do seu rascunho não está mais disponível e foi removido."
            : `${unavailableCount} itens do seu rascunho não estão mais disponíveis e foram removidos.`}
        </p>
      ) : null}

      <div className="relative max-w-xl">
        <label htmlFor={`${uid}-search`} className="block text-sm font-medium">
          Adicionar produto
        </label>
        <input
          id={`${uid}-search`}
          type="text"
          role="combobox"
          aria-expanded={query.trim() !== ""}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={suggestions[activeIndex] ? `${uid}-opt-${suggestions[activeIndex].id}` : undefined}
          autoComplete="off"
          disabled={finalizing}
          placeholder="Digite a referência ou parte da descrição"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onSearchKeyDown}
          className={`mt-1 w-full ${inputClass}`}
        />
        {query.trim() !== "" ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Produtos encontrados"
            className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {suggestions.length === 0 ? (
              <li role="presentation" data-testid="no-results" className="px-3 py-2 text-sm text-slate-500">
                Nenhum produto disponível encontrado.
              </li>
            ) : (
              suggestions.map((product, index) => (
                <li
                  key={product.id}
                  id={`${uid}-opt-${product.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault(); // mantém o foco no campo até a escolha
                    addProduct(product);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm ${index === activeIndex ? "bg-emerald-50" : ""}`}
                >
                  <span className="font-mono font-medium">{product.reference}</span> — {product.description}{" "}
                  <span className="text-slate-500">({formatCents(product.priceCents)})</span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <table role="table" aria-label="Itens do pedido" className="stack-table w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-sm">
        <thead role="rowgroup" className="bg-slate-100 text-slate-600">
          <tr role="row">
            <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Referência</th>
            <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Descrição do Produto</th>
            <th role="columnheader" scope="col" className="px-4 py-2 text-right font-medium">Valor Unitário</th>
            <th role="columnheader" scope="col" className="px-4 py-2 font-medium">Quantidade</th>
            <th role="columnheader" scope="col" className="px-4 py-2 text-right font-medium">Valor Total</th>
            <th role="columnheader" scope="col" className="px-4 py-2 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {parsed.length === 0 ? (
            <tr role="row">
              <td role="cell" colSpan={6} data-testid="empty-order" className="stack-empty px-4 py-6 text-center text-slate-500">
                Nenhum produto no pedido. Use o campo acima para buscar por referência ou descrição.
              </td>
            </tr>
          ) : (
            parsed.map(({ row, product, quantity }) => {
              const invalid = quantity === null;
              const lineTotal = lineTotalById.get(product.id);
              return (
                <tr role="row" key={product.id} className="border-t border-slate-100 align-top">
                  <td role="cell" data-label="Referência" className="stack-wide px-4 py-2 font-mono">{product.reference}</td>
                  <td role="cell" data-label="Descrição do Produto" className="stack-wide px-4 py-2">{product.description}</td>
                  <td role="cell" data-label="Valor Unitário" className="px-4 py-2 text-right tabular-nums">{formatCents(product.priceCents)}</td>
                  <td role="cell" data-label="Quantidade" className="px-4 py-2">
                    <input
                      id={`${uid}-qty-${product.id}`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      readOnly={finalizing}
                      aria-label={`Quantidade de ${product.reference}`}
                      aria-invalid={invalid ? true : undefined}
                      aria-describedby={invalid ? `${uid}-err-${product.id}` : undefined}
                      value={row.quantityText}
                      onChange={(event) => changeQuantity(product.id, event.target.value)}
                      className={`w-24 ${inputClass}`}
                    />
                    {invalid ? (
                      <p id={`${uid}-err-${product.id}`} role="alert" className="mt-1 text-xs text-red-600">
                        Informe um número inteiro de 1 a 9999.
                      </p>
                    ) : null}
                  </td>
                  <td role="cell" data-label="Valor Total" data-testid="line-total" className="stack-wide px-4 py-2 text-right tabular-nums">
                    {lineTotal === undefined ? "—" : formatCents(lineTotal)}
                  </td>
                  <td role="cell" className="stack-actions px-4 py-2">
                    <button
                      type="button"
                      disabled={finalizing}
                      onClick={() => removeRow(product.id)}
                      aria-label={`Remover ${product.reference}`}
                      className="py-1 text-red-600 hover:underline disabled:text-slate-400 sm:py-0"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot role="rowgroup" className="border-t-2 border-slate-200 bg-slate-50">
          <tr role="row">
            <th role="rowheader" scope="row" colSpan={4} className="px-4 py-3 text-right font-semibold">
              Total do pedido
            </th>
            <td role="cell" data-testid="order-total" aria-live="polite" className="px-4 py-3 text-right text-base font-bold tabular-nums">
              {formatCents(totals.totalCents)}
            </td>
            <td role="cell" />
          </tr>
        </tfoot>
      </table>

      {totals.exceedsLimit ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          O valor total do pedido excede o limite permitido.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <p data-testid="order-summary" className="text-slate-600">
          {totals.lineCount} produto(s) · {totals.unitCount} unidade(s)
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p role="status" aria-live="polite" data-testid="save-status" className={status === "error" || status === "invalid" || status === "limit" ? "text-red-600" : "text-slate-500"}>
            {status === "error" ? (saveError ?? STATUS_TEXT.error) : STATUS_TEXT[status]}
          </p>
          <button
            type="button"
            onClick={clearOrder}
            disabled={rows.length === 0 || finalizing}
            className="text-red-600 hover:underline disabled:text-slate-400 disabled:no-underline"
          >
            Limpar pedido
          </button>
        </div>
      </div>

      <form
        onSubmit={onFinalize}
        noValidate
        aria-label="Finalizar pedido"
        className={collectCustomer ? "space-y-4 rounded-lg border border-slate-200 bg-white p-4" : "space-y-4"}
      >
        {collectCustomer ? (
          <>
          <h2 className="text-lg font-semibold">Dados do pedido</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-customer-name`} className="block text-sm font-medium">
                Nome do cliente
              </label>
              <input
                id={`${uid}-customer-name`}
                type="text"
                required
                maxLength={120}
                autoComplete="off"
                disabled={finalizing}
                aria-invalid={customerField("customerName") ? true : undefined}
                aria-describedby={customerField("customerName") ? `${uid}-customer-name-err` : undefined}
                value={customer.name}
                onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                className={`mt-1 w-full ${inputClass}`}
              />
              {customerField("customerName")?.map((message) => (
                <p key={message} id={`${uid}-customer-name-err`} role="alert" className="mt-1 text-sm text-red-600">
                  {message}
                </p>
              ))}
            </div>

            <div>
              <label htmlFor={`${uid}-customer-phone`} className="block text-sm font-medium">
                Telefone do cliente (opcional)
              </label>
              <input
                id={`${uid}-customer-phone`}
                type="text"
                inputMode="tel"
                autoComplete="off"
                disabled={finalizing}
                aria-invalid={customerField("customerPhone") ? true : undefined}
                aria-describedby={customerField("customerPhone") ? `${uid}-customer-phone-err` : undefined}
                value={customer.phone}
                onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
                className={`mt-1 w-full ${inputClass}`}
              />
              {customerField("customerPhone") ? (
                customerField("customerPhone")?.map((message) => (
                  <p key={message} id={`${uid}-customer-phone-err`} role="alert" className="mt-1 text-sm text-red-600">
                    {message}
                  </p>
                ))
              ) : (
                <p className="mt-1 text-xs text-slate-500">Com DDD. Ex.: (11) 98888-7777</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor={`${uid}-notes`} className="block text-sm font-medium">
              Observações (opcional)
            </label>
            <textarea
              id={`${uid}-notes`}
              rows={2}
              maxLength={500}
              disabled={finalizing}
              aria-invalid={customerField("notes") ? true : undefined}
              value={customer.notes}
              onChange={(event) => setCustomer({ ...customer, notes: event.target.value })}
              className={`mt-1 w-full ${inputClass}`}
            />
            {customerField("notes")?.map((message) => (
              <p key={message} role="alert" className="mt-1 text-sm text-red-600">
                {message}
              </p>
            ))}
          </div>
          </>
        ) : null}

        {finalizeError ? (
          <p role="alert" data-testid="finalize-error" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {finalizeError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={rows.length === 0 || finalizing}
          className="rounded-md bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {finalizing ? "Finalizando..." : "Finalizar pedido"}
        </button>
      </form>
    </section>
  );
}
