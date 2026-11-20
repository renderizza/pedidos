import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGuestCart, writeGuestCart } from "@/lib/orders/guest-cart";
import type { OrderableProduct } from "@/lib/products/service";
import { GuestOrderBuilder } from "./guest-order-builder";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const GONE = "99999999-9999-4999-8999-999999999999";

const catalog: OrderableProduct[] = [
  { id: P1, reference: "CAM-01", description: "Camiseta azul", priceCents: 1990, imageUrl: null, categoryName: null },
  { id: P2, reference: "SUC-01", description: "Suco de uva", priceCents: 735, imageUrl: null, categoryName: null },
];

type FinalizeFn = React.ComponentProps<typeof GuestOrderBuilder>["finalize"];
const receipt = { message: "*PEDIDO #7*", storeUrl: "https://wa.me/?text=x", customerUrl: null };
const placed = () => Promise.resolve({ ok: true as const, orderId: "o1", orderNumber: 7, receipt });

function setup(finalize = vi.fn<FinalizeFn>(placed)) {
  render(<GuestOrderBuilder catalog={catalog} finalize={finalize} />);
  return { finalize };
}

const qty = (reference: string) => screen.getByLabelText(`Quantidade de ${reference}`) as HTMLInputElement;
const total = () => (screen.getByTestId("order-total").textContent ?? "").replace(/\s/g, " ");
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function submit() {
  await act(async () => {
    fireEvent.submit(screen.getByRole("form", { name: "Finalizar pedido" }));
  });
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  router.push.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GuestOrderBuilder — pedido de quem não tem cadastro", () => {
  it("carrega o pedido guardado no navegador", () => {
    writeGuestCart([{ productId: P1, quantity: 3 }]);
    setup();
    expect(qty("CAM-01").value).toBe("3");
    expect(total()).toBe("R$ 59,70");
  });

  it("sem nada guardado, começa com a tabela vazia", () => {
    setup();
    expect(screen.getByTestId("empty-order")).toBeInTheDocument();
  });

  it("produto que não existe mais no catálogo sai da tabela, avisa e some do que está guardado", async () => {
    writeGuestCart([{ productId: GONE, quantity: 2 }, { productId: P2, quantity: 1 }]);
    setup();
    expect(screen.getByTestId("unavailable-notice")).toHaveTextContent("1 item");
    expect(screen.queryByLabelText("Quantidade de CAM-01")).not.toBeInTheDocument();

    await advance(700); // o OrderBuilder regrava o rascunho já limpo
    expect(readGuestCart()).toEqual([{ productId: P2, quantity: 1 }]);
  });

  it("as alterações da tabela são guardadas no navegador", async () => {
    writeGuestCart([{ productId: P1, quantity: 1 }]);
    setup();
    fireEvent.change(qty("CAM-01"), { target: { value: "4" } });
    await advance(700);
    expect(readGuestCart()).toEqual([{ productId: P1, quantity: 4 }]);
  });

  it("ao finalizar, envia os itens que estão NA TELA junto com os dados do cliente e o total visto", async () => {
    writeGuestCart([{ productId: P1, quantity: 3 }]);
    const { finalize } = setup();
    fireEvent.change(screen.getByLabelText("Nome do cliente"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Telefone do cliente (opcional)"), { target: { value: "(11) 98888-7777" } });
    fireEvent.change(qty("CAM-01"), { target: { value: "5" } }); // edição ainda no debounce

    await submit();

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({
      customerName: "Maria",
      customerPhone: "(11)98888-7777", // o campo reaplica a máscara; o servidor guarda só os dígitos
      notes: "",
      expectedTotalCents: 9950, // 5 × R$ 19,90
      items: [{ productId: P1, quantity: 5 }],
    });
  });

  it("não envia o que outra aba gravou depois: vale o pedido que o visitante está vendo", async () => {
    writeGuestCart([{ productId: P1, quantity: 3 }]);
    const { finalize } = setup();

    // Outra aba mexe no carrinho DEPOIS de esta tela carregar. Sem editar nada aqui, o builder não
    // regrava nada: reler o localStorage na hora de finalizar enviaria o pedido da outra aba.
    writeGuestCart([{ productId: P2, quantity: 9 }]);
    await submit();

    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ items: [{ productId: P1, quantity: 3 }], expectedTotalCents: 5970 }));
  });

  it("em sucesso, limpa o pedido guardado e mostra a confirmação (sem navegar)", async () => {
    writeGuestCart([{ productId: P1, quantity: 3 }]);
    setup();
    fireEvent.change(screen.getByLabelText("Nome do cliente"), { target: { value: "Maria" } });

    await submit();

    expect(screen.getByTestId("order-created-banner")).toHaveTextContent("Pedido #7 registrado com sucesso");
    expect(screen.getByTestId("whatsapp-link")).toHaveAttribute("href", receipt.storeUrl);
    expect(readGuestCart()).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();

    await advance(5000); // nenhuma gravação tardia recria o pedido guardado
    expect(readGuestCart()).toEqual([]);
  });

  it("se o servidor recusar, o pedido continua guardado e a tela mostra o motivo", async () => {
    writeGuestCart([{ productId: P1, quantity: 3 }]);
    const finalize = vi.fn<FinalizeFn>().mockResolvedValue({
      ok: false,
      error: "Revise os campos destacados",
      fieldErrors: { customerName: ["Nome do cliente é obrigatório"] },
    });
    setup(finalize);

    await submit();

    expect(screen.getByTestId("finalize-error")).toHaveTextContent("Revise os campos destacados");
    expect(readGuestCart()).toEqual([{ productId: P1, quantity: 3 }]);
    expect(screen.queryByTestId("order-created-banner")).not.toBeInTheDocument();
  });
});
