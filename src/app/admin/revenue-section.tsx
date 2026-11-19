import { DailyRevenueChart } from "@/components/charts/daily-revenue-chart";
import { RankedBars } from "@/components/charts/ranked-bars";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import { formatShare, formatSignedPercent, percentChange } from "@/lib/charts/scale";
import { formatCents } from "@/lib/money";
import { REVENUE_WINDOW_DAYS, type RevenueMetrics, type RevenueOrigin } from "@/lib/orders/revenue";

const ORIGIN_LABEL: Record<RevenueOrigin, string> = {
  VISITANTE: "Visitantes (sem cadastro)",
  CLIENTE: "Clientes",
  CONSULTOR: "Consultores",
  ADMIN: "Administradores",
};

const plural = (count: number) => `${count} ${count === 1 ? "pedido" : "pedidos"}`;

function Tile({ id, label, value, note }: { id: string; label: string; value: string; note: string }) {
  return (
    <li data-testid={`kpi-${id}`} className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p data-testid={`kpi-${id}-value`} className="mt-1 text-3xl font-semibold text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-sm text-slate-500">{note}</p>
    </li>
  );
}

/** Variação do mês: seta + sinal + texto (nunca só a cor) e a base da comparação por extenso. */
function MonthDelta({ currentCents, previousCents }: { currentCents: number; previousCents: number }) {
  const change = percentChange(currentCents, previousCents);
  if (change === null) {
    return <p data-testid="kpi-month-delta" className="mt-2 text-sm text-slate-500">Sem faturamento no mesmo período do mês anterior para comparar.</p>;
  }
  const tone = change > 0 ? "text-emerald-700" : change < 0 ? "text-red-700" : "text-slate-600";
  return (
    <p data-testid="kpi-month-delta" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
      <span className={`inline-flex items-center gap-1 font-medium ${tone}`}>
        <span aria-hidden="true">{change > 0 ? "▲" : change < 0 ? "▼" : "■"}</span>
        {formatSignedPercent(change)}
        <span className="sr-only">{change > 0 ? "(aumento)" : change < 0 ? "(queda)" : "(sem variação)"}</span>
      </span>
      <span className="text-slate-500">vs. mesmo período do mês anterior ({formatCents(previousCents)})</span>
    </p>
  );
}

export function RevenueSection({ metrics }: { metrics: RevenueMetrics }) {
  const { total, today, last7Days, month, previousMonthSamePeriod, byStatus, daily, topProducts, byOrigin } = metrics;
  const hasOrders = byStatus.some((row) => row.orderCount > 0);
  const windowTotal = daily.reduce((sum, day) => sum + day.revenueCents, 0);
  const averageTicket = total.orderCount > 0 ? Math.round(total.revenueCents / total.orderCount) : 0;

  return (
    <section aria-labelledby="revenue-title" data-testid="revenue-section" className="viz-root mt-12">
      <h2 id="revenue-title" className="text-2xl font-bold">
        Faturamento
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Soma dos pedidos pendentes e confirmados; os cancelados ficam de fora. Dias e meses no horário de Brasília.
      </p>

      {!hasOrders ? (
        <p data-testid="revenue-empty" className="mt-6 rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
          Ainda não há pedidos para calcular o faturamento.
        </p>
      ) : (
        <>
          {/* O número em destaque do painel: o mês atual, com a comparação ao mês anterior */}
          <div data-testid="kpi-month" className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-sm text-slate-500">Faturamento do mês</p>
            {/* Número em destaque: 48px em telas largas; em celular estreito encolhe junto com a tela para não estourar o cartão */}
            <p data-testid="kpi-month-value" className="mt-1 text-[length:clamp(1.75rem,9.5vw,3rem)] leading-tight font-semibold tracking-tight text-slate-900">
              {formatCents(month.revenueCents)}
            </p>
            <p className="mt-1 text-sm text-slate-500">{plural(month.orderCount)} no mês</p>
            <MonthDelta currentCents={month.revenueCents} previousCents={previousMonthSamePeriod.revenueCents} />
          </div>

          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile id="today" label="Hoje" value={formatCents(today.revenueCents)} note={plural(today.orderCount)} />
            <Tile id="week" label="Últimos 7 dias" value={formatCents(last7Days.revenueCents)} note={plural(last7Days.orderCount)} />
            <Tile id="total" label="Total geral" value={formatCents(total.revenueCents)} note={plural(total.orderCount)} />
            <Tile id="ticket" label="Ticket médio" value={formatCents(averageTicket)} note="Total geral ÷ pedidos" />
          </ul>

          <div className="mt-6">
            <DailyRevenueChart
              days={daily}
              title={`Faturamento por dia (últimos ${REVENUE_WINDOW_DAYS} dias)`}
              description={`${formatCents(windowTotal)} no período, contando hoje.`}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section aria-labelledby="top-products-title" className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <h3 id="top-products-title" className="text-base font-semibold text-slate-900">
                Produtos que mais faturam
              </h3>
              <p className="mb-2 text-sm text-slate-500">Últimos {REVENUE_WINDOW_DAYS} dias</p>
              {topProducts.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">Sem pedidos no período.</p>
              ) : (
                <RankedBars
                  label="Produtos que mais faturam"
                  rows={topProducts.map((product) => ({
                    id: product.reference,
                    label: product.description,
                    detail: `${product.reference} · ${product.quantity} un. · ${formatShare(product.revenueCents, windowTotal)} do faturamento`,
                    valueCents: product.revenueCents,
                  }))}
                />
              )}
            </section>

            <section aria-labelledby="origin-title" className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
              <h3 id="origin-title" className="text-base font-semibold text-slate-900">
                Faturamento por origem
              </h3>
              <p className="mb-2 text-sm text-slate-500">Quem lançou o pedido · últimos {REVENUE_WINDOW_DAYS} dias</p>
              {byOrigin.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">Sem pedidos no período.</p>
              ) : (
                <RankedBars
                  label="Faturamento por origem"
                  rows={byOrigin.map((row) => ({
                    id: row.origin,
                    label: ORIGIN_LABEL[row.origin],
                    detail: `${plural(row.orderCount)} · ${formatShare(row.revenueCents, windowTotal)} do faturamento`,
                    valueCents: row.revenueCents,
                  }))}
                />
              )}
            </section>
          </div>

          <section aria-labelledby="status-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
            <h3 id="status-title" className="text-base font-semibold text-slate-900">
              Pedidos por situação
            </h3>
            <p className="mb-2 text-sm text-slate-500">Desde o início</p>
            <div className="overflow-x-auto">
            <table data-testid="revenue-status-table" className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Situação</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Pedidos</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Valor</th>
                  <th scope="col" className="py-2 pl-4 font-medium whitespace-nowrap">No faturamento</th>
                </tr>
              </thead>
              <tbody>
                {byStatus.map((row) => (
                  <tr key={row.status} className="border-t border-slate-100">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      <OrderStatusBadge status={row.status} />
                    </th>
                    <td className="px-4 py-2 text-right tabular-nums">{row.orderCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(row.totalCents)}</td>
                    <td className="py-2 pl-4 text-slate-600">{row.status === "CANCELADO" ? "Não" : "Sim"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
