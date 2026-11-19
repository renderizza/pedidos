import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RevenueMetrics } from "@/lib/orders/revenue";
import { RevenueSection } from "./revenue-section";

const money = (text: string | null) => (text ?? "").replace(/\s/g, " ");

function days(): RevenueMetrics["daily"] {
  const start = Date.UTC(2026, 9, 21);
  return Array.from({ length: 30 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    revenueCents: i === 29 ? 197_260 : i === 26 ? 333_160 : 0,
    orderCount: i === 29 ? 4 : i === 26 ? 1 : 0,
  }));
}

function metrics(overrides: Partial<RevenueMetrics> = {}): RevenueMetrics {
  return {
    total: { revenueCents: 1_852_000, orderCount: 16 },
    today: { revenueCents: 197_260, orderCount: 4 },
    last7Days: { revenueCents: 815_180, orderCount: 8 },
    month: { revenueCents: 1_196_570, orderCount: 11 },
    previousMonthSamePeriod: { revenueCents: 362_440, orderCount: 2 },
    byStatus: [
      { status: "PENDENTE", orderCount: 8, totalCents: 778_880 },
      { status: "CONFIRMADO", orderCount: 8, totalCents: 1_073_120 },
      { status: "CANCELADO", orderCount: 1, totalCents: 141_400 },
    ],
    daily: days(),
    topProducts: [
      { reference: "SKN-006", description: "Protetor Solar Facial Toque Seco FPS 60 50g", quantity: 20, revenueCents: 105_800 },
      { reference: "SKN-004", description: "Sérum Ácido Hialurônico 30ml", quantity: 11, revenueCents: 82_390 },
    ],
    byOrigin: [
      { origin: "CONSULTOR", orderCount: 6, revenueCents: 1_041_620 },
      { origin: "VISITANTE", orderCount: 1, revenueCents: 22_810 },
    ],
    ...overrides,
  };
}

const empty: Partial<RevenueMetrics> = {
  total: { revenueCents: 0, orderCount: 0 },
  today: { revenueCents: 0, orderCount: 0 },
  last7Days: { revenueCents: 0, orderCount: 0 },
  month: { revenueCents: 0, orderCount: 0 },
  previousMonthSamePeriod: { revenueCents: 0, orderCount: 0 },
  byStatus: [
    { status: "PENDENTE", orderCount: 0, totalCents: 0 },
    { status: "CONFIRMADO", orderCount: 0, totalCents: 0 },
    { status: "CANCELADO", orderCount: 0, totalCents: 0 },
  ],
  topProducts: [],
  byOrigin: [],
};

