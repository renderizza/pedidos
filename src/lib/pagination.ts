export const DEFAULT_PAGE_SIZE = 10;

/** Lê `?pagina=` com segurança: qualquer coisa que não seja inteiro positivo vira 1. */
export function parsePage(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,7}$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 ? page : 1;
}

export function totalPagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), totalPages);
}
