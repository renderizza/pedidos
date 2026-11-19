import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderableProduct } from "@/lib/products/service";
import { OrderBuilder } from "./order-builder";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const catalog: OrderableProduct[] = [
  { id: "p1", reference: "CAM-01", description: "Camiseta azul", priceCents: 1990, categoryName: "Roupas" },
  { id: "p2", reference: "SUC-01", description: "Suco de uva", priceCents: 735, categoryName: "Bebidas" },
  { id: "p3", reference: "CAF-01", description: "Café especial", priceCents: 2500, categoryName: null },
  { id: "p4", reference: "OUR-01", description: "Peça de ouro", priceCents: 100_000_000, categoryName: null },
];

const DEBOUNCE = 600;
const money = (text: string | null) => (text ?? "").replace(/\s/g, " ");

type Item = { productId: string; quantity: number };
const ok = () => Promise.resolve({ ok: true as const });
type FinalizeFn = NonNullable<React.ComponentProps<typeof OrderBuilder>["finalize"]>;
const finalized = () => Promise.resolve({ ok: true as const, orderId: "o1", orderNumber: 7 });

function setup(
  props: Partial<React.ComponentProps<typeof OrderBuilder>> = {},
  saveDraft = vi.fn<(items: Item[]) => ReturnType<typeof ok>>(ok),
  finalize = vi.fn<FinalizeFn>(finalized),
) {
  const utils = render(
    <OrderBuilder catalog={catalog} initialRows={[]} saveDraft={saveDraft} finalize={finalize} debounceMs={DEBOUNCE} {...props} />,
  );
  return { saveDraft, finalize, ...utils };
}

const search = () => screen.getByRole("combobox", { name: "Adicionar produto" });
const qty = (reference: string) => screen.getByLabelText(`Quantidade de ${reference}`) as HTMLInputElement;
const row = (reference: string) => screen.getByRole("row", { name: new RegExp(reference) });
const total = () => money(screen.getByTestId("order-total").textContent);
const status = () => screen.getByTestId("save-status").textContent;

function typeSearch(text: string) {
  fireEvent.change(search(), { target: { value: text } });
}
function pick(reference: string) {
  const option = screen.getAllByRole("option").find((o) => o.textContent?.includes(reference));
  if (!option) throw new Error(`opção ${reference} não encontrada`);
  fireEvent.mouseDown(option);
}
function setQty(reference: string, value: string) {
  fireEvent.change(qty(reference), { target: { value } });
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  router.push.mockClear();
  router.refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("estrutura da tabela", () => {
  it("tem as colunas pedidas e começa vazia, com total zerado", () => {
    setup();
    const headers = within(screen.getByRole("table", { name: "Itens do pedido" }))
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    // As 5 colunas pedidas + a coluna de ações (visível apenas para leitores de tela).
    expect(headers).toEqual(["Referência", "Descrição do Produto", "Valor Unitário", "Quantidade", "Valor Total", "Ações"]);
    expect(screen.getByTestId("empty-order")).toBeInTheDocument();
    expect(total()).toBe("R$ 0,00");
    expect(screen.getByTestId("order-summary")).toHaveTextContent("0 produto(s) · 0 unidade(s)");
  });

  it("mostra as linhas do rascunho com valor unitário e total calculados", () => {
    setup({
      initialRows: [
        { productId: "p1", quantity: 3 },
        { productId: "p2", quantity: 12 },
      ],
    });
    const first = within(row("CAM-01"));
    expect(first.getByText("Camiseta azul")).toBeInTheDocument();
    expect(money(first.getAllByRole("cell")[2].textContent)).toBe("R$ 19,90");
    expect(qty("CAM-01").value).toBe("3");
    expect(money(first.getByTestId("line-total").textContent)).toBe("R$ 59,70");
    expect(money(within(row("SUC-01")).getByTestId("line-total").textContent)).toBe("R$ 88,20");
    expect(total()).toBe("R$ 147,90");
    expect(screen.getByTestId("order-summary")).toHaveTextContent("2 produto(s) · 15 unidade(s)");
  });

  it("não grava nada só por abrir a tela", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p1", quantity: 1 }] });
    await advance(5000);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(status()).toBe("");
  });

  it("ignora linhas do rascunho cujo produto não está no catálogo", () => {
    setup({ initialRows: [{ productId: "fantasma", quantity: 2 }, { productId: "p1", quantity: 1 }] });
    expect(screen.getAllByRole("row")).toHaveLength(1 + 1 + 1); // cabeçalho + 1 linha + rodapé
    expect(total()).toBe("R$ 19,90");
  });
});