describe("RevenueSection — números em destaque", () => {
  it("explica a regra: pendentes + confirmados entram, cancelados ficam de fora", () => {
    render(<RevenueSection metrics={metrics()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Faturamento" })).toBeInTheDocument();
    expect(screen.getByText(/pendentes e confirmados; os cancelados ficam de fora/)).toBeInTheDocument();
    expect(screen.getByText(/horário de Brasília/)).toBeInTheDocument();
  });

  it("o mês é o número em destaque, com a quantidade de pedidos", () => {
    render(<RevenueSection metrics={metrics()} />);
    const hero = screen.getByTestId("kpi-month");
    expect(money(screen.getByTestId("kpi-month-value").textContent)).toBe("R$ 11.965,70");
    expect(hero).toHaveTextContent("11 pedidos no mês");
  });

  it("os demais períodos viram cartões com valor e pedidos; o ticket médio é total ÷ pedidos", () => {
    render(<RevenueSection metrics={metrics()} />);
    expect(money(screen.getByTestId("kpi-today-value").textContent)).toBe("R$ 1.972,60");
    expect(screen.getByTestId("kpi-today")).toHaveTextContent("4 pedidos");
    expect(money(screen.getByTestId("kpi-week-value").textContent)).toBe("R$ 8.151,80");
    expect(money(screen.getByTestId("kpi-total-value").textContent)).toBe("R$ 18.520,00");
    expect(screen.getByTestId("kpi-total")).toHaveTextContent("16 pedidos");
    expect(money(screen.getByTestId("kpi-ticket-value").textContent)).toBe("R$ 1.157,50"); // 18.520 ÷ 16
  });

  it("singular para 1 pedido", () => {
    render(<RevenueSection metrics={metrics({ today: { revenueCents: 1000, orderCount: 1 } })} />);
    expect(screen.getByTestId("kpi-today")).toHaveTextContent("1 pedido");
    expect(screen.getByTestId("kpi-today")).not.toHaveTextContent("1 pedidos");
  });

  it("ticket médio arredonda para o centavo", () => {
    render(<RevenueSection metrics={metrics({ total: { revenueCents: 1000, orderCount: 3 } })} />);
    expect(money(screen.getByTestId("kpi-ticket-value").textContent)).toBe("R$ 3,33");
  });
});

describe("RevenueSection — variação do mês", () => {
  it("alta: seta para cima, sinal e '(aumento)' — nunca só a cor", () => {
    render(<RevenueSection metrics={metrics()} />);
    const delta = screen.getByTestId("kpi-month-delta");
    expect(delta).toHaveTextContent("▲");
    expect(delta).toHaveTextContent("+230,1%");
    expect(delta).toHaveTextContent("(aumento)");
    expect(money(delta.textContent)).toContain("vs. mesmo período do mês anterior (R$ 3.624,40)");
  });

  it("queda: seta para baixo e '(queda)'", () => {
    render(<RevenueSection metrics={metrics({ month: { revenueCents: 90_000, orderCount: 3 }, previousMonthSamePeriod: { revenueCents: 100_000, orderCount: 4 } })} />);
    const delta = screen.getByTestId("kpi-month-delta");
    expect(delta).toHaveTextContent("▼");
    expect(delta).toHaveTextContent("−10,0%");
    expect(delta).toHaveTextContent("(queda)");
  });

  it("igual ao mês anterior: neutro", () => {
    render(<RevenueSection metrics={metrics({ month: { revenueCents: 50_000, orderCount: 2 }, previousMonthSamePeriod: { revenueCents: 50_000, orderCount: 2 } })} />);
    const delta = screen.getByTestId("kpi-month-delta");
    expect(delta).toHaveTextContent("0,0%");
    expect(delta).toHaveTextContent("(sem variação)");
  });

  it("sem faturamento no mês anterior não inventa percentual", () => {
    render(<RevenueSection metrics={metrics({ previousMonthSamePeriod: { revenueCents: 0, orderCount: 0 } })} />);
    const delta = screen.getByTestId("kpi-month-delta");
    expect(delta).toHaveTextContent("Sem faturamento no mesmo período do mês anterior para comparar.");
    expect(delta).not.toHaveTextContent("%");
  });
});

describe("RevenueSection — gráfico e rankings", () => {
  it("inclui o gráfico diário de 30 dias, com o total do período", () => {
    render(<RevenueSection metrics={metrics()} />);
    expect(screen.getAllByTestId("revenue-day")).toHaveLength(30);
    expect(screen.getByRole("heading", { name: "Faturamento por dia (últimos 30 dias)" })).toBeInTheDocument();
    expect(money(screen.getByTestId("revenue-chart").textContent)).toContain("R$ 5.304,20 no período"); // 3.331,60 + 1.972,60
  });

  it("produtos: descrição, referência, unidades e participação no período", () => {
    render(<RevenueSection metrics={metrics()} />);
    const list = screen.getByRole("list", { name: "Produtos que mais faturam" });
    const [first, second] = within(list).getAllByTestId("ranked-row");
    expect(first).toHaveTextContent("Protetor Solar Facial Toque Seco FPS 60 50g");
    expect(first).toHaveTextContent("SKN-006 · 20 un. · 20% do faturamento"); // 1.058,00 de 5.304,20 = 19,9%
    expect(money(first.textContent)).toContain("R$ 1.058,00");
    expect(second).toHaveTextContent("SKN-004");
  });

  it("origem: nomes por extenso, pedidos e participação, na ordem recebida", () => {
    render(<RevenueSection metrics={metrics()} />);
    const list = screen.getByRole("list", { name: "Faturamento por origem" });
    const [first, second] = within(list).getAllByTestId("ranked-row");
    expect(first).toHaveTextContent("Consultores");
    expect(first).toHaveTextContent("6 pedidos");
    expect(second).toHaveTextContent("Visitantes (sem cadastro)");
    expect(second).toHaveTextContent("1 pedido ·");
  });

  it.each([
    ["ADMIN", "Administradores"],
    ["CLIENTE", "Clientes"],
    ["CONSULTOR", "Consultores"],
    ["VISITANTE", "Visitantes (sem cadastro)"],
  ] as const)("a origem %s aparece como '%s'", (origin, label) => {
    render(<RevenueSection metrics={metrics({ byOrigin: [{ origin, orderCount: 1, revenueCents: 1000 }] })} />);
    expect(within(screen.getByRole("list", { name: "Faturamento por origem" })).getByText(label)).toBeInTheDocument();
  });

  it("sem pedidos na janela, os dois rankings avisam em vez de ficar vazios", () => {
    render(<RevenueSection metrics={metrics({ topProducts: [], byOrigin: [] })} />);
    expect(screen.getAllByText("Sem pedidos no período.")).toHaveLength(2);
    expect(screen.queryByRole("list", { name: "Produtos que mais faturam" })).not.toBeInTheDocument();
  });
});

describe("RevenueSection — pedidos por situação", () => {
  it("lista as três situações com quantidade, valor e se entram no faturamento", () => {
    render(<RevenueSection metrics={metrics()} />);
    const table = screen.getByTestId("revenue-status-table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(money(rows[0].textContent)).toMatch(/Pendente\s*8\s*R\$ 7\.788,80\s*Sim/);
    expect(money(rows[1].textContent)).toMatch(/Confirmado\s*8\s*R\$ 10\.731,20\s*Sim/);
    expect(money(rows[2].textContent)).toMatch(/Cancelado\s*1\s*R\$ 1\.414,00\s*Não/);
  });
});

describe("RevenueSection — sem dados", () => {
  it("nenhum pedido: mostra o aviso e não monta gráficos nem cartões", () => {
    render(<RevenueSection metrics={metrics(empty)} />);
    expect(screen.getByTestId("revenue-empty")).toHaveTextContent("Ainda não há pedidos para calcular o faturamento.");
    expect(screen.queryByTestId("kpi-month")).not.toBeInTheDocument();
    expect(screen.queryByTestId("revenue-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("revenue-status-table")).not.toBeInTheDocument();
  });

  it("só pedidos cancelados: o painel aparece, zerado e sem erro (a tabela mostra o que existe)", () => {
    render(
      <RevenueSection
        metrics={metrics({
          ...empty,
          byStatus: [
            { status: "PENDENTE", orderCount: 0, totalCents: 0 },
            { status: "CONFIRMADO", orderCount: 0, totalCents: 0 },
            { status: "CANCELADO", orderCount: 2, totalCents: 30_000 },
          ],
          daily: days().map((day) => ({ ...day, revenueCents: 0, orderCount: 0 })),
        })}
      />,
    );
    expect(screen.queryByTestId("revenue-empty")).not.toBeInTheDocument();
    expect(money(screen.getByTestId("kpi-month-value").textContent)).toBe("R$ 0,00");
    expect(money(screen.getByTestId("kpi-ticket-value").textContent)).toBe("R$ 0,00"); // sem divisão por zero
    expect(money(screen.getByTestId("revenue-status-table").textContent)).toContain("R$ 300,00");
  });
});
