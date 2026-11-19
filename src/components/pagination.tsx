import Link from "next/link";

/** Navegação "Anterior / Página X de Y / Próxima". `hrefFor` monta a URL de cada página. */
export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const linkClass = "rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-100 sm:py-1";
  const disabledClass = "rounded-md border border-slate-200 px-3 py-2 text-slate-400 sm:py-1";

  return (
    <nav aria-label="Paginação" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={linkClass} rel="prev">
          Anterior
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Anterior
        </span>
      )}
      <span data-testid="pagination-status">
        Página {page} de {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={linkClass} rel="next">
          Próxima
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Próxima
        </span>
      )}
    </nav>
  );
}