describe("seletor de produtos", () => {
  it("sugere por referência ou descrição e adiciona a linha com quantidade 1", () => {
    setup();
    typeSearch("cam");
    expect(screen.getByRole("listbox", { name: "Produtos encontrados" })).toBeInTheDocument();

    pick("CAM-01");

    expect(qty("CAM-01").value).toBe("1");
    expect(money(within(row("CAM-01")).getByTestId("line-total").textContent)).toBe("R$ 19,90");
    expect(total()).toBe("R$ 19,90");
    expect(search()).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("leva o foco ao campo de quantidade da linha recém-adicionada", () => {
    setup();
    typeSearch("suco");
    pick("SUC-01");
    expect(qty("SUC-01")).toHaveFocus();
  });

  it("busca ignorando acentos e maiúsculas", () => {
    setup();
    typeSearch("CAFE");
    expect(screen.getByRole("option", { name: /Café especial/ })).toBeInTheDocument();
  });

  it("Enter adiciona a primeira sugestão; setas trocam a opção ativa", () => {
    setup();
    typeSearch("-01");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    fireEvent.keyDown(search(), { key: "ArrowUp" }); // dá a volta
    expect(screen.getAllByRole("option").at(-1)).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(search(), { key: "ArrowDown" }); // volta ao primeiro
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(qty("CAM-01")).toBeInTheDocument();
  });

  it("Escape limpa a busca", () => {
    setup();
    typeSearch("cam");
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search()).toHaveValue("");
  });

  it("não sugere produtos que já estão no pedido", () => {
    setup({ initialRows: [{ productId: "p1", quantity: 1 }] });
    typeSearch("cam");
    expect(screen.queryByRole("option", { name: /CAM-01/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("no-results")).toBeInTheDocument();
  });

  it("avisa quando nada é encontrado e Enter não adiciona nada", () => {
    setup();
    typeSearch("inexistente");
    expect(screen.getByTestId("no-results")).toHaveTextContent("Nenhum produto disponível encontrado.");
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(screen.getByTestId("empty-order")).toBeInTheDocument();
  });
});

describe("edição e cálculo automático", () => {
  it("recalcula o total da linha e o total geral a cada mudança de quantidade", () => {
    setup({ initialRows: [{ productId: "p1", quantity: 1 }, { productId: "p2", quantity: 1 }] });
    expect(total()).toBe("R$ 27,25"); // 19,90 + 7,35

    setQty("CAM-01", "3");
    expect(money(within(row("CAM-01")).getByTestId("line-total").textContent)).toBe("R$ 59,70");
    expect(total()).toBe("R$ 67,05"); // 59,70 + 7,35

    setQty("SUC-01", "12");
    expect(money(within(row("SUC-01")).getByTestId("line-total").textContent)).toBe("R$ 88,20");
    expect(total()).toBe("R$ 147,90");
    expect(screen.getByTestId("order-summary")).toHaveTextContent("2 produto(s) · 15 unidade(s)");
  });

  it("remover uma linha desconta do total", () => {
    setup({ initialRows: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 1 }] });
    fireEvent.click(screen.getByRole("button", { name: "Remover CAM-01" }));
    expect(screen.queryByLabelText("Quantidade de CAM-01")).not.toBeInTheDocument();
    expect(total()).toBe("R$ 7,35");
  });

  it("o produto removido volta a aparecer nas sugestões", () => {
    setup({ initialRows: [{ productId: "p1", quantity: 1 }] });
    fireEvent.click(screen.getByRole("button", { name: "Remover CAM-01" }));
    expect(screen.getByTestId("empty-order")).toBeInTheDocument();
    typeSearch("cam");
    expect(screen.getByRole("option", { name: /CAM-01/ })).toBeInTheDocument();
  });

  it.each(["0", "abc", "", "-2", "1.5", "10000", "1e3"])("quantidade inválida %j: avisa, mostra '—' e fica fora do total", (bad) => {
    setup({ initialRows: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 1 }] });
    setQty("CAM-01", bad);

    expect(qty("CAM-01")).toHaveAttribute("aria-invalid", "true");
    expect(within(row("CAM-01")).getByRole("alert")).toHaveTextContent("Informe um número inteiro de 1 a 9999.");
    expect(within(row("CAM-01")).getByTestId("line-total")).toHaveTextContent("—");
    expect(total()).toBe("R$ 7,35"); // só a outra linha
    expect(status()).toBe("Corrija as quantidades para salvar o rascunho");
  });

  it("corrigir a quantidade volta a calcular e a permitir o salvamento", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p1", quantity: 2 }] });
    setQty("CAM-01", "x");
    await advance(DEBOUNCE * 2);
    expect(saveDraft).not.toHaveBeenCalled();

    setQty("CAM-01", "4");
    expect(qty("CAM-01")).not.toHaveAttribute("aria-invalid");
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 4 }]);
    expect(total()).toBe("R$ 79,60");
  });

  it("total acima do limite: alerta, não salva", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p4", quantity: 1 }] });
    setQty("OUR-01", "30"); // 30 × R$ 1.000.000,00 passa de R$ 21.474.836,47
    expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("excede o limite"))).toBe(true);
    expect(status()).toBe("O total excede o limite permitido; reduza as quantidades");
    await advance(DEBOUNCE * 2);
    expect(saveDraft).not.toHaveBeenCalled();

    setQty("OUR-01", "10");
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("'Limpar pedido' só esvazia se o usuário confirmar", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p1", quantity: 2 }] });
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Limpar pedido" }));
    expect(qty("CAM-01")).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Limpar pedido" }));
    expect(screen.getByTestId("empty-order")).toBeInTheDocument();
    expect(total()).toBe("R$ 0,00");
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledWith([]); // lista vazia apaga o rascunho no servidor
  });

  it("'Limpar pedido' fica desabilitado sem itens", () => {
    setup();
    expect(screen.getByRole("button", { name: "Limpar pedido" })).toBeDisabled();
  });
});

