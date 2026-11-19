/**
 * Métricas de faturamento do painel administrativo.
 *
 * Definições (valem para todos os números):
 *  - FATURAMENTO = soma do total dos pedidos que NÃO estão cancelados (pendentes + confirmados).
 *    Pedido cancelado fica de fora; a divisão por situação mostra os três para quem quiser conferir.
 *  - Os dias e meses seguem o horário de Brasília (`REVENUE_TIME_ZONE`), independente do fuso do
 *    servidor: um pedido feito às 23h30 de Brasília conta no dia em que a pessoa o fez.
 *  - Todas as contas de data são feitas no SQL, num lugar só, para os números sempre concordarem.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/status";

export const REVENUE_TIME_ZONE = "America/Sao_Paulo";
/** Janela (em dias, contando hoje) do gráfico diário, dos produtos que mais faturam e da origem. */
export const REVENUE_WINDOW_DAYS = 30;
export const TOP_PRODUCTS_LIMIT = 5;

export type RevenuePeriod = { revenueCents: number; orderCount: number };

export type RevenueStatusRow = { status: OrderStatus; orderCount: number; totalCents: number };

export type RevenueDay = {
  /** Dia no formato AAAA-MM-DD (horário de Brasília). */
  date: string;
  revenueCents: number;
  orderCount: number;
};

export type RevenueProduct = { reference: string; description: string; quantity: number; revenueCents: number };

/** Quem lançou o pedido; VISITANTE = cliente sem cadastro, direto da vitrine. */
export const REVENUE_ORIGINS = ["ADMIN", "CONSULTOR", "CLIENTE", "VISITANTE"] as const;
export type RevenueOrigin = (typeof REVENUE_ORIGINS)[number];
export type RevenueOriginRow = { origin: RevenueOrigin; orderCount: number; revenueCents: number };

export type RevenueMetrics = {
  /** Desde o início. */
  total: RevenuePeriod;
  today: RevenuePeriod;
  /** Últimos 7 dias, contando hoje. */
  last7Days: RevenuePeriod;
  /** Do dia 1º do mês até agora. */
  month: RevenuePeriod;
  /** Mesmo trecho do mês anterior (dia 1º até o mesmo dia do mês): base justa para comparar com `month`. */
  previousMonthSamePeriod: RevenuePeriod;
  /** Sempre as três situações, na ordem de `ORDER_STATUSES` (zeradas quando não há pedidos). */
  byStatus: RevenueStatusRow[];
  /** `REVENUE_WINDOW_DAYS` dias, do mais antigo para hoje, com os dias sem pedido zerados. */
  daily: RevenueDay[];
  /** Na janela de `REVENUE_WINDOW_DAYS` dias. */
  topProducts: RevenueProduct[];
  /** Na janela de `REVENUE_WINDOW_DAYS` dias, do maior faturamento para o menor. */
  byOrigin: RevenueOriginRow[];
};

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);

