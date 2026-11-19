import { formatCents } from "@/lib/money";

export type RankedRow = {
  id: string;
  label: string;
  /** Linha de apoio abaixo do nome (referência, quantidade, participação...). */
  detail?: string;
  valueCents: number;
};

/**
 * Barras horizontais ranqueadas: uma por item, do maior para o menor, todas na mesma cor (os itens são
 * categorias sem ordem natural, então a cor não repete o valor). Nome e valor ficam em texto, na cor
 * do texto, e a barra só mostra a proporção; por ser uma lista, ela mesma é a "tabela" equivalente.
 */
export function RankedBars({ rows, label }: { rows: RankedRow[]; label: string }) {
  const max = Math.max(0, ...rows.map((row) => row.valueCents));

  return (
    <ol aria-label={label} className="space-y-1">
      {rows.map((row) => {
        const percent = max > 0 ? (row.valueCents / max) * 100 : 0;
        return (
          <li key={row.id} data-testid="ranked-row" className="group rounded-md px-2 py-2 hover:bg-slate-50">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-900" title={row.label}>
                  {row.label}
                </p>
                {row.detail ? <p className="text-xs break-words text-slate-500">{row.detail}</p> : null}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatCents(row.valueCents)}</p>
            </div>
            {/* Base única à esquerda (reta); só a ponta da barra é arredondada */}
            <div className="mt-1.5 border-l" style={{ borderColor: "var(--viz-axis)" }}>
              {row.valueCents > 0 ? (
                <div
                  data-testid="ranked-bar"
                  className="h-2 rounded-r-[4px] bg-[var(--viz-series-1)] group-hover:bg-[var(--viz-series-1-hover)]"
                  style={{ width: `max(2px, ${percent}%)` }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