describe("salvamento automático do rascunho", () => {
  it("mostra 'não salvo' na hora e 'Rascunho salvo' depois de gravar", async () => {
    const { saveDraft } = setup();
    typeSearch("cam");
    pick("CAM-01");
    expect(status()).toBe("Alterações não salvas…");
    expect(saveDraft).not.toHaveBeenCalled();

    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 1 }]);
    expect(status()).toBe("Rascunho salvo");
  });

  it("várias edições seguidas viram UMA gravação, com o estado mais recente", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p1", quantity: 1 }] });
    setQty("CAM-01", "2");
    await advance(200);
    setQty("CAM-01", "3");
    await advance(200);
    setQty("CAM-01", "4");
    await advance(DEBOUNCE - 1);
    expect(saveDraft).not.toHaveBeenCalled();
    await advance(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 4 }]);
  });

  it("envia só as linhas válidas, na ordem da tabela", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p2", quantity: 1 }] });
    typeSearch("cam");
    pick("CAM-01");
    setQty("CAM-01", "5");
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledWith([
      { productId: "p2", quantity: 1 },
      { productId: "p1", quantity: 5 },
    ]);
  });

  it("mostra o erro devolvido pelo servidor", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ ok: false, error: "Um dos produtos não está mais disponível" });
    setup({ initialRows: [{ productId: "p1", quantity: 1 }] }, saveDraft);
    setQty("CAM-01", "2");
    await advance(DEBOUNCE);
    expect(status()).toBe("Um dos produtos não está mais disponível");
  });

  it("trata falha de rede (promessa rejeitada) como erro de salvamento", async () => {
    const saveDraft = vi.fn().mockRejectedValue(new Error("offline"));
    setup({ initialRows: [{ productId: "p1", quantity: 1 }] }, saveDraft);
    setQty("CAM-01", "2");
    await advance(DEBOUNCE);
    expect(status()).toBe("Não foi possível salvar o rascunho");
  });

  it("nunca faz duas gravações ao mesmo tempo: a edição feita durante o envio entra na fila", async () => {
    let release!: () => void;
    const saveDraft = vi
      .fn<(items: Item[]) => Promise<{ ok: true }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true }))))
      .mockResolvedValue({ ok: true });
    setup({ initialRows: [{ productId: "p1", quantity: 1 }] }, saveDraft);

    setQty("CAM-01", "2");
    await advance(DEBOUNCE); // 1ª gravação começa e fica pendurada
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Salvando…");

    setQty("CAM-01", "7"); // edição durante o envio
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledTimes(1); // continua 1: não dispara em paralelo

    await act(async () => release());
    await advance(0);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenLastCalledWith([{ productId: "p1", quantity: 7 }]);
    expect(status()).toBe("Rascunho salvo");
  });

  it("ao sair da tela com edição pendente, grava imediatamente", () => {
    const { saveDraft, unmount } = setup({ initialRows: [{ productId: "p1", quantity: 1 }] });
    setQty("CAM-01", "9");
    expect(saveDraft).not.toHaveBeenCalled();
    unmount();
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 9 }]);
  });

  it("ao sair da tela sem edição pendente, não grava nada", () => {
    const { saveDraft, unmount } = setup({ initialRows: [{ productId: "p1", quantity: 1 }] });
    unmount();
    expect(saveDraft).not.toHaveBeenCalled();
  });
});

