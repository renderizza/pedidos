"use client";

import { useRef, useState } from "react";
import { formatAxisCents, formatDayLong, formatDayShort, niceScale } from "@/lib/charts/scale";
import { formatCents } from "@/lib/money";

type Day = { date: string; revenueCents: number; orderCount: number };

const PLOT_HEIGHT = 220;
/** Um rótulo de data a cada N colunas, contando de hoje para trás (o último dia sempre tem rótulo). */
const LABEL_EVERY = 5;

const plural = (count: number) => `${count} ${count === 1 ? "pedido" : "pedidos"}`;

/**
 * Faturamento por dia, em colunas (uma série, uma cor: o título já diz o que é, então sem legenda).
 *  - Marcas: colunas de no máx. 24px, 4px arredondados só na ponta, 2px de espaço entre elas, base única.
 *  - Rótulo direto só no pico; o resto vem do eixo, do tooltip e da visão em tabela.
 *  - Hover E teclado (setas, Home, End) mostram o mesmo tooltip; a área de toque é a coluna inteira.
 *  - Todo valor também está na visão em tabela ("Ver como tabela"): o tooltip nunca é o único caminho.
 */
export function DailyRevenueChart({ days, title, description }: { days: Day[]; title: string; description: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // Um único ponto de parada do Tab no gráfico (as setas percorrem os dias).
  const [tabStop, setTabStop] = useState(Math.max(days.length - 1, 0));
  const slots = useRef<(HTMLDivElement | null)[]>([]);

  const count = days.length;
  const peakCents = Math.max(0, ...days.map((day) => day.revenueCents));
  const peakIndex = peakCents > 0 ? days.findIndex((day) => day.revenueCents === peakCents) : -1;
  const scale = niceScale(peakCents);
  const active = hovered ?? focused;
  const activeDay = active === null ? null : days[active];
  const percentOf = (cents: number) => (cents / scale.maxCents) * 100;

  function onKeyDown(event: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: Math.min(count - 1, tabStop + 1),
      ArrowLeft: Math.max(0, tabStop - 1),
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    slots.current[moves[event.key]]?.focus();
  }

  const total = days.reduce((sum, day) => sum + day.revenueCents, 0);
  const totalOrders = days.reduce((sum, day) => sum + day.orderCount, 0);

  return (
    <figure data-testid="revenue-chart" className="viz-root rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <figcaption>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500">{description}</p>
        </figcaption>
        <button
          type="button"
          aria-pressed={view === "table"}
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
        >
          {view === "chart" ? "Ver como tabela" : "Ver gráfico"}
        </button>
      </div>

      {view === "table" ? (
        <div className="mt-4 max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-white text-slate-600">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Dia</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Pedidos</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">Faturamento</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-t border-slate-100">
                  <th scope="row" className="py-1.5 pr-4 font-normal">{formatDayLong(day.date)}</th>
                  <td className="px-4 py-1.5 text-right tabular-nums">{day.orderCount}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">{formatCents(day.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold">
                <th scope="row" className="py-2 pr-4">Total</th>
                <td className="px-4 py-2 text-right tabular-nums">{totalOrders}</td>
                <td className="py-2 pl-4 text-right tabular-nums">{formatCents(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-[3.5rem_1fr] gap-x-2 pt-6">
          {/* Eixo Y: só rótulos (os valores também estão no tooltip e na tabela) */}
          <div className="relative" style={{ height: PLOT_HEIGHT }} aria-hidden="true">
            {scale.ticksCents.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 translate-y-1/2 text-xs tabular-nums text-slate-500"
                style={{ bottom: `${percentOf(tick)}%` }}
              >
                {formatAxisCents(tick)}
              </span>
            ))}
          </div>

          <div>
            <div className="relative" style={{ height: PLOT_HEIGHT }}>
              {/* Linhas de grade: fios de 1px, contínuas e discretas; a base é um tom acima */}
              {scale.ticksCents.map((tick) => (
                <div
                  key={tick}
                  aria-hidden="true"
                  className="absolute inset-x-0 h-px"
                  style={{ bottom: `${percentOf(tick)}%`, background: tick === 0 ? "var(--viz-axis)" : "var(--viz-grid)" }}
                />
              ))}

              <div
                role="group"
                aria-label={`${title}. Use as setas do teclado para percorrer os dias.`}
                onKeyDown={onKeyDown}
                className="absolute inset-0 flex"
              >
                {days.map((day, index) => {
                  const isActive = active === index;
                  const height = percentOf(day.revenueCents);
                  const peakAlign: React.CSSProperties =
                    index < 2 ? { left: 0 } : index > count - 3 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };
                  return (
                    <div
                      key={day.date}
                      ref={(element) => {
                        slots.current[index] = element;
                      }}
                      role="img"
                      tabIndex={index === tabStop ? 0 : -1}
                      aria-label={`${formatDayLong(day.date)}: ${formatCents(day.revenueCents)}, ${plural(day.orderCount)}`}
                      data-testid="revenue-day"
                      onPointerEnter={() => setHovered(index)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => {
                        setFocused(index);
                        setTabStop(index);
                      }}
                      onBlur={() => setFocused(null)}
                      className={`relative flex min-w-0 flex-1 items-end justify-center px-px outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-500 ${isActive ? "bg-slate-50" : ""}`}
                    >
                      {day.revenueCents > 0 ? (
                        <div
                          data-testid="revenue-bar"
                          className="w-full max-w-6 rounded-t-[4px]"
                          style={{
                            height: `max(2px, ${height}%)`,
                            background: isActive ? "var(--viz-series-1-hover)" : "var(--viz-series-1)",
                          }}
                        />
                      ) : null}
                      {index === peakIndex && !isActive ? (
                        <span
                          aria-hidden="true"
                          data-testid="revenue-peak-label"
                          className="absolute whitespace-nowrap text-xs font-medium text-slate-700"
                          style={{ bottom: `calc(${height}% + 4px)`, ...peakAlign }}
                        >
                          {formatCents(day.revenueCents)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {activeDay && active !== null ? (
                <div
                  aria-hidden="true"
                  data-testid="revenue-tooltip"
                  className="pointer-events-none absolute top-1 z-10 w-40 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-md"
                  // Ao lado da coluna (nunca por cima dela), para o dia destacado continuar visível.
                  style={
                    active < count / 2
                      ? { left: `calc(${((active + 1) / count) * 100}% + 6px)` }
                      : { right: `calc(${((count - active) / count) * 100}% + 6px)` }
                  }
                >
                  <p className="text-xs text-slate-500">{formatDayLong(activeDay.date)}</p>
                  <p className="flex items-center gap-2 text-base font-semibold tabular-nums text-slate-900">
                    <span aria-hidden="true" className="inline-block h-0.5 w-3 shrink-0" style={{ background: "var(--viz-series-1)" }} />
                    {formatCents(activeDay.revenueCents)}
                  </p>
                  <p className="text-xs text-slate-500">{plural(activeDay.orderCount)}</p>
                </div>
              ) : null}
            </div>

            <div className="flex" aria-hidden="true">
              {days.map((day, index) => (
                <div key={day.date} className="relative h-6 min-w-0 flex-1">
                  {(count - 1 - index) % LABEL_EVERY === 0 ? (
                    <span className="absolute top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-slate-500">
                      {formatDayShort(day.date)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}
