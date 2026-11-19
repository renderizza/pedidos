/** Minúsculas e sem acentos: "Açúcar" casa com "acucar". */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

type Searchable = { id: string; reference: string; description: string };

/**
 * Busca produtos por trecho da referência ou da descrição (sem diferenciar maiúsculas/acentos).
 * Ordem: referência exata → referência começa com o texto → referência contém → descrição contém.
 */
export function searchCatalog<T extends Searchable>(
  catalog: readonly T[],
  query: string,
  { exclude = new Set<string>(), limit = 8 }: { exclude?: ReadonlySet<string>; limit?: number } = {},
): T[] {
  const q = normalizeSearch(query);
  if (!q) return [];

  const scored: { product: T; score: number }[] = [];
  for (const product of catalog) {
    if (exclude.has(product.id)) continue;
    const reference = normalizeSearch(product.reference);
    let score = -1;
    if (reference === q) score = 0;
    else if (reference.startsWith(q)) score = 1;
    else if (reference.includes(q)) score = 2;
    else if (normalizeSearch(product.description).includes(q)) score = 3;
    if (score >= 0) scored.push({ product, score });
  }

  // sort() é estável: dentro do mesmo grau mantém a ordem do catálogo (por referência).
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.product);
}