describe("itens que deixaram de estar disponíveis", () => {
  it("avisa o usuário e regrava o rascunho já limpo", async () => {
    const { saveDraft } = setup({ initialRows: [{ productId: "p1", quantity: 2 }], unavailableCount: 2 });
    expect(screen.getByTestId("unavailable-notice")).toHaveTextContent("2 itens do seu rascunho não estão mais disponíveis");
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 2 }]);
  });

  it("usa o singular para 1 item e não mostra aviso quando não há descartes", () => {
    const { unmount } = setup({ unavailableCount: 1 });
    expect(screen.getByTestId("unavailable-notice")).toHaveTextContent("1 item do seu rascunho não está mais disponível");
    unmount();
    setup({ unavailableCount: 0 });
    expect(screen.queryByTestId("unavailable-notice")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finalização
// ─────────────────────────────────────────────────────────────────────────────
const customerName = () => screen.getByLabelText("Nome do cliente") as HTMLInputElement;
const customerPhone = () => screen.getByLabelText("Telefone do cliente (opcional)") as HTMLInputElement;
const customerNotes = () => screen.getByLabelText("Observações (opcional)") as HTMLTextAreaElement;
const finalizeButton = () => screen.getByRole("button", { name: /Finalizar pedido|Finalizando/ });
const finalizeForm = () => screen.getByRole("form", { name: "Finalizar pedido" });
const finalizeError = () => screen.queryByTestId("finalize-error");

async function submit() {
  await act(async () => {
    fireEvent.submit(finalizeForm());
  });
  await advance(0);
}

describe("finalização do pedido", () => {
  const withOrder = () => ({ initialRows: [{ productId: "p1", quantity: 3 }] });

  it("mostra os campos do cliente e só habilita 'Finalizar' quando há itens", () => {
    setup();
    expect(customerName()).toBeInTheDocument();
    expect(customerPhone()).toBeInTheDocument();
    expect(customerNotes()).toBeInTheDocument();
    expect(finalizeButton()).toBeDisabled();

    typeSearch("cam");
    pick("CAM-01");
    expect(finalizeButton()).toBeEnabled();
  });

  it("envia os dados do cliente e o total visto na tela; em sucesso, vai para o pedido criado", async () => {
    const { finalize } = setup(withOrder());
    fireEvent.change(customerName(), { target: { value: "João da Loja" } });
    fireEvent.change(customerPhone(), { target: { value: "(11) 98888-7777" } });
    fireEvent.change(customerNotes(), { target: { value: "Entregar de manhã" } });

    await submit();

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({
      customerName: "João da Loja",
      customerPhone: "(11) 98888-7777",
      notes: "Entregar de manhã",
      expectedTotalCents: 5970, // 3 × R$ 19,90
    });
    expect(router.push).toHaveBeenCalledWith("/pedidos/o1?novo=1");
    expect(finalizeButton()).toBeDisabled(); // continua bloqueado durante a navegação
    expect(finalizeButton()).toHaveTextContent("Finalizando...");
  });

  it("grava ANTES a edição que ainda estava no debounce e só então finaliza", async () => {
    const { saveDraft, finalize } = setup(withOrder());
    setQty("CAM-01", "8"); // edição pendente (debounce de 600 ms ainda não venceu)
    expect(saveDraft).not.toHaveBeenCalled();
    fireEvent.change(customerName(), { target: { value: "Maria" } });

    await submit();

    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 8 }]);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ expectedTotalCents: 15920 })); // 8 × 19,90
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(finalize.mock.invocationCallOrder[0]);
  });

  it("espera uma gravação já em andamento terminar antes de finalizar", async () => {
    let release!: () => void;
    const saveDraft = vi
      .fn<(items: Item[]) => Promise<{ ok: true }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true }))));
    const { finalize } = setup(withOrder(), saveDraft);
    setQty("CAM-01", "2");
    await advance(DEBOUNCE); // gravação começa e fica pendurada
    fireEvent.change(customerName(), { target: { value: "Maria" } });

    await submit();
    expect(finalize).not.toHaveBeenCalled(); // ainda esperando a gravação

    await act(async () => release());
    await advance(0);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("não finaliza se a gravação do rascunho falhar", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ ok: false, error: "Um dos produtos não está mais disponível" });
    const { finalize } = setup(withOrder(), saveDraft);
    setQty("CAM-01", "2");

    await submit();

    expect(finalize).not.toHaveBeenCalled();
    expect(finalizeError()).toHaveTextContent("Não foi possível salvar o rascunho antes de finalizar");
    expect(finalizeButton()).toBeEnabled();
  });

  it("clique duplo gera uma única finalização", async () => {
    const { finalize } = setup(withOrder());
    fireEvent.change(customerName(), { target: { value: "Maria" } });
    await act(async () => {
      fireEvent.submit(finalizeForm());
      fireEvent.submit(finalizeForm());
    });
    await advance(0);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("bloqueia com quantidade inválida, sem chamar o servidor", async () => {
    const { finalize } = setup(withOrder());
    setQty("CAM-01", "abc");
    await submit();
    expect(finalize).not.toHaveBeenCalled();
    expect(finalizeError()).toHaveTextContent("Corrija as quantidades antes de finalizar o pedido.");
  });

  it("bloqueia quando o total passa do limite, sem chamar o servidor", async () => {
    const { finalize } = setup({ initialRows: [{ productId: "p4", quantity: 30 }] });
    await submit();
    expect(finalize).not.toHaveBeenCalled();
    expect(finalizeError()).toHaveTextContent("excede o limite permitido");
  });

  it("mostra os erros de campo devolvidos pelo servidor e libera o botão", async () => {
    const finalize = vi.fn<FinalizeFn>().mockResolvedValue({
      ok: false,
      error: "Revise os campos destacados",
      fieldErrors: { customerName: ["Nome do cliente é obrigatório"], customerPhone: ["Telefone inválido (informe DDD + número)"] },
    });
    setup(withOrder(), undefined, finalize);

    await submit();

    expect(finalizeError()).toHaveTextContent("Revise os campos destacados");
    expect(screen.getByText("Nome do cliente é obrigatório")).toBeInTheDocument();
    expect(screen.getByText("Telefone inválido (informe DDD + número)")).toBeInTheDocument();
    expect(customerName()).toHaveAttribute("aria-invalid", "true");
    expect(customerPhone()).toHaveAttribute("aria-invalid", "true");
    expect(finalizeButton()).toBeEnabled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("preço alterado / produto indisponível: mostra o aviso e recarrega os dados da tela", async () => {
    const finalize = vi.fn<FinalizeFn>().mockResolvedValue({
      ok: false,
      error: "Os preços mudaram desde que você montou o pedido.",
      refresh: true,
    });
    setup(withOrder(), undefined, finalize);

    await submit();

    expect(finalizeError()).toHaveTextContent("Os preços mudaram");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(finalizeButton()).toBeEnabled();
  });

  it("falha de rede vira mensagem amigável", async () => {
    const finalize = vi.fn<FinalizeFn>().mockRejectedValue(new Error("offline"));
    setup(withOrder(), undefined, finalize);
    await submit();
    expect(finalizeError()).toHaveTextContent("Não foi possível finalizar o pedido. Tente novamente.");
    expect(finalizeButton()).toBeEnabled();
  });

  it("durante a finalização, a tabela e os campos ficam travados", async () => {
    let release!: (value: Awaited<ReturnType<typeof finalized>>) => void;
    const finalize = vi.fn<FinalizeFn>().mockImplementation(() => new Promise((resolve) => (release = resolve)));
    setup(withOrder(), undefined, finalize);

    await submit();

    expect(qty("CAM-01")).toHaveAttribute("readonly");
    expect(customerName()).toBeDisabled();
    expect(search()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remover CAM-01" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Limpar pedido" })).toBeDisabled();

    await act(async () => release({ ok: true, orderId: "o9", orderNumber: 9 }));
    expect(router.push).toHaveBeenCalledWith("/pedidos/o9?novo=1");
  });

  it("depois de finalizado, nenhuma gravação tardia recria o rascunho", async () => {
    const { saveDraft, unmount } = setup(withOrder());
    setQty("CAM-01", "4");
    await submit(); // flush grava 1 vez e finaliza
    const callsAfterFinalize = saveDraft.mock.calls.length;

    await advance(DEBOUNCE * 5);
    unmount();
    expect(saveDraft).toHaveBeenCalledTimes(callsAfterFinalize);
  });

  it("depois de um refresh, produto que sumiu do catálogo sai da tabela e o rascunho é regravado", async () => {
    const { saveDraft, rerender, finalize } = setup({
      initialRows: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 1 }],
    });
    expect(screen.getByLabelText("Quantidade de CAM-01")).toBeInTheDocument();

    // router.refresh(): o servidor devolve o catálogo SEM o produto desativado e com outro preço
    const refreshed = catalog.filter((product) => product.id !== "p1").map((product) => (product.id === "p2" ? { ...product, priceCents: 800 } : product));
    rerender(<OrderBuilder catalog={refreshed} initialRows={[]} saveDraft={saveDraft} finalize={finalize} debounceMs={DEBOUNCE} />);

    expect(screen.queryByLabelText("Quantidade de CAM-01")).not.toBeInTheDocument();
    expect(total()).toBe("R$ 8,00"); // novo preço do suco aplicado
    await advance(DEBOUNCE);
    expect(saveDraft).toHaveBeenLastCalledWith([{ productId: "p2", quantity: 1 }]);
  });
});

