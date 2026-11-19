import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyRevenueChart } from "./daily-revenue-chart";

type Day = { date: string; revenueCents: number; orderCount: number };

/** 30 dias, de 2026-10-21 (qua) a 2026-11-19 (qui), todos zerados. */
function emptyDays(): Day[] {
  const start = Date.UTC(2026, 9, 21);
  return Array.from({ length: 30 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    revenueCents: 0,
    orderCount: 0,
  }));
}

function sampleDays(): Day[] {
  const days = emptyDays();
  days[2] = { ...days[2], revenueCents: 186_700, orderCount: 1 }; // sex 23/10
  days[26] = { ...days[26], revenueCents: 333_160, orderCount: 1 }; // seg 16/11 (pico)
  days[29] = { ...days[29], revenueCents: 197_260, orderCount: 4 }; // qui 19/11 (hoje)
  return days;
}

const TITLE = "Faturamento por dia (últimos 30 dias)";
const setup = (days = sampleDays()) =>
  render(<DailyRevenueChart days={days} title={TITLE} description="R$ 717,12 no período, contando hoje." />);

const slots = () => screen.getAllByTestId("revenue-day");
const money = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const tooltip = () => screen.queryByTestId("revenue-tooltip");
const focus = (element: HTMLElement) => act(() => element.focus());

