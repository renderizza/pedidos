import { parsePage } from "@/lib/pagination";
import type { ProductStatusFilter } from "@/lib/products/service";
import { uuidSchema } from "@/lib/validation/common";

type RawParams = Record<string, string | string[] | undefined>;

export type ProductListQuery = {
  search: string;
  /** UUID, "none" (sem categoria) ou undefined (todas). */
  categoryId: string | undefined;
  status: ProductStatusFilter;
  page: number;
};

const STATUS_BY_PARAM: Record<string, ProductStatusFilter> = {
  ativos: "active",
  inativos: "inactive",
  todos: "all",
};
const PARAM_BY_STATUS: Record<ProductStatusFilter, string> = {
  active: "ativos",
  inactive: "inativos",
  all: "todos",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Lê os filtros da URL com tolerância: valores inválidos viram o padrão em vez de erro. */
export function parseProductListParams(raw: RawParams): ProductListQuery {
  const category = first(raw.categoria);
  const status = first(raw.status);
  return {
    search: (first(raw.q) ?? "").trim().slice(0, 100),
    categoryId: category === "none" || (category && uuidSchema.safeParse(category).success) ? category : undefined,
    status: (status && STATUS_BY_PARAM[status]) || "all",
    page: parsePage(raw.pagina),
  };
}

/**
 * Monta a URL da lista preservando os filtros ativos (e omitindo os valores padrão).
 * `basePath` permite reutilizar em outras listas (ex.: a vitrine em "/").
 */
export function buildProductListHref(
  query: Omit<ProductListQuery, "page">,
  page = 1,
  basePath = "/admin/produtos",
): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.categoryId) params.set("categoria", query.categoryId);
  if (query.status !== "all") params.set("status", PARAM_BY_STATUS[query.status]);
  if (page > 1) params.set("pagina", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