describe("pedido de visitante: confirmação com a mensagem do WhatsApp", () => {
  const receipt = {
    message: "*PEDIDO #7*\nCliente: João da Loja",
    storeUrl: "https://wa.me/5511999998888?text=abc",
    customerUrl: "https://wa.me/5511988887777?text=abc",
  };
  const withReceipt = () => vi.fn<FinalizeFn>().mockResolvedValue({ ok: true, orderId: "o1", orderNumber: 7, receipt });
  const withOrder = () => ({ initialRows: [{ productId: "p1", quantity: 3 }] });

  it("troca a tabela pela confirmação, sem navegar para a página protegida", async () => {
    const finalize = withReceipt();
    setup(withOrder(), undefined, finalize);
    fireEvent.change(customerName(), { target: { value: "João da Loja" } });

    await submit();

    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("order-created-banner")).toHaveTextContent("Pedido #7 registrado com sucesso");
    expect(screen.getByTestId("whatsapp-message")).toHaveTextContent("*PEDIDO #7*");
    expect(screen.getByTestId("whatsapp-link")).toHaveAttribute("href", receipt.storeUrl);
    expect(screen.getByTestId("whatsapp-customer-link")).toHaveAttribute("href", receipt.customerUrl);
    expect(screen.getByRole("button", { name: /Copiar/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Voltar à vitrine/ })).toHaveAttribute("href", "/");
    // a tabela e o formulário saem da tela: não dá para finalizar o mesmo pedido duas vezes
    expect(screen.queryByRole("form", { name: "Finalizar pedido" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Itens do pedido" })).not.toBeInTheDocument();
  });

  it("sem telefone do cliente não mostra o atalho 'Enviar ao cliente'", async () => {
    const finalize = vi.fn<FinalizeFn>().mockResolvedValue({ ok: true, orderId: "o1", orderNumber: 7, receipt: { ...receipt, customerUrl: null } });
    setup(withOrder(), undefined, finalize);
    await submit();
    expect(screen.getByTestId("whatsapp-link")).toBeInTheDocument();
    expect(screen.queryByTestId("whatsapp-customer-link")).not.toBeInTheDocument();
  });

  it("depois de confirmar, nenhuma gravação tardia recria o rascunho", async () => {
    const { saveDraft } = setup(withOrder(), undefined, withReceipt());
    setQty("CAM-01", "4");
    await submit();
    const calls = saveDraft.mock.calls.length;
    await advance(DEBOUNCE * 5);
    expect(saveDraft).toHaveBeenCalledTimes(calls);
  });
});

describe("pedido interno (CONSULTOR): sem formulário de dados do pedido", () => {
  const internal = (props: Partial<React.ComponentProps<typeof OrderBuilder>> = {}) =>
    setup({ collectCustomer: false, initialRows: [{ productId: "p1", quantity: 3 }], ...props });

  it("não mostra nome, telefone, observações nem o título 'Dados do pedido'; mantém só 'Finalizar pedido'", () => {
    internal();
    expect(screen.queryByLabelText("Nome do cliente")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Telefone do cliente (opcional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Observações (opcional)")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dados do pedido" })).not.toBeInTheDocument();
    expect(within(finalizeForm()).getAllByRole("button")).toHaveLength(1);
    expect(finalizeButton()).toBeEnabled();
  });

  it("o botão só habilita quando há itens, como no fluxo com cliente", () => {
    setup({ collectCustomer: false });
    expect(finalizeButton()).toBeDisabled();
    typeSearch("cam");
    pick("CAM-01");
    expect(finalizeButton()).toBeEnabled();
  });

  it("finaliza sem pedir nada: manda o total visto na tela e vai para o pedido criado", async () => {
    const { finalize } = internal();

    await submit();

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ expectedTotalCents: 5970 })); // 3 × R$ 19,90
    expect(router.push).toHaveBeenCalledWith("/pedidos/o1?novo=1");
    expect(finalizeError()).toBeNull();
  });

  it("grava antes a edição pendente e continua bloqueando duplo clique", async () => {
    const { saveDraft, finalize } = internal();
    setQty("CAM-01", "8");
    await act(async () => {
      fireEvent.submit(finalizeForm());
      fireEvent.submit(finalizeForm());
    });
    await advance(0);
    expect(saveDraft).toHaveBeenCalledWith([{ productId: "p1", quantity: 8 }]);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ expectedTotalCents: 15920 })); // 8 × R$ 19,90
  });

  it("erro do servidor continua aparecendo e libera o botão", async () => {
    const finalize = vi.fn<FinalizeFn>().mockResolvedValue({ ok: false, error: "Os preços mudaram", refresh: true });
    internal({ finalize });
    await submit();
    expect(finalizeError()).toHaveTextContent("Os preços mudaram");
    expect(router.refresh).toHaveBeenCalled();
    expect(finalizeButton()).toBeEnabled();
  });

  it("sem itens não finaliza", async () => {
    const { finalize } = setup({ collectCustomer: false });
    await submit();
    expect(finalize).not.toHaveBeenCalled();
  });
});