describe("DailyRevenueChart — estrutura", () => {
  it("mostra título, descrição e uma coluna por dia, cada uma com nome acessível", () => {
    setup();
    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(screen.getByText("R$ 717,12 no período, contando hoje.")).toBeInTheDocument();
    expect(slots()).toHaveLength(30);
    expect(money(slots()[29].getAttribute("aria-label"))).toBe("qui 19/11: R$ 1.972,60, 4 pedidos");
    expect(money(slots()[26].getAttribute("aria-label"))).toBe("seg 16/11: R$ 3.331,60, 1 pedido");
    expect(money(slots()[0].getAttribute("aria-label"))).toBe("qua 21/10: R$ 0,00, 0 pedidos");
  });

  it("só dias com faturamento desenham coluna; dia zerado fica só com o espaço", () => {
    setup();
    expect(screen.getAllByTestId("revenue-bar")).toHaveLength(3);
    expect(within(slots()[0]).queryByTestId("revenue-bar")).not.toBeInTheDocument();
  });

  it("a altura é proporcional ao teto do eixo (pico R$ 3.331,60 → eixo até R$ 4.000)", () => {
    setup();
    const percentOf = (day: number) => Number(within(slots()[day]).getByTestId("revenue-bar").style.height.match(/max\(2px, ([\d.]+)%\)/)![1]);
    expect(percentOf(26)).toBeCloseTo((333_160 / 400_000) * 100, 2); // 83,29%
    expect(percentOf(29)).toBeCloseTo((197_260 / 400_000) * 100, 2);
    expect(percentOf(26)).toBeGreaterThan(percentOf(29)); // o pico é a coluna mais alta
  });

  it("eixo Y com rótulos limpos e eixo X com uma data a cada 5 dias, terminando em hoje", () => {
    setup();
    for (const label of ["R$ 0", "R$ 1.000", "R$ 2.000", "R$ 3.000", "R$ 4.000"]) expect(screen.getByText(label)).toBeInTheDocument();
    for (const label of ["19/11", "14/11", "09/11", "04/11", "30/10", "25/10"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("20/11")).not.toBeInTheDocument();
    expect(screen.queryByText("18/11")).not.toBeInTheDocument();
  });

  it("rotula direto só o pico (um rótulo, no maior dia)", () => {
    setup();
    const labels = screen.getAllByTestId("revenue-peak-label");
    expect(labels).toHaveLength(1);
    expect(money(labels[0].textContent)).toBe("R$ 3.331,60");
    expect(slots()[26]).toContainElement(labels[0]);
  });

  it("uma série só: sem legenda (o título já diz o que é)", () => {
    setup();
    expect(screen.queryByText(/legenda/i)).not.toBeInTheDocument();
  });

  it("tudo zerado: sem colunas nem rótulo de pico, e sem quebrar", () => {
    setup(emptyDays());
    expect(slots()).toHaveLength(30);
    expect(screen.queryAllByTestId("revenue-bar")).toHaveLength(0);
    expect(screen.queryByTestId("revenue-peak-label")).not.toBeInTheDocument();
    expect(screen.getByText("R$ 4")).toBeInTheDocument(); // escala fixa de apoio
  });
});

describe("DailyRevenueChart — hover", () => {
  it("passar o mouse mostra o tooltip do dia (data, valor e pedidos) e sair o esconde", () => {
    setup();
    expect(tooltip()).not.toBeInTheDocument();

    fireEvent.pointerEnter(slots()[29]);
    expect(tooltip()).toHaveTextContent("qui 19/11");
    expect(money(tooltip()!.textContent)).toContain("R$ 1.972,60");
    expect(tooltip()).toHaveTextContent("4 pedidos");

    fireEvent.pointerLeave(slots()[29]);
    expect(tooltip()).not.toBeInTheDocument();
  });

  it("singular para 1 pedido e 0 pedidos para dia vazio", () => {
    setup();
    fireEvent.pointerEnter(slots()[26]);
    expect(tooltip()).toHaveTextContent("1 pedido");
    expect(tooltip()).not.toHaveTextContent("1 pedidos");
    fireEvent.pointerEnter(slots()[5]);
    expect(tooltip()).toHaveTextContent("0 pedidos");
  });

  it("o tooltip é decorativo para leitor de tela (o nome da coluna já traz o mesmo texto)", () => {
    setup();
    fireEvent.pointerEnter(slots()[29]);
    expect(tooltip()).toHaveAttribute("aria-hidden", "true");
  });

  it("a coluna destacada escurece, e o tooltip fica ao lado dela, nunca por cima", () => {
    setup();
    const bar = () => within(slots()[29]).getByTestId("revenue-bar");
    expect(bar().style.background).toContain("var(--viz-series-1)");
    fireEvent.pointerEnter(slots()[29]);
    expect(bar().style.background).toContain("var(--viz-series-1-hover)");
    expect(tooltip()!.style.right).not.toBe(""); // metade direita: abre para a esquerda
    expect(tooltip()!.style.left).toBe("");

    fireEvent.pointerEnter(slots()[2]);
    expect(tooltip()!.style.left).not.toBe(""); // metade esquerda: abre para a direita
    expect(tooltip()!.style.right).toBe("");
  });

  it("no dia do pico, o rótulo direto some enquanto o tooltip está aberto (o tooltip já mostra o valor)", () => {
    setup();
    expect(screen.getByTestId("revenue-peak-label")).toBeInTheDocument();
    fireEvent.pointerEnter(slots()[26]);
    expect(screen.queryByTestId("revenue-peak-label")).not.toBeInTheDocument();
    fireEvent.pointerLeave(slots()[26]);
    expect(screen.getByTestId("revenue-peak-label")).toBeInTheDocument();
  });
});

describe("DailyRevenueChart — teclado", () => {
  it("só uma coluna entra na sequência do Tab (a de hoje) e as outras ficam fora dela", () => {
    setup();
    expect(slots().filter((slot) => slot.tabIndex === 0)).toHaveLength(1);
    expect(slots()[29].tabIndex).toBe(0);
  });

  it("o foco mostra o mesmo tooltip do hover e sair do foco o esconde", () => {
    setup();
    focus(slots()[29]);
    expect(tooltip()).toHaveTextContent("qui 19/11");
    act(() => slots()[29].blur());
    expect(tooltip()).not.toBeInTheDocument();
  });

  it("setas percorrem os dias, Home vai ao primeiro e End ao último; a parada do Tab acompanha", () => {
    setup();
    focus(slots()[29]);

    fireEvent.keyDown(slots()[29], { key: "ArrowLeft" });
    expect(slots()[28]).toHaveFocus();
    expect(tooltip()).toHaveTextContent("qua 18/11");
    expect(slots()[28].tabIndex).toBe(0);
    expect(slots()[29].tabIndex).toBe(-1);

    fireEvent.keyDown(slots()[28], { key: "ArrowRight" });
    expect(slots()[29]).toHaveFocus();

    fireEvent.keyDown(slots()[29], { key: "Home" });
    expect(slots()[0]).toHaveFocus();
    expect(tooltip()).toHaveTextContent("qua 21/10");

    fireEvent.keyDown(slots()[0], { key: "End" });
    expect(slots()[29]).toHaveFocus();
  });

  it("nas pontas as setas não saem do gráfico e outras teclas são ignoradas", () => {
    setup();
    focus(slots()[0]);
    fireEvent.keyDown(slots()[0], { key: "ArrowLeft" });
    expect(slots()[0]).toHaveFocus();

    focus(slots()[29]);
    fireEvent.keyDown(slots()[29], { key: "ArrowRight" });
    expect(slots()[29]).toHaveFocus();

    fireEvent.keyDown(slots()[29], { key: "a" });
    expect(slots()[29]).toHaveFocus();
  });
});

describe("DailyRevenueChart — visão em tabela", () => {
  it("alterna para uma tabela com todos os dias e o total, e volta ao gráfico", () => {
    setup();
    const toggle = screen.getByRole("button", { name: "Ver como tabela" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(screen.queryAllByTestId("revenue-day")).toHaveLength(0);
    const table = screen.getByRole("table", { name: TITLE });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Dia", "Pedidos", "Faturamento"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(1 + 30 + 1); // cabeçalho + 30 dias + total
    expect(money(rows[30].textContent)).toContain("qui 19/11");
    expect(money(rows[30].textContent)).toContain("R$ 1.972,60");
    // total = soma dos dias: 1.867,00 + 3.331,60 + 1.972,60 = R$ 7.171,20, em 6 pedidos
    expect(money(rows.at(-1)!.textContent)).toContain("Total");
    expect(money(rows.at(-1)!.textContent)).toContain("R$ 7.171,20");
    expect(rows.at(-1)).toHaveTextContent("6");

    const back = screen.getByRole("button", { name: "Ver gráfico" });
    expect(back).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(back);
    expect(screen.getAllByTestId("revenue-day")).toHaveLength(30);
  });
});