export async function getRevenueMetrics(now: Date = new Date()): Promise<RevenueMetrics> {
  const db = getDb();
  const tz = REVENUE_TIME_ZONE;
  const windowDays = REVENUE_WINDOW_DAYS - 1; // a janela inclui hoje

  // "Agora" no horário de Brasília (timestamp sem fuso) e o início da janela, no mesmo "relógio".
  const localNow = sql`(${now.toISOString()}::timestamptz at time zone ${tz})`;
  const windowStart = sql`(date_trunc('day', ${localNow}) - make_interval(days => ${windowDays}::int))`;

  const [periods, statuses, daily, products, origins] = await Promise.all([
    db.execute<Row>(sql`
      with b as (
        select date_trunc('day', ${localNow}) as today_start,
               date_trunc('month', ${localNow}) as month_start
      ), l as (
        select o.total_cents, o.status, (o.created_at at time zone ${tz}) as local_at from orders o
      )
      select
        coalesce(sum(l.total_cents) filter (where l.status <> 'CANCELADO'), 0) as total_cents,
        count(*) filter (where l.status <> 'CANCELADO') as total_orders,

        coalesce(sum(l.total_cents) filter (where l.status <> 'CANCELADO' and l.local_at >= b.today_start), 0) as today_cents,
        count(*) filter (where l.status <> 'CANCELADO' and l.local_at >= b.today_start) as today_orders,

        coalesce(sum(l.total_cents) filter (where l.status <> 'CANCELADO' and l.local_at >= b.today_start - interval '6 days'), 0) as week_cents,
        count(*) filter (where l.status <> 'CANCELADO' and l.local_at >= b.today_start - interval '6 days') as week_orders,

        coalesce(sum(l.total_cents) filter (where l.status <> 'CANCELADO' and l.local_at >= b.month_start), 0) as month_cents,
        count(*) filter (where l.status <> 'CANCELADO' and l.local_at >= b.month_start) as month_orders,

        coalesce(sum(l.total_cents) filter (where l.status <> 'CANCELADO'
          and l.local_at >= b.month_start - interval '1 month'
          and l.local_at < least(b.month_start, b.month_start - interval '1 month' + (b.today_start - b.month_start) + interval '1 day')), 0) as prev_month_cents,
        count(*) filter (where l.status <> 'CANCELADO'
          and l.local_at >= b.month_start - interval '1 month'
          and l.local_at < least(b.month_start, b.month_start - interval '1 month' + (b.today_start - b.month_start) + interval '1 day')) as prev_month_orders
      from l cross join b
    `),

    db
      .select({
        status: orders.status,
        orderCount: sql<number>`count(*)`.mapWith(Number),
        totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)`.mapWith(Number),
      })
      .from(orders)
      .groupBy(orders.status),

    db.execute<Row>(sql`
      with b as (select date_trunc('day', ${localNow})::date as today)
      select to_char(d.day, 'YYYY-MM-DD') as date,
             coalesce(sum(o.total_cents), 0) as revenue_cents,
             count(o.id) as order_count
      from b
      cross join generate_series((b.today - ${windowDays}::int)::timestamp, b.today::timestamp, interval '1 day') as d(day)
      left join orders o
        on o.status <> 'CANCELADO'
       and (o.created_at at time zone ${tz})::date = d.day::date
      group by d.day
      order by d.day
    `),

    db.execute<Row>(sql`
      select oi.reference as reference,
             (array_agg(oi.description order by o.created_at desc))[1] as description,
             sum(oi.quantity) as quantity,
             sum(oi.line_total_cents) as revenue_cents
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.status <> 'CANCELADO'
        and (o.created_at at time zone ${tz}) >= ${windowStart}
      group by oi.reference
      order by revenue_cents desc, oi.reference asc
      limit ${TOP_PRODUCTS_LIMIT}
    `),

    db.execute<Row>(sql`
      select coalesce(u.role::text, 'VISITANTE') as origin,
             count(*) as order_count,
             sum(o.total_cents) as revenue_cents
      from orders o
      left join users u on u.id = o.user_id
      where o.status <> 'CANCELADO'
        and (o.created_at at time zone ${tz}) >= ${windowStart}
      group by 1
      order by revenue_cents desc, origin asc
    `),
  ]);

  const p = periods.rows[0] ?? {};
  const period = (cents: string, count: string): RevenuePeriod => ({ revenueCents: num(p[cents]), orderCount: num(p[count]) });

  const statusRows = new Map(statuses.map((row) => [row.status, row]));

  return {
    total: period("total_cents", "total_orders"),
    today: period("today_cents", "today_orders"),
    last7Days: period("week_cents", "week_orders"),
    month: period("month_cents", "month_orders"),
    previousMonthSamePeriod: period("prev_month_cents", "prev_month_orders"),
    byStatus: ORDER_STATUSES.map((status) => ({
      status,
      orderCount: statusRows.get(status)?.orderCount ?? 0,
      totalCents: statusRows.get(status)?.totalCents ?? 0,
    })),
    daily: daily.rows.map((row) => ({ date: String(row.date), revenueCents: num(row.revenue_cents), orderCount: num(row.order_count) })),
    topProducts: products.rows.map((row) => ({
      reference: String(row.reference),
      description: String(row.description),
      quantity: num(row.quantity),
      revenueCents: num(row.revenue_cents),
    })),
    byOrigin: origins.rows.map((row) => ({
      origin: String(row.origin) as RevenueOrigin,
      orderCount: num(row.order_count),
      revenueCents: num(row.revenue_cents),
    })),
  };
}
