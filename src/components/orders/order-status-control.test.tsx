import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderStatus } from "@/lib/orders/status";
import { OrderStatusControl, type UpdateStatus, type UpdateStatusResult } from "./order-status-control";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

const ok = (status: OrderStatus): UpdateStatusResult => ({ ok: true, status });
const select = () => screen.getByRole("combobox", { name: "Situação do pedido #42" }) as HTMLSelectElement;
const choose = (value: OrderStatus) => fireEvent.change(select(), { target: { value } });

function setup(status: OrderStatus = "PENDENTE", action: UpdateStatus = vi.fn<UpdateStatus>(async (_id, next) => ok(next))) {
  const utils = render(<OrderStatusControl orderId={ORDER_ID} orderNumber={42} status={status} action={action} />);
  const rerenderWith = (next: OrderStatus) =>
    utils.rerender(<OrderStatusControl orderId={ORDER_ID} orderNumber={42} status={next} action={action} />);
  return { action: action as ReturnType<typeof vi.fn<UpdateStatus>>, rerenderWith, ...utils };
}

/** Promessa que o teste resolve na hora que quiser (para ver o estado "salvando"). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe("OrderStatusControl", () => {
  it("lista as três situações, com a atual selecionada e um nome acessível com o número do pedido", () => {
    setup("CONFIRMADO");
    expect(within(select()).getAllByRole("option").map((o) => o.textContent)).toEqual(["Pendente", "Confirmado", "Cancelado"]);
    expect(select()).toHaveValue("CONFIRMADO");
    expect(select()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("alterar chama a ação com o id do pedido e a nova situação, e avisa quando salvou", async () => {
    const { action, rerenderWith } = setup("PENDENTE");

    await act(async () => choose("CONFIRMADO"));

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(ORDER_ID, "CONFIRMADO");
    expect(await screen.findByText("Situação alterada para Confirmado.")).toBeInTheDocument();
    expect(screen.getByTestId("order-status-feedback")).toHaveAttribute("role", "status");

    // O servidor revalida a lista e a linha chega com a situação nova.
    rerenderWith("CONFIRMADO");
    expect(select()).toHaveValue("CONFIRMADO");
  });

  it("enquanto salva: mostra a escolha na hora, avisa 'Salvando…' e bloqueia o seletor (nada em paralelo)", async () => {
    const pending = deferred<UpdateStatusResult>();
    const { action } = setup("PENDENTE", vi.fn<UpdateStatus>(() => pending.promise));

    await act(async () => choose("CONFIRMADO"));

    expect(select()).toHaveValue("CONFIRMADO"); // otimista: não espera o servidor para mostrar
    expect(select()).toBeDisabled();
    expect(screen.getByText("Salvando…")).toBeInTheDocument();

    await act(async () => pending.resolve(ok("CONFIRMADO")));
    await waitFor(() => expect(select()).toBeEnabled());
    expect(screen.queryByText("Salvando…")).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("se o servidor recusar: volta à situação real e mostra o motivo como alerta", async () => {
    const { action } = setup("PENDENTE", vi.fn<UpdateStatus>(async () => ({ ok: false, error: "Pedido não encontrado" })));

    await act(async () => choose("CONFIRMADO"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Pedido não encontrado");
    expect(select()).toHaveValue("PENDENTE"); // a situação mostrada nunca fica diferente da gravada
    expect(select()).toBeEnabled();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("se a chamada falhar (rede, erro do servidor): mostra uma mensagem genérica e volta ao valor real", async () => {
    setup("PENDENTE", vi.fn<UpdateStatus>(() => Promise.reject(new Error("falha de rede"))));

    await act(async () => choose("CONFIRMADO"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível alterar a situação");
    expect(select()).toHaveValue("PENDENTE");
  });

  it("um novo envio apaga a mensagem anterior (nada de erro velho ao lado de uma tentativa nova)", async () => {
    const action = vi
      .fn<UpdateStatus>()
      .mockResolvedValueOnce({ ok: false, error: "Pedido não encontrado" })
      .mockResolvedValueOnce(ok("CONFIRMADO"));
    setup("PENDENTE", action);

    await act(async () => choose("CONFIRMADO"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await act(async () => choose("CONFIRMADO"));
    await screen.findByText("Situação alterada para Confirmado.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("escolher a situação que o pedido já tem não chama o servidor", async () => {
    const { action } = setup("CONFIRMADO");
    await act(async () => choose("CONFIRMADO"));
    expect(action).not.toHaveBeenCalled();
  });

  describe("cancelar pede confirmação (tira o pedido do faturamento)", () => {
    it("recusando a confirmação: nada é enviado e o seletor continua na situação atual", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const { action } = setup("CONFIRMADO");

      await act(async () => choose("CANCELADO"));

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("#42"));
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("faturamento"));
      expect(action).not.toHaveBeenCalled();
      expect(select()).toHaveValue("CONFIRMADO");
      expect(screen.queryByText("Salvando…")).not.toBeInTheDocument();
    });

    it("aceitando: envia CANCELADO", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { action } = setup("PENDENTE");

      await act(async () => choose("CANCELADO"));

      expect(action).toHaveBeenCalledWith(ORDER_ID, "CANCELADO");
      expect(await screen.findByText("Situação alterada para Cancelado.")).toBeInTheDocument();
    });

    it("reabrir um cancelado ou confirmar NÃO pedem confirmação: nada se perde", async () => {
      const confirm = vi.spyOn(window, "confirm");
      const { action } = setup("CANCELADO");

      await act(async () => choose("PENDENTE"));
      await screen.findByText("Situação alterada para Pendente.");
      await act(async () => choose("CONFIRMADO"));

      expect(confirm).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalledTimes(2);
    });
  });
});
