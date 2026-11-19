/**
 * Métricas de faturamento do painel. Os valores usam potências de 2 (1.000, 2.000, 4.000...) para que
 * qualquer pedido contado no lugar errado produza uma soma diferente e inconfundível, e os instantes
 * ficam colados nas fronteiras de meia-noite de Brasília (UTC−3) para provar o fuso.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db";
import { orderItems, orders } from "@/db/schema";
import type { OrderStatus } from "@/lib/orders/status";
import { getRevenueMetrics, REVENUE_WINDOW_DAYS, TOP_PRODUCTS_LIMIT } from "@/lib/orders/revenue";
import { createUserWithSession, resetDatabase } from "../setup/db-helpers";

/** qui 19/11/2026, 23:00 em Brasília (já é dia 20 em UTC). */
const NOW = new Date("2026-11-20T02:00:00Z");

type Item = { reference: string; description: string; unitPriceCents: number; quantity: number };

async function insertOrder(args: { at: string; cents?: number; status?: OrderStatus; userId?: string | null; items?: Item[] }) {
  const total = args.items ? args.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) : (args.cents ?? 0);
  const at = new Date(args.at);
  const [order] = await getDb()
    .insert(orders)
    .values({
      userId: args.userId ?? null,
      customerName: "Cliente",
      status: args.status ?? "CONFIRMADO",
      totalCents: total,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  if (args.items) {
    await getDb()
      .insert(orderItems)
      .values(
        args.items.map((item, position) => ({
          orderId: order.id,
          reference: item.reference,
          description: item.description,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          lineTotalCents: item.unitPriceCents * item.quantity,
          position,
        })),
      );
  }
  return order;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("getRevenueMetrics — sem pedidos", () => {
  it("tudo zerado, com as três situações e os 30 dias de sempre", async () => {
    const m = await getRevenueMetrics(NOW);
    const zero = { revenueCents: 0, orderCount: 0 };
    expect([m.total, m.today, m.last7Days, m.month, m.previousMonthSamePeriod]).toEqual([zero, zero, zero, zero, zero]);
    expect(m.byStatus).toEqual([
      { status: "PENDENTE", orderCount: 0, totalCents: 0 },
      { status: "CONFIRMADO", orderCount: 0, totalCents: 0 },
      { status: "CANCELADO", orderCount: 0, totalCents: 0 },
    ]);
    expect(m.daily).toHaveLength(REVENUE_WINDOW_DAYS);
    expect(m.daily.every((day) => day.revenueCents === 0 && day.orderCount === 0)).toBe(true);
    expect(m.topProducts).toEqual([]);
    expect(m.byOrigin).toEqual([]);
  });
});

describe("getRevenueMetrics — períodos, fronteiras e fuso de Brasília", () => {
  beforeEach(async () => {
    // [instante em UTC, centavos, situação]. Cada comentário diz onde o pedido cai em Brasília.
    const rows: [string, number, OrderStatus?][] = [
      ["2026-11-20T01:30:00Z", 1_000, "PENDENTE"], // 19/11 22:30 → HOJE (mesmo já sendo dia 20 em UTC)
      ["2026-11-19T03:00:00Z", 2_000], //              19/11 00:00:00 → hoje (primeiro instante do dia)
      ["2026-11-19T02:59:59Z", 4_000], //              18/11 23:59:59 → ONTEM (não é hoje, mas está nos 7 dias)
      ["2026-11-13T03:00:00Z", 8_000], //              13/11 00:00 → primeiro dia dos últimos 7 dias
      ["2026-11-13T02:59:59Z", 16_000], //             12/11 23:59:59 → fora dos 7 dias, ainda no mês
      ["2026-11-01T03:00:00Z", 32_000], //             01/11 00:00 → primeiro instante do mês
      ["2026-11-01T02:59:59Z", 64_000], //             31/10 23:59:59 → mês passado, fora do trecho comparável
      ["2026-10-01T03:00:00Z", 128_000], //            01/10 00:00 → começo do trecho comparável (1º a 19/10)
      ["2026-10-20T02:59:59Z", 256_000], //            19/10 23:59:59 → último instante do trecho comparável
      ["2026-10-20T03:00:00Z", 512_000], //            20/10 00:00 → já fora do trecho comparável
      ["2026-10-01T02:59:59Z", 1_024_000], //          30/09 23:59:59 → só no total
      ["2026-10-21T03:00:00Z", 5_000_000], //          21/10 00:00 → primeiro dia da janela de 30 dias
      ["2026-10-21T02:59:59Z", 7_000_000], //          20/10 23:59:59 → um segundo antes da janela
      ["2026-11-19T12:00:00Z", 2_048_000, "CANCELADO"], // cancelado: fora de tudo, menos da divisão por situação
    ];
    for (const [at, cents, status] of rows) await insertOrder({ at, cents, status });
  });

  it("total desde o início: tudo, menos os cancelados", async () => {
    expect((await getRevenueMetrics(NOW)).total).toEqual({ revenueCents: 14_047_000, orderCount: 13 });
  });

  it("hoje (dia de Brasília, não de UTC): vai de 00:00:00 até agora", async () => {
    expect((await getRevenueMetrics(NOW)).today).toEqual({ revenueCents: 3_000, orderCount: 2 });
  });

  it("últimos 7 dias contam hoje + 6 anteriores (13/11 a 19/11)", async () => {
    expect((await getRevenueMetrics(NOW)).last7Days).toEqual({ revenueCents: 15_000, orderCount: 4 });
  });

  it("mês atual: de 01/11 00:00 até agora", async () => {
    expect((await getRevenueMetrics(NOW)).month).toEqual({ revenueCents: 63_000, orderCount: 6 });
  });

  it("mês anterior comparável: só 1º a 19/10 (os mesmos 19 dias), nunca o mês inteiro", async () => {
    expect((await getRevenueMetrics(NOW)).previousMonthSamePeriod).toEqual({ revenueCents: 384_000, orderCount: 2 });
  });

  it("por situação: separa as três e o cancelado fica visível (mas fora do faturamento)", async () => {
    const { byStatus, total } = await getRevenueMetrics(NOW);
    expect(byStatus).toEqual([
      { status: "PENDENTE", orderCount: 1, totalCents: 1_000 },
      { status: "CONFIRMADO", orderCount: 12, totalCents: 14_046_000 },
      { status: "CANCELADO", orderCount: 1, totalCents: 2_048_000 },
    ]);
    const nonCancelled = byStatus.filter((row) => row.status !== "CANCELADO");
    expect(nonCancelled.reduce((sum, row) => sum + row.totalCents, 0)).toBe(total.revenueCents);
    expect(nonCancelled.reduce((sum, row) => sum + row.orderCount, 0)).toBe(total.orderCount);
  });

  it("série diária: 30 dias contínuos, do mais antigo (21/10) até hoje (19/11), dias vazios zerados", async () => {
    const { daily } = await getRevenueMetrics(NOW);
    expect(daily).toHaveLength(30);
    expect(daily[0].date).toBe("2026-10-21");
    expect(daily.at(-1)!.date).toBe("2026-11-19");
    // datas consecutivas, sem buraco nem repetição
    daily.slice(1).forEach((day, i) => {
      expect(Date.parse(day.date) - Date.parse(daily[i].date)).toBe(86_400_000);
    });

    const nonZero = daily.filter((day) => day.revenueCents > 0).map((day) => [day.date, day.revenueCents, day.orderCount]);
    expect(nonZero).toEqual([
      ["2026-10-21", 5_000_000, 1], // a janela começa aqui (o pedido um segundo antes ficou de fora)
      ["2026-10-31", 64_000, 1],
      ["2026-11-01", 32_000, 1],
      ["2026-11-12", 16_000, 1],
      ["2026-11-13", 8_000, 1],
      ["2026-11-18", 4_000, 1],
      ["2026-11-19", 3_000, 2], // 22:30 e 00:00:00 de Brasília
    ]);
    expect(daily.reduce((sum, day) => sum + day.revenueCents, 0)).toBe(5_127_000);
  });

  it("os pedidos antigos e os cancelados não entram na série diária", async () => {
    const { daily } = await getRevenueMetrics(NOW);
    const total = daily.reduce((sum, day) => sum + day.revenueCents, 0);
    expect(total).toBe(5_127_000); // sem os 7.000.000 de 20/10, sem 512.000 etc., sem os 2.048.000 cancelados
  });
});

describe("getRevenueMetrics — virada de mês e de ano", () => {
  it("primeiro dia do mês: compara só com o dia 1º do mês anterior", async () => {
    const now = new Date("2026-11-01T15:00:00Z"); // 01/11 12:00 em Brasília
    await insertOrder({ at: "2026-11-01T03:00:00Z", cents: 100 }); //  01/11 00:00 → mês atual
    await insertOrder({ at: "2026-10-01T03:00:00Z", cents: 200 }); //  01/10 00:00 → trecho comparável
    await insertOrder({ at: "2026-10-02T03:00:00Z", cents: 400 }); //  02/10 00:00 → fora (ainda não era a data)
    const m = await getRevenueMetrics(now);
    expect(m.month).toEqual({ revenueCents: 100, orderCount: 1 });
    expect(m.previousMonthSamePeriod).toEqual({ revenueCents: 200, orderCount: 1 });
  });

  it("mês anterior mais curto (31/03 vs fevereiro de 28 dias): compara com fevereiro inteiro, sem invadir março", async () => {
    const now = new Date("2026-03-31T15:00:00Z");
    await insertOrder({ at: "2026-02-01T03:00:00Z", cents: 100 }); //  01/02 00:00
    await insertOrder({ at: "2026-02-28T12:00:00Z", cents: 200 }); //  28/02 09:00
    await insertOrder({ at: "2026-03-01T03:00:00Z", cents: 400 }); //  01/03 00:00 → é do mês atual
    const m = await getRevenueMetrics(now);
    expect(m.previousMonthSamePeriod).toEqual({ revenueCents: 300, orderCount: 2 });
    expect(m.month).toEqual({ revenueCents: 400, orderCount: 1 });
  });

  it("janeiro compara com dezembro do ano anterior", async () => {
    const now = new Date("2027-01-10T15:00:00Z");
    await insertOrder({ at: "2026-12-10T12:00:00Z", cents: 100 }); // dentro (1º a 10/12)
    await insertOrder({ at: "2026-12-11T12:00:00Z", cents: 200 }); // fora (11/12)
    await insertOrder({ at: "2027-01-01T03:00:00Z", cents: 400 }); // mês atual
    const m = await getRevenueMetrics(now);
    expect(m.previousMonthSamePeriod).toEqual({ revenueCents: 100, orderCount: 1 });
    expect(m.month).toEqual({ revenueCents: 400, orderCount: 1 });
    expect(m.daily[0].date).toBe("2026-12-12"); // a janela de 30 dias atravessa a virada do ano
  });
});

describe("getRevenueMetrics — produtos que mais faturam", () => {
  beforeEach(async () => {
    await insertOrder({
      at: "2026-11-19T15:00:00Z",
      items: [
        { reference: "REF-A", description: "Produto A (nome novo)", unitPriceCents: 1_500, quantity: 2 },
        { reference: "REF-B", description: "Produto B", unitPriceCents: 2_500, quantity: 1 },
      ],
    });
    await insertOrder({
      at: "2026-11-10T15:00:00Z",
      items: [{ reference: "REF-A", description: "Produto A (nome antigo)", unitPriceCents: 1_500, quantity: 3 }],
    });
    await insertOrder({
      at: "2026-11-12T15:00:00Z",
      status: "CANCELADO",
      items: [{ reference: "REF-C", description: "Só em pedido cancelado", unitPriceCents: 1_000_000, quantity: 1 }],
    });
    await insertOrder({
      at: "2026-10-01T15:00:00Z",
      items: [{ reference: "REF-D", description: "Fora da janela", unitPriceCents: 9_000_000, quantity: 1 }],
    });
    await insertOrder({
      at: "2026-11-05T15:00:00Z",
      items: [
        { reference: "REF-F", description: "Produto F", unitPriceCents: 900, quantity: 1 },
        { reference: "REF-E", description: "Produto E", unitPriceCents: 900, quantity: 1 },
        { reference: "REF-G", description: "Produto G", unitPriceCents: 700, quantity: 1 },
        { reference: "REF-H", description: "Produto H", unitPriceCents: 600, quantity: 1 },
      ],
    });
  });

  it("soma os pedidos do período por referência, do maior para o menor, limitado ao top 5", async () => {
    const { topProducts } = await getRevenueMetrics(NOW);
    expect(topProducts).toHaveLength(TOP_PRODUCTS_LIMIT);
    expect(topProducts.map((p) => [p.reference, p.quantity, p.revenueCents])).toEqual([
      ["REF-A", 5, 7_500], // 2 × 1.500 + 3 × 1.500
      ["REF-B", 1, 2_500],
      ["REF-E", 1, 900], //  empate com REF-F: desempata pela referência
      ["REF-F", 1, 900],
      ["REF-G", 1, 700], //  REF-H (600) ficou fora do top 5
    ]);
  });

  it("usa a descrição do pedido MAIS RECENTE quando o nome do produto mudou", async () => {
    const [first] = (await getRevenueMetrics(NOW)).topProducts;
    expect(first.description).toBe("Produto A (nome novo)");
  });

  it("ignora produto só vendido em pedido cancelado ou fora da janela de 30 dias", async () => {
    const references = (await getRevenueMetrics(NOW)).topProducts.map((p) => p.reference);
    expect(references).not.toContain("REF-C");
    expect(references).not.toContain("REF-D");
  });
});

describe("getRevenueMetrics — origem do pedido", () => {
  it("agrupa por quem lançou (inclui visitante), do maior para o menor, com desempate estável", async () => {
    const admin = (await createUserWithSession("ADMIN")).user;
    const consultor = (await createUserWithSession("CONSULTOR")).user;
    const cliente = (await createUserWithSession("CLIENTE")).user;

    await insertOrder({ at: "2026-11-18T15:00:00Z", cents: 5_000, userId: admin.id });
    await insertOrder({ at: "2026-11-18T15:00:00Z", cents: 20_000, userId: consultor.id });
    await insertOrder({ at: "2026-11-17T15:00:00Z", cents: 1_000, userId: cliente.id });
    await insertOrder({ at: "2026-11-16T15:00:00Z", cents: 2_000, userId: cliente.id });
    await insertOrder({ at: "2026-11-15T15:00:00Z", cents: 3_000, userId: null }); // visitante
    await insertOrder({ at: "2026-11-15T15:00:00Z", cents: 99_999, userId: consultor.id, status: "CANCELADO" });
    await insertOrder({ at: "2026-09-01T15:00:00Z", cents: 88_888, userId: consultor.id }); // fora da janela

    const { byOrigin, daily } = await getRevenueMetrics(NOW);

    expect(byOrigin).toEqual([
      { origin: "CONSULTOR", orderCount: 1, revenueCents: 20_000 },
      { origin: "ADMIN", orderCount: 1, revenueCents: 5_000 },
      { origin: "CLIENTE", orderCount: 2, revenueCents: 3_000 }, // empata com VISITANTE: CLIENTE vem antes (A→Z)
      { origin: "VISITANTE", orderCount: 1, revenueCents: 3_000 },
    ]);
    // mesma janela, mesmo filtro: a soma por origem é igual à soma da série diária
    expect(byOrigin.reduce((sum, row) => sum + row.revenueCents, 0)).toBe(daily.reduce((sum, day) => sum + day.revenueCents, 0));
  });
});
